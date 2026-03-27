/**
 * Skill Manager - Indexes, installs, and manages skills.
 *
 * Skills are SKILL.md files stored in:
 * - ~/.pi/agent/skills/ (user-level)
 * - .pi/skills/ (project-level, walking up from CWD)
 * - .agents/skills/ (legacy)
 * - npm/git packages
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'

import type { Skill, PackageSource } from '../shared/types'
import { configScanner } from './config-scanner'
import { settingsStore } from './settings-store'

// ============================================================================
// Skill Manager Class
// ============================================================================

class SkillManager {
  private cachedSkills: Map<string, Skill> = new Map()
  private disabledSkills: Set<string> = new Set()

  constructor() {
    // Load disabled skills from settings
    const settings = settingsStore.getGlobalSettings()
    if (settings.skills) {
      // skills array can contain skill names prefixed with '-' to disable
      for (const s of settings.skills) {
        if (s.startsWith('-')) {
          this.disabledSkills.add(s.substring(1))
        }
      }
    }
  }

  /**
   * Index all available skills for the given CWD.
   */
  async indexSkills(cwd: string): Promise<Skill[]> {
    this.cachedSkills.clear()

    // 1. User-level skills
    const userSkillsDir = path.join(os.homedir(), '.pi', 'agent', 'skills')
    if (fs.existsSync(userSkillsDir)) {
      const skills = this.scanSkillDir(userSkillsDir, 'local')
      for (const s of skills) {
        this.cachedSkills.set(s.name, s)
      }
    }

    // 2. Legacy user skills
    const legacyUserDir = path.join(os.homedir(), '.agents', 'skills')
    if (fs.existsSync(legacyUserDir)) {
      const skills = this.scanSkillDir(legacyUserDir, 'local')
      for (const s of skills) {
        if (!this.cachedSkills.has(s.name)) {
          this.cachedSkills.set(s.name, s)
        }
      }
    }

    // 3. Project-level skills (walk up from CWD)
    let dir = cwd
    const projectSkills: Skill[] = []
    while (dir !== path.dirname(dir)) {
      for (const base of ['.pi/skills', '.agents/skills']) {
        const skillsDir = path.join(dir, base)
        if (fs.existsSync(skillsDir)) {
          const skills = this.scanSkillDir(skillsDir, 'local')
          for (const s of skills) {
            if (!projectSkills.find((ps) => ps.name === s.name)) {
              projectSkills.push(s)
            }
          }
        }
      }
      dir = path.dirname(dir)
    }

    // Project skills override user skills
    for (const s of projectSkills) {
      this.cachedSkills.set(s.name, { ...s })
    }

    // Apply enabled/disabled state
    for (const [name, skill] of this.cachedSkills) {
      skill.enabled = !this.disabledSkills.has(name)
    }

    return this.listSkills()
  }

  /**
   * List all indexed skills.
   */
  listSkills(): Skill[] {
    return Array.from(this.cachedSkills.values())
  }

  /**
   * Get a skill by name.
   */
  getSkill(name: string): Skill | undefined {
    return this.cachedSkills.get(name)
  }

  /**
   * Search skills by query.
   */
  searchSkills(query: string): Skill[] {
    const q = query.toLowerCase()
    return this.listSkills().filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
    )
  }

  /**
   * Get only enabled skills.
   */
  getActiveSkills(): Skill[] {
    return this.listSkills().filter((s) => s.enabled)
  }

  /**
   * Enable or disable a skill.
   */
  toggleSkill(name: string, enabled: boolean): void {
    const skill = this.cachedSkills.get(name)
    if (skill) {
      skill.enabled = enabled
      if (enabled) {
        this.disabledSkills.delete(name)
      } else {
        this.disabledSkills.add(name)
      }
      // Persist
      this.persistDisabledSkills()
    }
  }

  /**
   * Install a skill from npm.
   */
  async installFromNpm(packageName: string): Promise<Skill> {
    const targetDir = path.join(os.homedir(), '.pi', 'agent', 'skills')

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // npm install into the skills directory
    execSync(`npm install ${packageName} --prefix "${targetDir}"`, {
      stdio: 'pipe',
      timeout: 60000,
    })

    // Find the installed skill directory
    const nodeModulesDir = path.join(targetDir, 'node_modules')
    if (fs.existsSync(nodeModulesDir)) {
      const skills = this.scanSkillDir(nodeModulesDir, 'npm')
      const skill = skills.find((s) => s.name === packageName || s.name === packageName.replace('@', '').replace('/', '-'))
      if (skill) {
        this.cachedSkills.set(skill.name, skill)
        return skill
      }
    }

    throw new Error(`Could not find SKILL.md in installed package ${packageName}`)
  }

  /**
   * Install a skill from git.
   */
  async installFromGit(url: string, ref?: string): Promise<Skill> {
    const targetDir = path.join(os.homedir(), '.pi', 'agent', 'skills')

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // Derive name from URL
    const urlPath = url.replace(/\.git$/, '').split('/').pop() ?? 'unknown-skill'
    const destDir = path.join(targetDir, urlPath)

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true })
    }

    // git clone
    const refArg = ref ? `--branch ${ref}` : ''
    execSync(`git clone ${refArg} "${url}" "${destDir}"`, {
      stdio: 'pipe',
      timeout: 60000,
    })

    // Check for SKILL.md
    const skillMd = path.join(destDir, 'SKILL.md')
    if (!fs.existsSync(skillMd)) {
      throw new Error(`No SKILL.md found in ${url}`)
    }

    const content = fs.readFileSync(skillMd, 'utf-8')
    const skill: Skill = {
      name: urlPath,
      path: destDir,
      description: this.extractDescription(content),
      source: 'git',
      enabled: true,
      content,
    }

    this.cachedSkills.set(skill.name, skill)
    return skill
  }

  /**
   * Delete a skill.
   */
  async deleteSkill(name: string): Promise<void> {
    const skill = this.cachedSkills.get(name)
    if (!skill) return

    if (fs.existsSync(skill.path)) {
      fs.rmSync(skill.path, { recursive: true, force: true })
    }

    this.cachedSkills.delete(name)
    this.disabledSkills.delete(name)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private scanSkillDir(dir: string, source: 'local' | 'npm' | 'git'): Skill[] {
    const skills: Skill[] = []

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        // Handle scoped npm packages (@scope/name)
        if (entry.name.startsWith('@')) {
          const scopeDir = path.join(dir, entry.name)
          try {
            const scopedEntries = fs.readdirSync(scopeDir, { withFileTypes: true })
            for (const scoped of scopedEntries) {
              if (!scoped.isDirectory()) continue
              const skillPath = path.join(scopeDir, scoped.name)
              const skill = this.loadSkillFromDir(skillPath, `${entry.name}/${scoped.name}`, source)
              if (skill) skills.push(skill)
            }
          } catch {
            // Ignore
          }
          continue
        }

        const skillPath = path.join(dir, entry.name)
        const skill = this.loadSkillFromDir(skillPath, entry.name, source)
        if (skill) skills.push(skill)
      }
    } catch (err) {
      console.error(`[SkillManager] Error scanning ${dir}:`, err)
    }

    return skills
  }

  private loadSkillFromDir(dir: string, name: string, source: 'local' | 'npm' | 'git'): Skill | null {
    const skillMd = path.join(dir, 'SKILL.md')
    if (!fs.existsSync(skillMd)) return null

    try {
      const content = fs.readFileSync(skillMd, 'utf-8')
      return {
        name,
        path: dir,
        description: this.extractDescription(content),
        source,
        enabled: !this.disabledSkills.has(name),
        content,
      }
    } catch {
      return null
    }
  }

  private extractDescription(content: string): string | undefined {
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        return trimmed.replace(/\*\*/g, '').trim() || undefined
      }
    }
    return undefined
  }

  private persistDisabledSkills(): void {
    const settings = settingsStore.getGlobalSettings()
    const skillNames = this.listSkills().map((s) => (s.enabled ? s.name : `-${s.name}`))
    settingsStore.saveGlobalSettings({ ...settings, skills: skillNames })
  }
}

// Singleton
export const skillManager = new SkillManager()

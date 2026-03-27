/**
 * Config Scanner - Scans and monitors .pi directories.
 *
 * Walks up from CWD to find project-level .pi/ config,
 * and merges with user-level ~/.pi/agent/ config.
 *
 * Monitors for file changes using fs.watch.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import type { PiSettings, ProjectConfig, UserConfig, ResolvedConfig, Skill } from '../shared/types'

// ============================================================================
// Config Locations
// ============================================================================

const PROJECT_CONFIG_FILES = [
  '.pi/settings.json',
  '.pi/SYSTEM.md',
  '.pi/APPEND_SYSTEM.md',
  '.pi/AGENTS.md',
  '.pi/skills/',
  '.pi/prompts/',
  '.pi/extensions/',
  '.pi/themes/',
]

const USER_CONFIG_DIR = path.join(os.homedir(), '.pi', 'agent')
const USER_CONFIG_FILES = [
  'settings.json',
  'SYSTEM.md',
  'AGENTS.md',
  'skills/',
  'prompts/',
  'extensions/',
  'themes/',
]

// ============================================================================
// Config Scanner Class
// ============================================================================

class ConfigScanner {
  private watchers: fs.FSWatcher[] = []
  private currentCwd: string | null = null

  /**
   * Scan project-level config starting from CWD, walking up directories.
   */
  async scanProject(cwd: string): Promise<ProjectConfig> {
    const config: ProjectConfig = {
      cwd,
      skills: [],
    }

    // Walk up from cwd to find .pi directories
    let dir = cwd
    const roots: string[] = []

    while (dir !== path.dirname(dir)) {
      const piDir = path.join(dir, '.pi')
      if (fs.existsSync(piDir) && fs.statSync(piDir).isDirectory()) {
        roots.unshift(piDir) // Closest to CWD first, then parents
      }
      dir = path.dirname(dir)
    }

    // Also check .agents/ directories
    dir = cwd
    while (dir !== path.dirname(dir)) {
      const agentsDir = path.join(dir, '.agents')
      if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
        roots.unshift(agentsDir)
      }
      dir = path.dirname(dir)
    }

    // Scan each root, with closer directories overriding parents
    for (const root of roots) {
      // Settings
      const settingsPath = path.join(root, 'settings.json')
      if (fs.existsSync(settingsPath)) {
        try {
          const content = fs.readFileSync(settingsPath, 'utf-8')
          const settings = JSON.parse(content) as Partial<PiSettings>
          config.settings = {
            ...(config.settings ?? {}),
            ...settings,
          }
        } catch (err) {
          console.error(`[ConfigScanner] Error parsing ${settingsPath}:`, err)
        }
      }

      // System prompt
      const systemPath = path.join(root, 'SYSTEM.md')
      if (fs.existsSync(systemPath)) {
        config.systemPrompt = fs.readFileSync(systemPath, 'utf-8')
      }

      // Append system prompt
      const appendPath = path.join(root, 'APPEND_SYSTEM.md')
      if (fs.existsSync(appendPath)) {
        config.appendSystemPrompt = fs.readFileSync(appendPath, 'utf-8')
      }

      // AGENTS.md
      const agentsPath = path.join(root, 'AGENTS.md')
      if (fs.existsSync(agentsPath)) {
        config.agentsMd = fs.readFileSync(agentsPath, 'utf-8')
      }

      // Skills
      const skillsDir = path.join(root, 'skills')
      if (fs.existsSync(skillsDir)) {
        const projectSkills = this.scanSkillDir(skillsDir, 'local')
        config.skills.push(...projectSkills)
      }
    }

    // Deduplicate skills by name (project-level overrides parent)
    const seen = new Set<string>()
    config.skills = config.skills.filter((s) => {
      if (seen.has(s.name)) return false
      seen.add(s.name)
      return true
    })

    return config
  }

  /**
   * Scan user-level config from ~/.pi/agent/
   */
  async scanUserConfig(): Promise<UserConfig> {
    const config: UserConfig = {
      homeDir: os.homedir(),
      settings: {},
      skills: [],
    }

    if (!fs.existsSync(USER_CONFIG_DIR)) {
      return config
    }

    // Settings
    const settingsPath = path.join(USER_CONFIG_DIR, 'settings.json')
    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf-8')
        config.settings = JSON.parse(content) as PiSettings
      } catch (err) {
        console.error(`[ConfigScanner] Error parsing user settings:`, err)
      }
    }

    // System prompt
    const systemPath = path.join(USER_CONFIG_DIR, 'SYSTEM.md')
    if (fs.existsSync(systemPath)) {
      config.systemPrompt = fs.readFileSync(systemPath, 'utf-8')
    }

    // AGENTS.md
    const agentsPath = path.join(USER_CONFIG_DIR, 'AGENTS.md')
    if (fs.existsSync(agentsPath)) {
      config.agentsMd = fs.readFileSync(agentsPath, 'utf-8')
    }

    // Skills
    const skillsDir = path.join(USER_CONFIG_DIR, 'skills')
    if (fs.existsSync(skillsDir)) {
      config.skills = this.scanSkillDir(skillsDir, 'local')
    }

    return config
  }

  /**
   * Scan and merge both configs.
   */
  async scanAndMerge(cwd: string): Promise<ResolvedConfig> {
    const project = await this.scanProject(cwd)
    const user = await this.scanUserConfig()

    // Merge: project overrides user
    const settings: PiSettings = {
      ...user.settings,
      ...project.settings,
    }

    // Merge skills: project skills override user skills with same name
    const userSkillNames = new Set(user.skills.map((s) => s.name))
    const mergedSkills = [
      ...user.skills,
      ...project.skills.filter((s) => !userSkillNames.has(s.name)),
    ]

    return {
      project,
      user,
      settings,
      // Note: skills are on project/user, not directly on resolved
    } as ResolvedConfig
  }

  /**
   * Start watching config directories for changes.
   */
  startWatching(cwd: string, onChange: () => void): void {
    this.stopWatching()
    this.currentCwd = cwd

    const dirsToWatch = new Set<string>()

    // Project-level .pi dirs
    let dir = cwd
    while (dir !== path.dirname(dir)) {
      const piDir = path.join(dir, '.pi')
      if (fs.existsSync(piDir)) dirsToWatch.add(piDir)
      const agentsDir = path.join(dir, '.agents')
      if (fs.existsSync(agentsDir)) dirsToWatch.add(agentsDir)
      dir = path.dirname(dir)
    }

    // User-level
    if (fs.existsSync(USER_CONFIG_DIR)) {
      dirsToWatch.add(USER_CONFIG_DIR)
    }

    for (const watchDir of dirsToWatch) {
      try {
        const watcher = fs.watch(watchDir, { recursive: true }, (eventType) => {
          if (eventType === 'change' || eventType === 'rename') {
            // Debounce
            setTimeout(onChange, 300)
          }
        })
        this.watchers.push(watcher)
      } catch (err) {
        console.error(`[ConfigScanner] Error watching ${watchDir}:`, err)
      }
    }
  }

  /**
   * Stop watching config directories.
   */
  stopWatching(): void {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []
    this.currentCwd = null
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Scan a skills directory for SKILL.md files.
   */
  private scanSkillDir(skillsDir: string, source: 'local' | 'npm' | 'git'): Skill[] {
    const skills: Skill[] = []

    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillDir = path.join(skillsDir, entry.name)
        const skillMd = path.join(skillDir, 'SKILL.md')

        if (fs.existsSync(skillMd)) {
          const content = fs.readFileSync(skillMd, 'utf-8')
          const description = this.extractDescription(content)

          skills.push({
            name: entry.name,
            path: skillDir,
            description,
            source,
            enabled: true,
            content,
          })
        }
      }
    } catch (err) {
      console.error(`[ConfigScanner] Error scanning skills dir ${skillsDir}:`, err)
    }

    return skills
  }

  /**
   * Extract the description from a SKILL.md file (first non-heading line).
   */
  private extractDescription(content: string): string | undefined {
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        // Remove markdown syntax
        return trimmed.replace(/\*\*/g, '').replace(/^Use this skill/g, '').trim() || undefined
      }
    }
    return undefined
  }
}

// Singleton
export const configScanner = new ConfigScanner()

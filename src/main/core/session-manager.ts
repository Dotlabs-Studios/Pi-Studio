/**
 * Session Manager - Manages pi chat sessions.
 *
 * Sessions are stored as JSONL files in the project's .pi/sessions/ directory.
 * Each entry is a JSON object with parent references for tree structure.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { Session, SessionEntry, SessionSummary, PiSettings } from '../shared/types'
import { settingsStore } from './settings-store'

// ============================================================================
// Session Manager Class
// ============================================================================

class SessionManager {
  /**
   * Create a new session.
   */
  async createSession(
    cwd: string,
    options?: {
      provider?: string
      model?: string
      id?: string
    }
  ): Promise<Session> {
    const id = options?.id ?? randomUUID()
    const settings = settingsStore.getResolvedSettings(cwd)
    const provider = options?.provider ?? settings.defaultProvider ?? 'anthropic'
    const model = options?.model ?? settings.defaultModel ?? 'claude-sonnet-4-20250514'
    const now = new Date().toISOString()

    // Ensure sessions directory exists
    const sessionsDir = this.getSessionsDir(cwd)
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true })
    }

    const filePath = path.join(sessionsDir, `${id}.jsonl`)

    const session: Session = {
      id,
      filePath,
      cwd,
      provider,
      model,
      createdAt: now,
      updatedAt: now,
      entries: [],
      currentBranch: [],
    }

    // Save initial session
    this.saveSession(session)

    return session
  }

  /**
   * Load a session from file.
   */
  async loadSession(filePath: string): Promise<Session | null> {
    try {
      console.log(`[SessionManager] loadSession: ${filePath}`)
      if (!fs.existsSync(filePath)) {
        console.log(`[SessionManager] File not found: ${filePath}`)
        return null
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim())

      if (lines.length === 0) {
        console.log(`[SessionManager] Empty file: ${filePath}`)
        return null
      }

      // First line is the session metadata
      const meta = JSON.parse(lines[0])
      console.log(`[SessionManager] Loaded meta: id=${meta.id}, entries=${lines.length - 1}`)

      const entries: SessionEntry[] = []

      // Subsequent lines are entries
      for (let i = 1; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]) as SessionEntry
          entries.push(entry)
        } catch {
          // Skip malformed entries
        }
      }

      // Build current branch (follow the chain of entries)
      const branch = this.buildBranch(entries)

      return {
        ...meta,
        filePath,
        entries,
        currentBranch: branch,
      }
    } catch (err) {
      console.error(`[SessionManager] Error loading session ${filePath}:`, err)
      return null
    }
  }

  /**
   * Save a session to file.
   */
  saveSession(session: Session): void {
    const sessionsDir = path.dirname(session.filePath)
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true })
    }

    const lines: string[] = []

    // First line: session metadata
    lines.push(
      JSON.stringify({
        id: session.id,
        filePath: session.filePath,
        cwd: session.cwd,
        provider: session.provider,
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: new Date().toISOString(),
      })
    )

    // Subsequent lines: entries
    for (const entry of session.entries) {
      lines.push(JSON.stringify(entry))
    }

    fs.writeFileSync(session.filePath, lines.join('\n'), 'utf-8')
  }

  /**
   * Delete a session file.
   */
  async deleteSession(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  /**
   * List all sessions for a project directory.
   */
  async listSessions(cwd?: string): Promise<SessionSummary[]> {
    const dir = cwd ? this.getSessionsDir(cwd) : null
    if (!dir || !fs.existsSync(dir)) return []

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))

    const summaries: SessionSummary[] = []

    for (const file of files) {
      try {
        const filePath = path.join(dir, file)
        const session = await this.loadSession(filePath)
        if (session) {
          const firstUserMsg = session.entries.find((e) => e.role === 'user')
          summaries.push({
            id: session.id,
            filePath: session.filePath,
            cwd: session.cwd,
            title: firstUserMsg
              ? (firstUserMsg.content as string).substring(0, 80)
              : 'New Session',
            provider: session.provider,
            model: session.model,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            entryCount: session.entries.length,
          })
        }
      } catch {
        // Skip
      }
    }

    // Sort by most recent first
    summaries.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    return summaries
  }

  /**
   * Add an entry to a session.
   */
  addEntry(session: Session, entry: Omit<SessionEntry, 'id' | 'timestamp'>): SessionEntry {
    const newEntry: SessionEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    }

    session.entries.push(newEntry)
    session.updatedAt = new Date().toISOString()

    // Update current branch
    if (entry.role === 'user' || entry.role === 'assistant') {
      session.currentBranch.push(newEntry.id)
    }

    // Update parent's children
    if (entry.parentId) {
      const parent = session.entries.find((e) => e.id === entry.parentId)
      if (parent) {
        if (!parent.children) parent.children = []
        parent.children.push(newEntry.id)
      }
    }

    this.saveSession(session)
    return newEntry
  }

  /**
   * Fork a session from a specific entry.
   */
  fork(session: Session, fromEntryId: string): Session {
    const entryIndex = session.entries.findIndex((e) => e.id === fromEntryId)
    if (entryIndex < 0) throw new Error(`Entry ${fromEntryId} not found`)

    // Create a new session with entries up to the fork point
    const forked: Session = {
      ...session,
      id: randomUUID(),
      filePath: session.filePath.replace(/\.jsonl$/, `-fork-${randomUUID().substring(0, 8)}.jsonl`),
      entries: session.entries.slice(0, entryIndex + 1),
      currentBranch: session.currentBranch.slice(0, session.currentBranch.indexOf(fromEntryId) + 1),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.saveSession(forked)
    return forked
  }

  /**
   * Navigate to a specific entry in the tree.
   */
  navigateTo(session: Session, entryId: string): string[] {
    const branch: string[] = []
    let current: SessionEntry | undefined = session.entries.find((e) => e.id === entryId)

    while (current) {
      branch.unshift(current.id)
      current = current.parentId
        ? session.entries.find((e) => e.id === current!.parentId)
        : undefined
    }

    session.currentBranch = branch
    return branch
  }

  /**
   * Build the current branch from the entries tree.
   */
  private buildBranch(entries: SessionEntry[]): string[] {
    const branch: string[] = []

    // Find root entries (no parent)
    let current = entries.find((e) => !e.parentId)
    while (current) {
      branch.push(current.id)
      // Follow first child
      if (current.children && current.children.length > 0) {
        current = entries.find((e) => e.id === current!.children![0])
      } else {
        break
      }
    }

    return branch
  }

  /**
   * Get the sessions directory for a project.
   */
  private getSessionsDir(cwd: string): string {
    return path.join(cwd, '.pi', 'sessions')
  }
}

// Singleton
export const sessionManager = new SessionManager()

/**
 * TerminalManager - Manages terminal sessions using node-pty.
 *
 * Each terminal session is a pseudo-terminal shell spawned in a project directory.
 * Data flows: pty → IPC → renderer (xterm.js) and back.
 */

import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'

interface TerminalSession {
  id: string
  pty: pty.IPty
  cwd: string
}

class TerminalManager {
  private sessions = new Map<string, TerminalSession>()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Create a new terminal session.
   */
  createSession(cwd: string, shell?: string): string {
    const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Determine shell
    const exe = shell ?? this.getDefaultShell()
    const args: string[] = []

    // Windows: cmd.exe doesn't need args; PowerShell does
    // macOS/Linux: shell typically handles args itself
    let spawnShell = exe
    let spawnArgs: string[] = []

    if (process.platform === 'win32') {
      // Use PowerShell by default, fall back to cmd
      spawnShell = exe || 'powershell.exe'
    } else {
      spawnShell = exe || '/bin/bash'
    }

    const ptyProcess = pty.spawn(spawnShell, spawnArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: cwd,
      env: process.env as Record<string, string>,
    })

    const session: TerminalSession = { id, pty: ptyProcess, cwd }
    this.sessions.set(id, session)

    // Forward pty output to renderer
    ptyProcess.onData((data: string) => {
      this.sendToRenderer(id, data)
    })

    // Clean up on exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      this.sendToRenderer(id, `\r\n\x1b[90m[Process exited with code ${exitCode}, signal ${signal}]\x1b[0m\r\n`)
      this.sessions.delete(id)
    })

    return id
  }

  /**
   * Write data to a terminal session.
   */
  write(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId)
    if (!session) {
      console.warn(`[TerminalManager] No session: ${terminalId}`)
      return
    }
    session.pty.write(data)
  }

  /**
   * Resize a terminal session.
   */
  resize(terminalId: string, cols: number, rows: number): void {
    const session = this.sessions.get(terminalId)
    if (!session) return
    try {
      session.pty.resize(cols, rows)
    } catch {
      // Terminal may have already exited
    }
  }

  /**
   * Kill a terminal session.
   */
  kill(terminalId: string): void {
    const session = this.sessions.get(terminalId)
    if (!session) return
    try {
      session.pty.kill()
    } catch {
      // Already dead
    }
    this.sessions.delete(terminalId)
  }

  /**
   * Kill all terminal sessions.
   */
  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id)
    }
  }

  /**
   * Get the working directory of a session (via the CWD we spawned in).
   */
  getCwd(terminalId: string): string | undefined {
    return this.sessions.get(terminalId)?.cwd
  }

  /**
   * Check if a session is alive.
   */
  isAlive(terminalId: string): boolean {
    return this.sessions.has(terminalId)
  }

  /**
   * Get the default shell for the current platform.
   */
  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }

  /**
   * Send data to the renderer via IPC.
   */
  private sendToRenderer(terminalId: string, data: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('terminal:data', { terminalId, data })
  }
}

export const terminalManager = new TerminalManager()

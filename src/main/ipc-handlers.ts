/**
 * IPC Handlers - Bridge between renderer (React) and main process (core modules).
 *
 * All IPC calls go through the preload script's Context Bridge API.
 * Security-sensitive operations stay in the main process.
 */

import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { piRuntime } from './core/pi-runtime'
import { eventBus } from './core/event-bus'
import { settingsStore } from './core/settings-store'
import { configScanner } from './core/config-scanner'
import { providerManager } from './core/provider-manager'
import { skillManager } from './core/skill-manager'
import { sessionManager } from './core/session-manager'
import { piInstaller } from './core/pi-installer'
import { terminalManager } from './core/terminal-manager'
import type { RuntimeEvent, PiSettings, PackageSource, Session } from '../shared/types'
import type { SessionEntry } from '../shared/types'
import { registerFileTreeHandlers } from './file-tree'

const execAsync = promisify(exec)

interface SessionLink {
  session: Session
  conversationId: string
}

/**
 * Register all IPC handlers.
 * Called once during app initialization.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ==========================================================================
  // Session persistence: threadId → { session, conversationId }
  // ==========================================================================

  const sessionMap = new Map<string, SessionLink>()
  let lastAssistantTimestamp = 0

  function getSessionLink(threadId: string): SessionLink | undefined {
    return sessionMap.get(threadId)
  }

  async function ensureSession(
    threadId: string, cwd: string,
    options?: { provider?: string; model?: string; sessionFilePath?: string; conversationId?: string }
  ): Promise<SessionLink> {
    let link = sessionMap.get(threadId)
    if (link) return link

    let session: Session
    const { sessionFilePath, conversationId, provider, model } = options || {}

    if (sessionFilePath) {
      // Check if another thread already uses this session file — reuse the object
      for (const existing of sessionMap.values()) {
        if (existing.session.filePath === sessionFilePath) {
          session = existing.session
          break
        }
      }
      if (!session) {
        // Load from disk
        const loaded = await sessionManager.loadSession(sessionFilePath)
        if (loaded) {
          session = loaded
        } else {
          session = await sessionManager.createSession(cwd, { provider, model })
        }
      }
    } else {
      session = await sessionManager.createSession(cwd, { provider, model })
    }

    const convId = conversationId || `conv_${crypto.randomUUID().slice(0, 8)}`
    link = { session, conversationId: convId }
    sessionMap.set(threadId, link)
    console.log(`[IPC] Session linked: threadId=${threadId}, path=${session.filePath}, conv=${convId}`)
    return link
  }

  // ==========================================================================
  // Project Management
  // ==========================================================================

  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const cwd = result.filePaths[0]
    settingsStore.addRecentProject(cwd)
    return cwd
  })

  ipcMain.handle('project:select', async (_event, cwd: string) => {
    settingsStore.addRecentProject(cwd)
    // Notify renderer to reload
    mainWindow.webContents.send('project:changed', cwd)
  })

  ipcMain.handle('project:recent', async () => {
    return settingsStore.getRecentProjects()
  })

  ipcMain.handle('project:create', async (_event, projectPath: string) => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true })

      // Create basic .pi structure
      const piDir = path.join(projectPath, '.pi')
      fs.mkdirSync(piDir, { recursive: true })

      const settingsPath = path.join(piDir, 'settings.json')
      if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(
          settingsPath,
          JSON.stringify(
            {
              defaultProvider: 'anthropic',
              defaultModel: 'claude-sonnet-4-20250514',
            },
            null,
            2
          )
        )
      }

      // Create .gitignore for .pi/sessions
      const gitignore = path.join(piDir, '.gitignore')
      fs.writeFileSync(gitignore, 'sessions/\n')
    }

    settingsStore.addRecentProject(projectPath)
    return projectPath
  })

  // ==========================================================================
  // Pi Runtime
  // ==========================================================================

  ipcMain.handle('pi:start-session', async (_event, options) => {
    const { threadId, cwd, provider, model, sessionFilePath, conversationId } = options

    // Merge API keys into the process environment
    const apiKeys = await providerManager.exportEnvForProcess(provider)
    const originalEnv = { ...process.env }
    Object.assign(process.env, apiKeys)

    try {
      const result = await piRuntime.startSession({ threadId, cwd, provider, model })

      // Link threadId to a session (create new or reuse existing)
      await ensureSession(threadId, cwd, { provider, model, sessionFilePath, conversationId })

      return result
    } finally {
      // Restore original env
      Object.keys(apiKeys).forEach((key) => {
        if (!originalEnv[key]) {
          delete process.env[key]
        } else {
          process.env[key] = originalEnv[key]
        }
      })
    }
  })

  ipcMain.handle('pi:stop-session', async (_event, threadId: string) => {
    // Final save before stopping
    const link = getSessionLink(threadId)
    if (link) {
      sessionManager.saveSession(link.session)
      sessionMap.delete(threadId)
    }
    await piRuntime.stopSession(threadId)
  })

  ipcMain.handle('pi:send-turn', async (_event, threadId: string, input: string) => {
    // Save the user message to the session file
    const link = getSessionLink(threadId)
    if (link) {
      const lastEntry = link.session.entries[link.session.entries.length - 1]
      sessionManager.addEntry(link.session, {
        role: 'user',
        content: input,
        parentId: lastEntry?.id ?? null,
        conversationId: link.conversationId,
      })
    }

    await piRuntime.sendTurn(threadId, input)
  })

  ipcMain.handle('pi:interrupt', async (_event, threadId: string) => {
    await piRuntime.interruptTurn(threadId)
  })

  ipcMain.handle('pi:respond-request', async (_event, threadId: string, requestId: string, decision: string, value?: string) => {
    await piRuntime.respondToRequest(threadId, requestId, decision as 'allow' | 'decline' | 'cancel', value)
  })

  ipcMain.handle('pi:is-session-alive', async (_event, threadId: string) => {
    return piRuntime.isSessionAlive(threadId)
  })

  // ==========================================================================
  // Config
  // ==========================================================================

  ipcMain.handle('config:scan', async (_event, cwd: string) => {
    return configScanner.scanAndMerge(cwd)
  })

  ipcMain.handle('config:get-settings', async () => {
    return settingsStore.getGlobalSettings()
  })

  ipcMain.handle('config:save-settings', async (_event, settings: PiSettings) => {
    settingsStore.saveGlobalSettings(settings)
  })

  // ==========================================================================
  // Provider
  // ==========================================================================

  ipcMain.handle('provider:list', async () => {
    return providerManager.listProviders()
  })

  ipcMain.handle('provider:get-api-key', async (_event, provider: string) => {
    return providerManager.getApiKey(provider)
  })

  ipcMain.handle('provider:set-api-key', async (_event, provider: string, key: string) => {
    await providerManager.setApiKey(provider, key)
  })

  ipcMain.handle('provider:remove-api-key', async (_event, provider: string) => {
    await providerManager.removeApiKey(provider)
  })

  ipcMain.handle('provider:list-custom', async () => {
    return providerManager.listCustomProviders()
  })

  ipcMain.handle('provider:add-custom', async (_event, provider: any) => {
    providerManager.addCustomProvider(provider)
  })

  ipcMain.handle('provider:update-custom', async (_event, provider: any) => {
    providerManager.updateCustomProvider(provider)
  })

  ipcMain.handle('provider:remove-custom', async (_event, providerName: string) => {
    providerManager.removeCustomProvider(providerName)
  })

  ipcMain.handle('provider:add-custom-model', async (_event, provider: string, model: any) => {
    providerManager.addCustomModel(provider, model)
  })

  ipcMain.handle('provider:remove-custom-model', async (_event, provider: string, modelId: string) => {
    providerManager.removeCustomModel(provider, modelId)
  })

  ipcMain.handle('provider:get-custom-models', async (_event, provider: string) => {
    return providerManager.getCustomModels(provider)
  })

  // ==========================================================================
  // Skills
  // ==========================================================================

  ipcMain.handle('skill:list', async () => {
    return skillManager.listSkills()
  })

  ipcMain.handle('skill:index', async (_event, cwd: string) => {
    return skillManager.indexSkills(cwd)
  })

  ipcMain.handle('skill:toggle', async (_event, name: string, enabled: boolean) => {
    skillManager.toggleSkill(name, enabled)
  })

  ipcMain.handle('skill:install', async (_event, source: PackageSource) => {
    if (source.type === 'npm') {
      return skillManager.installFromNpm(source.name)
    } else if (source.type === 'git') {
      return skillManager.installFromGit(source.url, source.ref)
    }
    throw new Error(`Unsupported source type: ${source.type}`)
  })

  // ==========================================================================
  // Sessions
  // ==========================================================================

  ipcMain.handle('session:list', async (_event) => {
    // List sessions from all recent projects
    const recentProjects = settingsStore.getRecentProjects()
    const allSessions = []

    for (const project of recentProjects) {
      try {
        const sessions = await sessionManager.listSessions(project)
        allSessions.push(...sessions)
      } catch {
        // Skip
      }
    }

    return allSessions
  })

  ipcMain.handle('session:list-project', async (_event, cwd: string) => {
    return sessionManager.listSessions(cwd)
  })

  ipcMain.handle('session:load', async (_event, filePath: string) => {
    console.log(`[IPC] session:load: ${filePath}`)
    const result = await sessionManager.loadSession(filePath)
    console.log(`[IPC] session:load result:`, result ? `id=${result.id}, entries=${result.entries.length}` : 'null')
    return result
  })

  ipcMain.handle('session:create', async (_event, cwd: string, options?: any) => {
    return sessionManager.createSession(cwd, options)
  })

  ipcMain.handle('session:conversations', async (_event, filePath: string) => {
    const session = await sessionManager.loadSession(filePath)
    if (!session) return null
    return sessionManager.extractConversations(session.entries)
  })

  ipcMain.handle('session:delete', async (_event, filePath: string) => {
    await sessionManager.deleteSession(filePath)
  })

  // ==========================================================================
  // Pi Binary
  // ==========================================================================

  ipcMain.handle('pi:check-installed', async () => {
    return piInstaller.isInstalled()
  })

  ipcMain.handle('pi:get-version', async () => {
    return piInstaller.getInstalledVersion()
  })

  ipcMain.handle('pi:check-updates', async () => {
    return piInstaller.checkForUpdates()
  })

  ipcMain.handle('pi:install', async () => {
    return piInstaller.install()
  })

  ipcMain.handle('pi:update', async () => {
    return piInstaller.update()
  })

  // ==========================================================================
  // Settings (UI State)
  // ==========================================================================

  ipcMain.handle('settings:get-ui', async () => {
    return {
      sidebarWidth: settingsStore.getSidebarWidth(),
      sidebarOpen: settingsStore.isSidebarOpen(),
      theme: settingsStore.getActiveTheme(),
      windowBounds: settingsStore.getWindowBounds(),
      binaryPath: settingsStore.getBinaryPath(),
      recentProjects: settingsStore.getRecentProjects(),
    }
  })

  ipcMain.handle('settings:set-sidebar-width', async (_event, width: number) => {
    settingsStore.setSidebarWidth(width)
  })

  ipcMain.handle('settings:set-sidebar-open', async (_event, open: boolean) => {
    settingsStore.setSidebarOpen(open)
  })

  ipcMain.handle('settings:set-theme', async (_event, theme: string) => {
    settingsStore.setActiveTheme(theme)
  })

  ipcMain.handle('settings:set-window-bounds', async (_event, bounds) => {
    settingsStore.setWindowBounds(bounds)
  })

  // ==========================================================================
  // Utility
  // ==========================================================================

  // ==========================================================================
  // Window Controls
  // ==========================================================================

  ipcMain.handle('window:minimize', async () => {
    mainWindow.minimize()
  })

  ipcMain.handle('window:maximize', async () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.handle('window:close', async () => {
    mainWindow.close()
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('app:get-path', async (_event, name: string) => {
    const { app } = await import('electron')
    return app.getPath(name as any)
  })

  // ==========================================================================
  // Terminal
  // ==========================================================================

  terminalManager.setMainWindow(mainWindow)

  ipcMain.handle('terminal:create', async (_event, cwd: string, shell?: string) => {
    return terminalManager.createSession(cwd, shell)
  })

  ipcMain.handle('terminal:write', async (_event, terminalId: string, data: string) => {
    terminalManager.write(terminalId, data)
  })

  ipcMain.handle('terminal:resize', async (_event, terminalId: string, cols: number, rows: number) => {
    terminalManager.resize(terminalId, cols, rows)
  })

  ipcMain.handle('terminal:kill', async (_event, terminalId: string) => {
    terminalManager.kill(terminalId)
  })

  ipcMain.handle('terminal:is-alive', async (_event, terminalId: string) => {
    return terminalManager.isAlive(terminalId)
  })

  ipcMain.handle('terminal:get-cwd', async (_event, terminalId: string) => {
    return terminalManager.getCwd(terminalId)
  })

  // ==========================================================================
  // Open in Editor
  // ==========================================================================

  ipcMain.handle('app:open-in-editor', async (_event, cwd: string) => {
    const customCommand = settingsStore.getCustomEditorCommand()
    if (customCommand) {
      // Custom editor command — replace {path} placeholder or append path
      const cmd = customCommand.includes('{path}')
        ? customCommand.replace('{path}', cwd)
        : `${customCommand} "${cwd}"`
      try {
        await execAsync(cmd)
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }

    // Default: try VS Code, then common alternatives
    const candidates = ['code', 'cursor', 'windsurf']
    for (const editor of candidates) {
      try {
        const cmd = process.platform === 'win32'
          ? `where ${editor}`
          : `which ${editor}`
        await execAsync(cmd)
        // Found — open it
        await execAsync(`${editor} "${cwd}"`)
        return { success: true, editor }
      } catch {
        // Not found, try next
      }
    }

    return { success: false, error: 'No editor found. Set a custom editor command in Settings.' }
  })

  ipcMain.handle('settings:get-editor', async () => {
    return settingsStore.getCustomEditorCommand()
  })

  ipcMain.handle('settings:set-editor', async (_event, command: string) => {
    settingsStore.setCustomEditorCommand(command)
  })

  // ==========================================================================
  // Forward EventBus events to renderer + persist to session
  // ==========================================================================

  eventBus.on('*', (event: RuntimeEvent) => {
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('runtime:event', event)
      }
    } catch {
      // Window might be closed
    }

    // --- Session persistence ---
    const threadId = event.threadId
    const link = getSessionLink(threadId)
    if (!link) return

    switch (event.type) {
      case 'content.delta': {
        // Accumulate assistant text
        if (event.payload.streamKind === 'assistant_text') {
          ;(link.session as any)._accumulatedText = ((link.session as any)._accumulatedText || '') + event.payload.delta
        }
        if (event.payload.streamKind === 'assistant_thinking') {
          ;(link.session as any)._accumulatedThinking = ((link.session as any)._accumulatedThinking || '') + event.payload.delta
        }
        break
      }

      case 'turn.started': {
        // Reset accumulator for this turn
        ;(link.session as any)._accumulatedText = ''
        ;(link.session as any)._accumulatedThinking = ''
        lastAssistantTimestamp = 0
        break
      }

      case 'turn.completed': {
        const text = (link.session as any)._accumulatedText || ''
        const thinking = (link.session as any)._accumulatedThinking || ''
        ;(link.session as any)._accumulatedText = ''
        ;(link.session as any)._accumulatedThinking = ''

        if (text || thinking) {
          // Save assistant message entry
          const lastEntry = link.session.entries[link.session.entries.length - 1]
          const content: unknown[] = []
          if (thinking) {
            content.push({ type: 'thinking', thinking })
          }
          if (text) {
            content.push({ type: 'text', text })
          }

          sessionManager.addEntry(link.session, {
            role: 'assistant',
            content: content.length === 1 && content[0].type === 'text'
              ? text
              : JSON.stringify(content),
            parentId: lastEntry?.id ?? null,
            conversationId: link.conversationId,
          })
        }
        break
      }

      case 'session.exited': {
        // Final save and remove from memory
        sessionManager.saveSession(link.session)
        sessionMap.delete(threadId)
        break
      }
    }
  })

  // Config change events
  eventBus.on('config:changed' as any, (config: any) => {
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config:changed', config)
      }
    } catch {
      // Ignore
    }
  })

  console.log('[IPC] All handlers registered')
  registerFileTreeHandlers()
}

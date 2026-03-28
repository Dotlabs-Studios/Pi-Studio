/**
 * Type declarations for the preload API exposed via Context Bridge.
 */

import type {
  RuntimeEvent,
  Provider,
  Skill,
  SessionSummary,
  Session,
  PiSettings,
  ResolvedConfig,
  PackageSource,
} from '../shared/types'

export interface PiStudioAPI {
  project: {
    open: () => Promise<string | null>
    select: (cwd: string) => Promise<void>
    getRecent: () => Promise<string[]>
    create: (projectPath: string) => Promise<string>
    onChange: (callback: (cwd: string) => void) => () => void
  }

  pi: {
    startSession: (options: {
      threadId: string
      cwd: string
      provider?: string
      model?: string
    }) => Promise<{ threadId: string; status: string }>
    stopSession: (threadId: string) => Promise<void>
    sendTurn: (threadId: string, input: string) => Promise<void>
    interrupt: (threadId: string) => Promise<void>
    respondRequest: (
      threadId: string,
      requestId: string,
      decision: string,
      value?: string
    ) => Promise<void>
    isSessionAlive: (threadId: string) => Promise<boolean>
    onEvent: (callback: (event: RuntimeEvent) => void) => () => void
  }

  config: {
    scan: (cwd: string) => Promise<ResolvedConfig>
    getSettings: () => Promise<PiSettings>
    saveSettings: (settings: PiSettings) => Promise<void>
    onChange: (callback: (config: ResolvedConfig) => void) => () => void
  }

  provider: {
    list: () => Promise<Provider[]>
    getApiKey: (provider: string) => Promise<string | null>
    setApiKey: (provider: string, key: string) => Promise<void>
    removeApiKey: (provider: string) => Promise<void>
    listCustom: () => Promise<Provider[]>
    addCustom: (provider: Provider) => Promise<void>
    updateCustom: (provider: Provider) => Promise<void>
    removeCustom: (providerName: string) => Promise<void>
    addCustomModel: (provider: string, model: Model) => Promise<void>
    removeCustomModel: (provider: string, modelId: string) => Promise<void>
    getCustomModels: (provider: string) => Promise<Model[]>
  }

  skill: {
    list: () => Promise<Skill[]>
    index: (cwd: string) => Promise<Skill[]>
    toggle: (name: string, enabled: boolean) => Promise<void>
    install: (source: PackageSource) => Promise<Skill>
  }

  session: {
    list: () => Promise<SessionSummary[]>
    listProject: (cwd: string) => Promise<SessionSummary[]>
    load: (filePath: string) => Promise<Session | null>
    create: (cwd: string, options?: any) => Promise<Session>
    delete: (filePath: string) => Promise<void>
  }

  installer: {
    isInstalled: () => Promise<boolean>
    getVersion: () => Promise<string | null>
    checkUpdates: () => Promise<{ currentVersion: string; latestVersion: string } | null>
    install: () => Promise<void>
    update: () => Promise<void>
  }

  settings: {
    getUI: () => Promise<{
      sidebarWidth: number
      sidebarOpen: boolean
      theme: string
      windowBounds: any
      binaryPath: string | null
      recentProjects: string[]
    }>
    setSidebarWidth: (width: number) => Promise<void>
    setSidebarOpen: (open: boolean) => Promise<void>
    setTheme: (theme: string) => Promise<void>
    setWindowBounds: (bounds: any) => Promise<void>
  }

  shell: {
    openExternal: (url: string) => Promise<void>
  }

  terminal: {
    create: (cwd: string, shell?: string) => Promise<string>
    write: (terminalId: string, data: string) => Promise<void>
    resize: (terminalId: string, cols: number, rows: number) => Promise<void>
    kill: (terminalId: string) => Promise<void>
    isAlive: (terminalId: string) => Promise<boolean>
    getCwd: (terminalId: string) => Promise<string | undefined>
    onData: (callback: (terminalId: string, data: string) => void) => () => void
  }

  app: {
    openInEditor: (cwd: string) => Promise<{ success: boolean; editor?: string; error?: string }>
    getEditor: () => Promise<string | null>
    setEditor: (command: string) => Promise<void>
  }

  onGlobalShortcut: (callback: (action: string) => void) => () => void

  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }

  files: {
    tree: (cwd: string) => Promise<any[]>
    readdir: (dirPath: string) => Promise<any[]>
    read: (filePath: string) => Promise<{ content: string; encoding: string } | null>
    stat: (filePath: string) => Promise<any>
  }

  notification: {
    onNotify: (callback: (msg: string, type: string) => void) => () => void
  }
}

declare global {
  interface Window {
    piStudio: PiStudioAPI
  }
}

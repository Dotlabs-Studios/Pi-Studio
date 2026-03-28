/**
 * Pi Studio - Preload Script
 *
 * Exposes a safe API to the renderer process via Context Bridge.
 * No Node.js APIs are directly exposed.
 */

import { contextBridge, ipcRenderer } from 'electron'

// ==========================================================================
// API Definition
// ==========================================================================

const piStudioAPI = {
  // ---- Project Management ----
  project: {
    open: () => ipcRenderer.invoke('project:open'),
    select: (cwd: string) => ipcRenderer.invoke('project:select', cwd),
    getRecent: () => ipcRenderer.invoke('project:recent'),
    create: (projectPath: string) => ipcRenderer.invoke('project:create', projectPath),
    onChange: (callback: (cwd: string) => void) => {
      const handler = (_event: any, cwd: string) => callback(cwd)
      ipcRenderer.on('project:changed', handler)
      return () => ipcRenderer.removeListener('project:changed', handler)
    },
  },

  // ---- Pi Runtime ----
  pi: {
    startSession: (options: { threadId: string; cwd: string; provider?: string; model?: string; sessionFilePath?: string; conversationId?: string }) =>
      ipcRenderer.invoke('pi:start-session', options),
    stopSession: (threadId: string) => ipcRenderer.invoke('pi:stop-session', threadId),
    sendTurn: (threadId: string, input: string) =>
      ipcRenderer.invoke('pi:send-turn', threadId, input),
    interrupt: (threadId: string) => ipcRenderer.invoke('pi:interrupt', threadId),
    respondRequest: (threadId: string, requestId: string, decision: string, value?: string) =>
      ipcRenderer.invoke('pi:respond-request', threadId, requestId, decision, value),
    isSessionAlive: (threadId: string) => ipcRenderer.invoke('pi:is-session-alive', threadId),
    onEvent: (callback: (event: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('runtime:event', handler)
      return () => ipcRenderer.removeListener('runtime:event', handler)
    },
  },

  // ---- Config ----
  config: {
    scan: (cwd: string) => ipcRenderer.invoke('config:scan', cwd),
    getSettings: () => ipcRenderer.invoke('config:get-settings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('config:save-settings', settings),
    onChange: (callback: (config: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('config:changed', handler)
      return () => ipcRenderer.removeListener('config:changed', handler)
    },
  },

  // ---- Provider ----
  provider: {
    list: () => ipcRenderer.invoke('provider:list'),
    getApiKey: (provider: string) => ipcRenderer.invoke('provider:get-api-key', provider),
    setApiKey: (provider: string, key: string) =>
      ipcRenderer.invoke('provider:set-api-key', provider, key),
    removeApiKey: (provider: string) => ipcRenderer.invoke('provider:remove-api-key', provider),
    listCustom: () => ipcRenderer.invoke('provider:list-custom'),
    addCustom: (provider: any) => ipcRenderer.invoke('provider:add-custom', provider),
    updateCustom: (provider: any) => ipcRenderer.invoke('provider:update-custom', provider),
    removeCustom: (providerName: string) => ipcRenderer.invoke('provider:remove-custom', providerName),
    addCustomModel: (provider: string, model: any) =>
      ipcRenderer.invoke('provider:add-custom-model', provider, model),
    removeCustomModel: (provider: string, modelId: string) =>
      ipcRenderer.invoke('provider:remove-custom-model', provider, modelId),
    getCustomModels: (provider: string) =>
      ipcRenderer.invoke('provider:get-custom-models', provider),
  },

  // ---- Skills ----
  skill: {
    list: () => ipcRenderer.invoke('skill:list'),
    index: (cwd: string) => ipcRenderer.invoke('skill:index', cwd),
    toggle: (name: string, enabled: boolean) =>
      ipcRenderer.invoke('skill:toggle', name, enabled),
    install: (source: any) => ipcRenderer.invoke('skill:install', source),
  },

  // ---- Sessions ----
  session: {
    list: () => ipcRenderer.invoke('session:list'),
    listProject: (cwd: string) => ipcRenderer.invoke('session:list-project', cwd),
    load: (filePath: string) => ipcRenderer.invoke('session:load', filePath),
    create: (cwd: string, options?: any) =>
      ipcRenderer.invoke('session:create', cwd, options),
    conversations: (filePath: string) => ipcRenderer.invoke('session:conversations', filePath),
    delete: (filePath: string) => ipcRenderer.invoke('session:delete', filePath),
  },

  // ---- Pi Binary ----
  installer: {
    isInstalled: () => ipcRenderer.invoke('pi:check-installed'),
    getVersion: () => ipcRenderer.invoke('pi:get-version'),
    checkUpdates: () => ipcRenderer.invoke('pi:check-updates'),
    install: () => ipcRenderer.invoke('pi:install'),
    update: () => ipcRenderer.invoke('pi:update'),
  },

  // ---- UI Settings ----
  settings: {
    getUI: () => ipcRenderer.invoke('settings:get-ui'),
    setSidebarWidth: (width: number) =>
      ipcRenderer.invoke('settings:set-sidebar-width', width),
    setSidebarOpen: (open: boolean) =>
      ipcRenderer.invoke('settings:set-sidebar-open', open),
    setTheme: (theme: string) => ipcRenderer.invoke('settings:set-theme', theme),
    setWindowBounds: (bounds: any) =>
      ipcRenderer.invoke('settings:set-window-bounds', bounds),
  },

  // ---- Utility ----
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // ---- Terminal ----
  terminal: {
    create: (cwd: string, shell?: string) => ipcRenderer.invoke('terminal:create', cwd, shell),
    write: (terminalId: string, data: string) => ipcRenderer.invoke('terminal:write', terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
    kill: (terminalId: string) => ipcRenderer.invoke('terminal:kill', terminalId),
    isAlive: (terminalId: string) => ipcRenderer.invoke('terminal:is-alive', terminalId),
    getCwd: (terminalId: string) => ipcRenderer.invoke('terminal:get-cwd', terminalId),
    onData: (callback: (terminalId: string, data: string) => void) => {
      const handler = (_event: any, msg: { terminalId: string; data: string }) =>
        callback(msg.terminalId, msg.data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
  },

  // ---- App Actions ----
  app: {
    openInEditor: (cwd: string) => ipcRenderer.invoke('app:open-in-editor', cwd),
    getEditor: () => ipcRenderer.invoke('settings:get-editor'),
    setEditor: (command: string) => ipcRenderer.invoke('settings:set-editor', command),
  },

  // ---- File Tree ----
  files: {
    tree: (cwd: string) => ipcRenderer.invoke('files:tree', cwd),
    readdir: (dirPath: string) => ipcRenderer.invoke('files:readdir', dirPath),
    read: (filePath: string) => ipcRenderer.invoke('files:read', filePath),
    stat: (filePath: string) => ipcRenderer.invoke('files:stat', filePath),
  },

  // ---- Notifications ----
  notification: {
    onNotify: (callback: (msg: string, type: string) => void) => {
      const handler = (_e: any, msg: string, type: string) => callback(msg, type)
      ipcRenderer.on('notification:show', handler)
      return () => ipcRenderer.removeListener('notification:show', handler)
    },
  },

  // ---- Global Shortcuts ----
  onGlobalShortcut: (callback: (action: string) => void) => {
    const handler = (_event: any, action: string) => callback(action)
    ipcRenderer.on('global-shortcut', handler)
    return () => ipcRenderer.removeListener('global-shortcut', handler)
  },

  // ---- Window Controls ----
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
}

// ==========================================================================
// Context Bridge
// ==========================================================================

contextBridge.exposeInMainWorld('piStudio', piStudioAPI)

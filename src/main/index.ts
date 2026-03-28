/**
 * Pi Studio - Main Process Entry Point
 *
 * Manages the BrowserWindow, IPC handlers, and application lifecycle.
 */

import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc-handlers'
import { piRuntime } from './core/pi-runtime'
import { terminalManager } from './core/terminal-manager'
import { settingsStore } from './core/settings-store'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const windowBounds = settingsStore.getWindowBounds()

  mainWindow = new BrowserWindow({
    width: windowBounds?.width ?? 1280,
    height: windowBounds?.height ?? 800,
    x: windowBounds?.x,
    y: windowBounds?.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false, // Custom title bar
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f0f23',
      symbolColor: '#a0a0c0',
      height: 36,
    },
    trafficLightPosition: { x: 12, y: 8 },
    backgroundColor: '#0f0f23',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Save window bounds on resize/move
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow!.getSize()
    settingsStore.setSidebarWidth(settingsStore.getSidebarWidth())
  })

  mainWindow.on('move', () => {
    const bounds = mainWindow!.getBounds()
    settingsStore.setWindowBounds(bounds)
  })

  mainWindow.on('close', async () => {
    // Save window state
    if (mainWindow) {
      settingsStore.setWindowBounds(mainWindow.getBounds())
    }

    // Stop all pi sessions
    await piRuntime.stopAll()
    terminalManager.killAll()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Show window when ready (prevents flash of unstyled content)
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Open DevTools in dev mode
  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// ==========================================================================
// App Lifecycle
// ==========================================================================

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.pi-studio.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers
  createWindow()
  if (mainWindow) {
    registerIpcHandlers(mainWindow)
  }

  // Register global shortcuts
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    // Toggle command palette (future feature)
    if (mainWindow) {
      mainWindow.webContents.send('global-shortcut', 'command-palette')
    }
  })

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    // Toggle sidebar
    if (mainWindow) {
      mainWindow.webContents.send('global-shortcut', 'toggle-sidebar')
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  piRuntime.stopAll()
  terminalManager.killAll()
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

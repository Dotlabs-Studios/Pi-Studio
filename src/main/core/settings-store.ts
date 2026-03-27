/**
 * Settings Store - Persistent settings management.
 *
 * Uses electron-store for safe, cross-platform JSON storage.
 * API keys are stored separately using keytar (OS keychain).
 *
 * Supports global settings + project-level overrides.
 */

// electron-store v10+ uses ESM default export
// When bundled by electron-vite with externalizeDepsPlugin, the import becomes require()
// We need to handle both CJS and ESM interop
const electronStoreModule = require('electron-store')
const Store = electronStoreModule.default || electronStoreModule
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

import type { PiSettings } from '../shared/types'

// ============================================================================
// Store Schema
// ============================================================================

interface StoreSchema {
  globalSettings: PiSettings
  projectOverrides: Record<string, PiSettings>
  recentProjects: string[]
  windowBounds: { x: number; y: number; width: number; height: number } | null
  sidebarWidth: number
  sidebarOpen: boolean
  activeTheme: string
  binaryPath: string | null
}

const DEFAULT_SETTINGS: PiSettings = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
  defaultThinkingLevel: 'medium',
  compaction: {
    enabled: true,
    reserveTokens: 2000,
    keepRecentTokens: 5000,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 1000,
  },
  packages: [],
  extensions: [],
  skills: [],
  prompts: [],
  themes: [],
}

// ============================================================================
// Settings Store Class
// ============================================================================

class SettingsStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'pi-studio-settings',
      defaults: {
        globalSettings: { ...DEFAULT_SETTINGS },
        projectOverrides: {},
        recentProjects: [],
        windowBounds: null,
        sidebarWidth: 280,
        sidebarOpen: true,
        activeTheme: 'dark',
        binaryPath: null,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Global Settings
  // ---------------------------------------------------------------------------

  getGlobalSettings(): PiSettings {
    return this.store.get('globalSettings', { ...DEFAULT_SETTINGS })
  }

  saveGlobalSettings(settings: PiSettings): void {
    this.store.set('globalSettings', settings)
  }

  // ---------------------------------------------------------------------------
  // Project Overrides
  // ---------------------------------------------------------------------------

  getProjectSettings(projectPath: string): PiSettings {
    const overrides = this.store.get('projectOverrides', {})
    return overrides[projectPath] ?? {}
  }

  saveProjectSettings(projectPath: string, settings: PiSettings): void {
    const overrides = this.store.get('projectOverrides', {})
    overrides[projectPath] = settings
    this.store.set('projectOverrides', overrides)
  }

  removeProjectSettings(projectPath: string): void {
    const overrides = this.store.get('projectOverrides', {})
    delete overrides[projectPath]
    this.store.set('projectOverrides', overrides)
  }

  /**
   * Merge global settings with project overrides.
   */
  getResolvedSettings(projectPath: string | null): PiSettings {
    const global = this.getGlobalSettings()
    if (!projectPath) return global

    const project = this.getProjectSettings(projectPath)
    return { ...global, ...project }
  }

  // ---------------------------------------------------------------------------
  // Recent Projects
  // ---------------------------------------------------------------------------

  getRecentProjects(): string[] {
    return this.store.get('recentProjects', [])
  }

  addRecentProject(projectPath: string): void {
    const recent = this.getRecentProjects()
    const filtered = recent.filter((p) => p !== projectPath)
    filtered.unshift(projectPath)
    // Keep only last 20
    this.store.set('recentProjects', filtered.slice(0, 20))
  }

  removeRecentProject(projectPath: string): void {
    const recent = this.getRecentProjects()
    this.store.set(
      'recentProjects',
      recent.filter((p) => p !== projectPath)
    )
  }

  // ---------------------------------------------------------------------------
  // Window State
  // ---------------------------------------------------------------------------

  getWindowBounds() {
    return this.store.get('windowBounds')
  }

  setWindowBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.store.set('windowBounds', bounds)
  }

  // ---------------------------------------------------------------------------
  // UI State
  // ---------------------------------------------------------------------------

  getSidebarWidth(): number {
    return this.store.get('sidebarWidth', 280)
  }

  setSidebarWidth(width: number): void {
    this.store.set('sidebarWidth', width)
  }

  isSidebarOpen(): boolean {
    return this.store.get('sidebarOpen', true)
  }

  setSidebarOpen(open: boolean): void {
    this.store.set('sidebarOpen', open)
  }

  getActiveTheme(): string {
    return this.store.get('activeTheme', 'dark')
  }

  setActiveTheme(theme: string): void {
    this.store.set('activeTheme', theme)
  }

  // ---------------------------------------------------------------------------
  // Pi Binary
  // ---------------------------------------------------------------------------

  getBinaryPath(): string | null {
    return this.store.get('binaryPath')
  }

  setBinaryPath(path: string): void {
    this.store.set('binaryPath', path)
  }
}

// ============================================================================
// Secure API Key Storage (using keytar)
// ============================================================================

const KEYTAR_SERVICE = 'pi-studio'

class SecureKeyStore {
  /**
   * Store an API key securely in the OS keychain.
   */
  async setApiKey(provider: string, key: string): Promise<void> {
    try {
      // Dynamic import because keytar is a native module
      const keytar = await import('keytar')
      await keytar.setPassword(KEYTAR_SERVICE, provider, key)
      console.log(`[SecureKeyStore] Saved key for ${provider}`)
    } catch (err) {
      console.error(`[SecureKeyStore] Failed to save key for ${provider}:`, err)
      // Fallback: save to file with restricted permissions (less secure)
      this.fallbackSave(provider, key)
    }
  }

  /**
   * Retrieve an API key from the OS keychain.
   */
  async getApiKey(provider: string): Promise<string | null> {
    try {
      const keytar = await import('keytar')
      const key = await keytar.getPassword(KEYTAR_SERVICE, provider)
      if (key) return key

      // Check fallback
      return this.fallbackRead(provider)
    } catch (err) {
      console.error(`[SecureKeyStore] Failed to read key for ${provider}:`, err)
      return this.fallbackRead(provider)
    }
  }

  /**
   * Remove an API key from the OS keychain.
   */
  async removeApiKey(provider: string): Promise<void> {
    try {
      const keytar = await import('keytar')
      await keytar.deletePassword(KEYTAR_SERVICE, provider)
    } catch (err) {
      console.error(`[SecureKeyStore] Failed to delete key for ${provider}:`, err)
    }
    this.fallbackDelete(provider)
  }

  // Fallback: store encrypted keys in a file (less secure, but works without keytar)
  private getFallbackPath(): string {
    const configDir = path.join(os.homedir(), '.pi-studio')
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    return path.join(configDir, 'api-keys.enc.json')
  }

  private readFallbackFile(): Record<string, string> {
    try {
      const filePath = this.getFallbackPath()
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8')
        return JSON.parse(data)
      }
    } catch {
      // Ignore
    }
    return {}
  }

  private fallbackSave(provider: string, key: string): void {
    try {
      const keys = this.readFallbackFile()
      // Simple base64 encoding (NOT real encryption — just obfuscation)
      keys[provider] = Buffer.from(key).toString('base64')
      fs.writeFileSync(this.getFallbackPath(), JSON.stringify(keys, null, 2), {
        mode: 0o600,
      })
    } catch (err) {
      console.error('[SecureKeyStore] Fallback save failed:', err)
    }
  }

  private fallbackRead(provider: string): string | null {
    try {
      const keys = this.readFallbackFile()
      const encoded = keys[provider]
      if (encoded) {
        return Buffer.from(encoded, 'base64').toString('utf-8')
      }
    } catch {
      // Ignore
    }
    return null
  }

  private fallbackDelete(provider: string): void {
    try {
      const keys = this.readFallbackFile()
      delete keys[provider]
      if (Object.keys(keys).length === 0) {
        const filePath = this.getFallbackPath()
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } else {
        fs.writeFileSync(this.getFallbackPath(), JSON.stringify(keys, null, 2), {
          mode: 0o600,
        })
      }
    } catch {
      // Ignore
    }
  }
}

// Singleton exports
export const settingsStore = new SettingsStore()
export const secureKeyStore = new SecureKeyStore()

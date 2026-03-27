/**
 * Provider Manager - Manages AI providers and their API keys.
 *
 * Built-in provider definitions with model lists.
 * Supports user-defined custom providers persisted via settings-store.
 * API keys stored securely via SecureKeyStore.
 */

import { secureKeyStore, settingsStore } from './settings-store'
import type { Provider, Model } from '../shared/types'

// ============================================================================
// Built-in Providers
// ============================================================================

const BUILT_IN_PROVIDERS: Provider[] = [
  {
    name: 'anthropic',
    displayName: 'Anthropic',
    authType: 'api-key',
    requiresAuth: true,
    setupDocs: 'https://console.anthropic.com/account/keys',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', maxTokens: 64000, supportsThinking: true },
      { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', provider: 'anthropic', maxTokens: 64000, supportsThinking: true },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', maxTokens: 8192 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', maxTokens: 8192 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', maxTokens: 4096 },
    ],
  },
  {
    name: 'openai',
    displayName: 'OpenAI',
    authType: 'api-key',
    requiresAuth: true,
    setupDocs: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', maxTokens: 16384 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', maxTokens: 16384 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', maxTokens: 4096 },
      { id: 'o1', name: 'o1', provider: 'openai', maxTokens: 32768 },
      { id: 'o1-mini', name: 'o1 Mini', provider: 'openai', maxTokens: 65536 },
      { id: 'o3-mini', name: 'o3 Mini', provider: 'openai', maxTokens: 65536 },
    ],
  },
  {
    name: 'google',
    displayName: 'Google AI',
    authType: 'api-key',
    requiresAuth: true,
    setupDocs: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', maxTokens: 65536 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', maxTokens: 65536 },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', maxTokens: 8192 },
    ],
  },
  {
    name: 'azure',
    displayName: 'Azure OpenAI',
    authType: 'api-key',
    requiresAuth: true,
    setupDocs: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (Azure)', provider: 'azure', maxTokens: 16384 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Azure)', provider: 'azure', maxTokens: 16384 },
    ],
  },
  {
    name: 'groq',
    displayName: 'Groq',
    authType: 'api-key',
    requiresAuth: true,
    setupDocs: 'https://console.groq.com/keys',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', maxTokens: 32768 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', provider: 'groq', maxTokens: 8192 },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', provider: 'groq', maxTokens: 32768 },
    ],
  },
  {
    name: 'xai',
    displayName: 'xAI (Grok)',
    authType: 'api-key',
    requiresAuth: true,
    setupDocs: 'https://console.x.ai/',
    models: [
      { id: 'grok-3', name: 'Grok 3', provider: 'xai', maxTokens: 32768 },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', provider: 'xai', maxTokens: 32768 },
    ],
  },
  {
    name: 'openrouter',
    displayName: 'OpenRouter',
    authType: 'api-key',
    requiresAuth: true,
    setupDocs: 'https://openrouter.ai/keys',
    models: [
      { id: 'openrouter/auto', name: 'Auto (Recommended)', provider: 'openrouter' },
    ],
  },
  {
    name: 'ollama',
    displayName: 'Ollama (Local)',
    authType: 'subscription',
    requiresAuth: false,
    setupDocs: 'https://ollama.ai',
    models: [
      { id: 'llama3', name: 'Llama 3', provider: 'ollama', maxTokens: 8192 },
      { id: 'codellama', name: 'Code Llama', provider: 'ollama', maxTokens: 16384 },
      { id: 'mistral', name: 'Mistral', provider: 'ollama', maxTokens: 8192 },
    ],
  },
]

// Known env var mapping for built-in providers
const BUILT_IN_ENV_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

// ============================================================================
// Provider Manager Class
// ============================================================================

class ProviderManager {
  /** Additional custom models keyed by provider name (built-in or custom). */
  private customModels: Map<string, Model[]> = new Map()

  constructor() {
    this.loadCustomProviders()
  }

  // ---------------------------------------------------------------------------
  // Custom Provider Persistence
  // ---------------------------------------------------------------------------

  /**
   * Load custom providers from settings-store.
   */
  private loadCustomProviders(): void {
    const settings = settingsStore.getGlobalSettings()
    const customProviders: Provider[] = settings.customProviders ?? []
    for (const p of customProviders) {
      // Restore provider reference on each model
      p.models = p.models.map((m) => ({ ...m, provider: p.name }))
    }
  }

  /**
   * Get the persisted custom providers list.
   */
  private getCustomProviders(): Provider[] {
    const settings = settingsStore.getGlobalSettings()
    return (settings.customProviders ?? []).map((p) => ({
      ...p,
      isCustom: true,
      models: p.models.map((m) => ({ ...m, provider: p.name })),
    }))
  }

  /**
   * Persist custom providers to settings-store.
   */
  private saveCustomProviders(providers: Provider[]): void {
    const settings = settingsStore.getGlobalSettings()
    // Strip isCustom flag before persisting
    const clean = providers.map(({ isCustom, ...rest }) => ({
      ...rest,
      models: (rest.models ?? []).map((m) => ({ ...m })),
    }))
    settingsStore.saveGlobalSettings({ ...settings, customProviders: clean })
  }

  // ---------------------------------------------------------------------------
  // Provider Listing
  // ---------------------------------------------------------------------------

  /**
   * List all available providers (built-in + custom).
   */
  listProviders(): Provider[] {
    const builtIn = BUILT_IN_PROVIDERS.map((p) => ({
      ...p,
      models: [...p.models, ...(this.customModels.get(p.name) ?? [])],
    }))
    const custom = this.getCustomProviders().map((p) => ({
      ...p,
      models: [...(p.models ?? []), ...(this.customModels.get(p.name) ?? [])],
    }))
    return [...builtIn, ...custom]
  }

  /**
   * List only built-in providers.
   */
  listBuiltInProviders(): Provider[] {
    return BUILT_IN_PROVIDERS.map((p) => ({
      ...p,
      models: [...p.models, ...(this.customModels.get(p.name) ?? [])],
    }))
  }

  /**
   * List only custom providers.
   */
  listCustomProviders(): Provider[] {
    return this.getCustomProviders()
  }

  /**
   * Get a specific provider by name (built-in or custom).
   */
  getProvider(name: string): Provider | undefined {
    return this.listProviders().find((p) => p.name === name)
  }

  /**
   * List models for a specific provider.
   */
  listModels(providerName: string): Model[] {
    const provider = this.getProvider(providerName)
    return provider?.models ?? []
  }

  /**
   * Get a specific model.
   */
  getModel(providerName: string, modelId: string): Model | undefined {
    return this.listModels(providerName).find((m) => m.id === modelId)
  }

  // ---------------------------------------------------------------------------
  // Custom Provider CRUD
  // ---------------------------------------------------------------------------

  /**
   * Add a custom provider.
   */
  addCustomProvider(provider: Provider): void {
    const existing = this.getCustomProviders()
    if (existing.find((p) => p.name === provider.name)) {
      throw new Error(`Provider "${provider.name}" already exists`)
    }
    existing.push({ ...provider, isCustom: true })
    this.saveCustomProviders(existing)
  }

  /**
   * Update a custom provider.
   */
  updateCustomProvider(provider: Provider): void {
    const existing = this.getCustomProviders()
    const idx = existing.findIndex((p) => p.name === provider.name)
    if (idx === -1) throw new Error(`Custom provider "${provider.name}" not found`)
    existing[idx] = { ...provider, isCustom: true }
    this.saveCustomProviders(existing)
  }

  /**
   * Remove a custom provider.
   */
  removeCustomProvider(providerName: string): void {
    const existing = this.getCustomProviders()
    const filtered = existing.filter((p) => p.name !== providerName)
    if (filtered.length === existing.length) {
      throw new Error(`Custom provider "${providerName}" not found`)
    }
    this.saveCustomProviders(filtered)
    // Also remove any custom models for this provider
    this.customModels.delete(providerName)
    // Remove the API key too
    secureKeyStore.removeApiKey(providerName).catch(() => {})
  }

  // ---------------------------------------------------------------------------
  // Custom Models (per-provider)
  // ---------------------------------------------------------------------------

  /**
   * Add a custom model to a provider (built-in or custom).
   */
  addCustomModel(provider: string, model: Model): void {
    const existing = this.customModels.get(provider) ?? []
    if (!existing.find((m) => m.id === model.id)) {
      existing.push({ ...model, provider })
      this.customModels.set(provider, existing)
      // Persist custom models in settings
      this.saveCustomModels()
    }
  }

  /**
   * Remove a custom model.
   */
  removeCustomModel(provider: string, modelId: string): void {
    const existing = this.customModels.get(provider) ?? []
    this.customModels.set(
      provider,
      existing.filter((m) => m.id !== modelId)
    )
    this.saveCustomModels()
  }

  /**
   * Get custom models for a provider.
   */
  getCustomModels(provider: string): Model[] {
    return this.customModels.get(provider) ?? []
  }

  /**
   * Persist custom models to settings-store.
   */
  private saveCustomModels(): void {
    const settings = settingsStore.getGlobalSettings()
    // Convert Map to serializable object
    const obj: Record<string, Model[]> = {}
    for (const [provider, models] of this.customModels.entries()) {
      obj[provider] = models
    }
    settingsStore.saveGlobalSettings({ ...settings, customModels: obj })
  }

  /**
   * Load custom models from settings-store.
   */
  private loadCustomModels(): void {
    const settings = settingsStore.getGlobalSettings()
    const obj = (settings as any).customModels as Record<string, Model[]> | undefined
    if (obj) {
      for (const [provider, models] of Object.entries(obj)) {
        this.customModels.set(provider, models.map((m) => ({ ...m, provider })))
      }
    }
  }

  // ---------------------------------------------------------------------------
  // API Keys
  // ---------------------------------------------------------------------------

  /**
   * Store an API key securely.
   */
  async setApiKey(provider: string, key: string): Promise<void> {
    await secureKeyStore.setApiKey(provider, key)
  }

  /**
   * Retrieve an API key.
   */
  async getApiKey(provider: string): Promise<string | null> {
    return secureKeyStore.getApiKey(provider)
  }

  /**
   * Remove an API key.
   */
  async removeApiKey(provider: string): Promise<void> {
    await secureKeyStore.removeApiKey(provider)
  }

  /**
   * Check if a provider has a configured API key.
   */
  async hasApiKey(provider: string): Promise<boolean> {
    const key = await this.getApiKey(provider)
    return key !== null && key.length > 0
  }

  // ---------------------------------------------------------------------------
  // Environment Export
  // ---------------------------------------------------------------------------

  /**
   * Export environment variables for a pi child process.
   */
  async exportEnvForProcess(selectedProvider?: string): Promise<Record<string, string>> {
    const env: Record<string, string> = {}

    // Pass through known API key env vars from the parent process
    for (const [provider, envVar] of Object.entries(BUILT_IN_ENV_MAP)) {
      const value = process.env[envVar]
      if (value) env[envVar] = value
    }

    // Also pass through custom provider env vars from process.env
    const customProviders = this.getCustomProviders()
    for (const cp of customProviders) {
      if (cp.envVar && process.env[cp.envVar]) {
        env[cp.envVar] = process.env[cp.envVar]
      }
    }

    // Check secure store for the selected provider
    if (selectedProvider) {
      const key = await this.getApiKey(selectedProvider)
      if (key) {
        // Check built-in env var map first
        const envVar = BUILT_IN_ENV_MAP[selectedProvider]
        if (envVar) {
          env[envVar] = key
        } else {
          // Custom provider: use its envVar or fall back to PROVIDER_NAME_API_KEY
          const custom = customProviders.find((p) => p.name === selectedProvider)
          const keyEnvVar = custom?.envVar ?? `${selectedProvider.toUpperCase()}_API_KEY`
          env[keyEnvVar] = key
        }
      }
    }

    return env
  }
}

// Singleton
export const providerManager = new ProviderManager()

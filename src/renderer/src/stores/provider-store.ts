/**
 * Provider Store - Manages AI provider and model selection.
 *
 * Selections are persisted to PiSettings (defaultProvider / defaultModel)
 * so they survive app restarts.
 */

import { create } from 'zustand'
import type { Provider, Model } from '../../../shared/types'

interface ProviderState {
  providers: Provider[]
  selectedProvider: string | null
  selectedModel: string | null
  isLoaded: boolean

  setProviders: (providers: Provider[]) => void
  setSelectedProvider: (provider: string | null) => void
  setSelectedModel: (model: string | null) => void
  getSelectedModel: () => Model | undefined
  reloadProviders: () => Promise<void>
  restoreSelection: (provider: string | null, model: string | null) => void
}

/** Persist selection to PiSettings (debounced). */
let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistSelection(provider: string | null, model: string | null) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(async () => {
    try {
      const settings = await window.piStudio.config.getSettings()
      window.piStudio.config.saveSettings({
        ...settings,
        defaultProvider: provider ?? undefined,
        defaultModel: model ?? undefined,
      })
    } catch { /* ignore */ }
    persistTimer = null
  }, 300)
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  selectedProvider: null,
  selectedModel: null,
  isLoaded: false,

  setProviders: (providers) => {
    set({ providers, isLoaded: true })
    const state = get()
    // Set defaults only if nothing was restored
    if (!state.selectedProvider && providers.length > 0) {
      const defaultProvider = providers.find((p) => p.name === 'anthropic') ?? providers[0]
      set({ selectedProvider: defaultProvider.name })
      if (!state.selectedModel && defaultProvider.models.length > 0) {
        set({ selectedModel: defaultProvider.models[0].id })
      }
    }
  },

  setSelectedProvider: (provider) => {
    const state = get()
    const newProvider = state.providers.find((p) => p.name === provider)
    const firstModel = newProvider?.models?.[0]?.id ?? null
    set({ selectedProvider: provider, selectedModel: firstModel })
    persistSelection(provider, firstModel)
  },

  setSelectedModel: (model) => {
    const { selectedProvider } = get()
    set({ selectedModel: model })
    persistSelection(selectedProvider, model)
  },

  restoreSelection: (provider, model) => {
    const state = get()
    if (!state.isLoaded) {
      // Store temporarily, will be applied when providers load
      set({ selectedProvider: provider, selectedModel: model })
      return
    }
    if (provider) {
      const exists = state.providers.find((p) => p.name === provider)
      if (exists) {
        const modelExists = model && exists.models.find((m) => m.id === model)
        set({
          selectedProvider: provider,
          selectedModel: modelExists ? model : exists.models[0]?.id ?? null,
        })
      }
    }
  },

  reloadProviders: async () => {
    try {
      const providers = await window.piStudio.provider.list()
      const state = get()
      set({ providers, isLoaded: true })
      const stillExists = providers.find((p) => p.name === state.selectedProvider)
      if (!stillExists && providers.length > 0) {
        const def = providers.find((p) => p.name === 'anthropic') ?? providers[0]
        set({ selectedProvider: def.name, selectedModel: def.models?.[0]?.id ?? null })
        persistSelection(def.name, def.models?.[0]?.id ?? null)
      } else if (stillExists) {
        const modelExists = stillExists.models.find((m) => m.id === state.selectedModel)
        if (!modelExists) {
          const newModel = stillExists.models[0]?.id ?? null
          set({ selectedModel: newModel })
          persistSelection(state.selectedProvider, newModel)
        }
      }
    } catch (err) {
      console.error('Failed to reload providers:', err)
    }
  },

  getSelectedModel: () => {
    const state = get()
    if (!state.selectedProvider || !state.selectedModel) return undefined
    const provider = state.providers.find((p) => p.name === state.selectedProvider)
    return provider?.models.find((m) => m.id === state.selectedModel)
  },
}))

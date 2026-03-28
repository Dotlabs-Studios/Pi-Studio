/**
 * Settings Modal - Full settings editor.
 *
 * Tabs: Providers | Custom Providers | Models | General | Pi CLI
 */

import React, { useEffect, useState } from 'react'
import {
  X,
  Key,
  Palette,
  Terminal,
  Shield,
  RefreshCw,
  ExternalLink,
  Save,
  Plus,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  Server,
  Cpu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import { ScrollArea, Separator, Badge, Dialog, DialogHeader, DialogTitle } from '@/components/ui/primitives'
import { useUIStore } from '@/stores/ui-store'
import { useToastStore } from '@/stores/toast-store'
import type { Provider, Model, PiSettings } from '../../../shared/types'

// ============================================================================
// Main Settings Modal
// ============================================================================

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useUIStore()
  const [activeTab, setActiveTab] = useState<'providers' | 'custom' | 'models' | 'general' | 'pi'>('providers')
  const [settings, setSettings] = useState<PiSettings | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [customProviders, setCustomProviders] = useState<Provider[]>([])
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const { addToast } = useToastStore()

  useEffect(() => {
    if (settingsOpen) {
      loadSettings()
      loadProviders()
    }
  }, [settingsOpen])

  const loadSettings = async () => {
    const s = await window.piStudio.config.getSettings()
    setSettings(s)
  }

  const loadProviders = async () => {
    const [p, c] = await Promise.all([
      window.piStudio.provider.list(),
      window.piStudio.provider.listCustom(),
    ])
    setProviders(p)
    setCustomProviders(c)

    // Load existing API keys for all providers
    const keys: Record<string, string> = {}
    for (const provider of [...p, ...c]) {
      const key = await window.piStudio.provider.getApiKey(provider.name)
      if (key) keys[provider.name] = '••••••••'
    }
    setApiKeys(keys)
  }

  const handleSaveApiKey = async (providerName: string, key: string) => {
    if (!key || key === '••••••••') return
    try {
      await window.piStudio.provider.setApiKey(providerName, key)
      setApiKeys((prev) => ({ ...prev, [providerName]: '••••••••' }))
      addToast(`${providerName} API key saved`, 'success')
    } catch (err: any) {
      addToast(`Failed: ${err.message}`, 'error')
    }
  }

  const handleRemoveApiKey = async (providerName: string) => {
    await window.piStudio.provider.removeApiKey(providerName)
    setApiKeys((prev) => {
      const next = { ...prev }
      delete next[providerName]
      return next
    })
  }

  const handleSaveSettings = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await window.piStudio.config.saveSettings(settings)
      addToast('Settings saved', 'success')
    } catch (err) {
      addToast('Failed to save settings', 'error')
    }
    setSaving(false)
  }

  const updateSettings = (partial: Partial<PiSettings>) => {
    if (!settings) return
    setSettings({ ...settings, ...partial })
  }

  const tabs = [
    { id: 'providers' as const, label: 'Providers', icon: Key },
    { id: 'custom' as const, label: 'Custom Providers', icon: Server },
    { id: 'models' as const, label: 'Custom Models', icon: Cpu },
    { id: 'general' as const, label: 'General', icon: Palette },
    { id: 'pi' as const, label: 'Pi CLI', icon: Terminal },
  ]

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen} size="xl">
      <div className="flex flex-col h-[85vh]">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-0">
          <div className="flex items-center justify-between">
            <DialogTitle>Settings</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSettingsOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 px-6 py-3 overflow-x-auto border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                activeTab === tab.id
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <ScrollArea className="flex-1 px-6 py-4">
          {activeTab === 'providers' && (
            <ProvidersTab
              providers={providers}
              apiKeys={apiKeys}
              onSaveKey={handleSaveApiKey}
              onRemoveKey={handleRemoveApiKey}
            />
          )}
          {activeTab === 'custom' && (
            <CustomProvidersTab
              customProviders={customProviders}
              apiKeys={apiKeys}
              onRefresh={loadProviders}
              onSaveKey={handleSaveApiKey}
              onRemoveKey={handleRemoveApiKey}
            />
          )}
          {activeTab === 'models' && (
            <CustomModelsTab
              providers={providers}
              onRefresh={loadProviders}
            />
          )}
          {activeTab === 'general' && settings && (
            <GeneralTab settings={settings} onUpdate={updateSettings} />
          )}
          {activeTab === 'pi' && <PiTab />}
        </ScrollArea>

        {/* Footer */}
        {activeTab === 'general' && (
          <div className="flex justify-end px-6 py-4 border-t border-border">
            <Button onClick={handleSaveSettings} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

// ============================================================================
// Providers Tab — Built-in providers with API key management
// ============================================================================

function ProvidersTab({
  providers,
  apiKeys,
  onSaveKey,
  onRemoveKey,
}: {
  providers: Provider[]
  apiKeys: Record<string, string>
  onSaveKey: (provider: string, key: string) => void
  onRemoveKey: (provider: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const builtIn = providers.filter((p) => !p.isCustom)

  return (
    <div className="space-y-3 pb-4">
      <p className="text-sm text-muted-foreground">
        Configure API keys for built-in AI providers. Keys are stored securely in your OS keychain.
      </p>

      {builtIn.map((provider) => (
        <div
          key={provider.name}
          className="rounded-xl border border-border bg-background/50 overflow-hidden"
        >
          {/* Header row */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setExpanded(expanded === provider.name ? null : provider.name)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded === provider.name ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
              <span className="text-sm font-medium">{provider.displayName}</span>
              <Badge variant="outline" className="text-[10px]">
                {provider.models.length} models
              </Badge>
            </div>
            {apiKeys[provider.name] ? (
              <Badge variant="success" className="text-[10px]">
                <Shield className="w-3 h-3 mr-1" />
                Configured
              </Badge>
            ) : provider.requiresAuth ? (
              <Badge variant="destructive" className="text-[10px]">
                Required
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                Optional
              </Badge>
            )}
          </div>

          {/* Expandable content */}
          {expanded === provider.name && (
            <div className="px-4 pb-4 pt-1 border-t border-border/50 space-y-3">
              {/* Models list */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Available Models</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {provider.models.map((model) => (
                    <div key={model.id} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/30 text-xs">
                      <span className="font-medium text-foreground">{model.name}</span>
                      <span className="text-muted-foreground font-mono text-[11px]">{model.id}</span>
                      {model.supportsThinking && (
                        <Badge variant="secondary" className="text-[9px] ml-auto">thinking</Badge>
                      )}
                      {model.maxTokens && (
                        <span className="text-muted-foreground text-[10px] ml-auto">{(model.maxTokens / 1000).toFixed(0)}k ctx</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* API key input */}
              {provider.requiresAuth && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">API Key</p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        placeholder="sk-..."
                        defaultValue={apiKeys[provider.name] || ''}
                        className="h-9 text-sm flex-1"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onSaveKey(provider.name, (e.target as HTMLInputElement).value)
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-9"
                        onClick={(e) => {
                          const input = e.currentTarget.parentElement?.querySelector('input')
                          if (input) onSaveKey(provider.name, input.value)
                        }}
                      >
                        Save
                      </Button>
                      {apiKeys[provider.name] && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 text-destructive hover:text-destructive"
                          onClick={() => onRemoveKey(provider.name)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Setup docs link */}
              {provider.setupDocs && (
                <a
                  href={provider.setupDocs}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  onClick={(e) => {
                    e.preventDefault()
                    window.piStudio.shell.openExternal(provider.setupDocs!)
                  }}
                >
                  Get API key <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Custom Providers Tab — Add / Edit / Remove user-defined providers
// ============================================================================

function CustomProvidersTab({
  customProviders,
  apiKeys,
  onRefresh,
  onSaveKey,
  onRemoveKey,
}: {
  customProviders: Provider[]
  apiKeys: Record<string, string>
  onRefresh: () => void
  onSaveKey: (provider: string, key: string) => void
  onRemoveKey: (provider: string) => void
}) {
  const { addToast } = useToastStore()
  const [editing, setEditing] = useState<Provider | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [isEdit, setIsEdit] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDisplayName, setFormDisplayName] = useState('')
  const [formBaseUrl, setFormBaseUrl] = useState('')
  const [formEnvVar, setFormEnvVar] = useState('')
  const [formRequiresAuth, setFormRequiresAuth] = useState(true)
  const [formAuthType, setFormAuthType] = useState<'api-key' | 'oauth' | 'subscription'>('api-key')
  const [formModels, setFormModels] = useState<{ id: string; name: string; maxTokens?: number }[]>([])

  const resetForm = () => {
    setFormName('')
    setFormDisplayName('')
    setFormBaseUrl('')
    setFormEnvVar('')
    setFormRequiresAuth(true)
    setFormAuthType('api-key')
    setFormModels([])
    setShowForm(false)
    setIsEdit(false)
    setEditing(null)
  }

  const startAdd = () => {
    resetForm()
    setShowForm(true)
    setIsEdit(false)
  }

  const startEdit = (provider: Provider) => {
    setEditing(provider)
    setFormName(provider.name)
    setFormDisplayName(provider.displayName)
    setFormBaseUrl(provider.baseUrl ?? '')
    setFormEnvVar(provider.envVar ?? '')
    setFormRequiresAuth(provider.requiresAuth)
    setFormAuthType(provider.authType)
    setFormModels(provider.models.map((m) => ({ id: m.id, name: m.name, maxTokens: m.maxTokens })))
    setShowForm(true)
    setIsEdit(true)
  }

  const handleSave = async () => {
    // Sanitize name: lowercase, no spaces
    const name = formName.trim().toLowerCase().replace(/\s+/g, '-')
    if (!name) {
      addToast('Provider name is required', 'error')
      return
    }
    if (!formDisplayName.trim()) {
      addToast('Display name is required', 'error')
      return
    }

    const provider: Provider = {
      name,
      displayName: formDisplayName.trim(),
      authType: formAuthType,
      requiresAuth: formRequiresAuth,
      isCustom: true,
      baseUrl: formBaseUrl.trim() || undefined,
      envVar: formEnvVar.trim() || undefined,
      models: formModels.map((m) => ({
        id: m.id,
        name: m.name,
        provider: name,
        maxTokens: m.maxTokens,
      })),
    }

    try {
      if (isEdit && editing) {
        if (typeof window.piStudio.provider.updateCustom !== 'function') {
          addToast('App needs restart to load new features. Please restart Pi Studio.', 'warning')
          return
        }
        await window.piStudio.provider.updateCustom(provider)
        addToast(`Provider "${name}" updated`, 'success')
      } else {
        if (typeof window.piStudio.provider.addCustom !== 'function') {
          addToast('App needs restart to load new features. Please restart Pi Studio.', 'warning')
          return
        }
        await window.piStudio.provider.addCustom(provider)
        addToast(`Provider "${name}" added`, 'success')
      }
      resetForm()
      onRefresh()
    } catch (err: any) {
      addToast(err.message, 'error')
    }
  }

  const handleDelete = async (name: string) => {
    try {
      if (typeof window.piStudio.provider.removeCustom !== 'function') {
        addToast('App needs restart to load new features.', 'warning')
        return
      }
      await window.piStudio.provider.removeCustom(name)
      addToast(`Provider "${name}" removed`, 'success')
      onRefresh()
    } catch (err: any) {
      addToast(err.message, 'error')
    }
  }

  const addModelRow = () => {
    setFormModels([...formModels, { id: '', name: '' }])
  }

  const removeModelRow = (idx: number) => {
    setFormModels(formModels.filter((_, i) => i !== idx))
  }

  const updateModelRow = (idx: number, field: 'id' | 'name' | 'maxTokens', value: string) => {
    const updated = [...formModels]
    if (field === 'maxTokens') {
      updated[idx] = { ...updated[idx], maxTokens: value ? parseInt(value) : undefined }
    } else {
      updated[idx] = { ...updated[idx], [field]: value }
    }
    setFormModels(updated)
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Add custom AI providers not included in the built-in list.
            These providers will be available in the header dropdown alongside built-ins.
          </p>
        </div>
        {!showForm && (
          <Button size="sm" onClick={startAdd}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Provider
          </Button>
        )}
      </div>

      {/* Existing custom providers */}
      {customProviders.length > 0 && (
        <div className="space-y-2">
          {customProviders.map((provider) => (
            <div
              key={provider.name}
              className="rounded-xl border border-border bg-background/50 px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Server className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{provider.displayName}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{provider.name}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {provider.models.length} models
                  </Badge>
                  {provider.baseUrl && (
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      {provider.baseUrl}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {apiKeys[provider.name] ? (
                    <Badge variant="success" className="text-[10px]">
                      <Shield className="w-3 h-3 mr-1" />
                      Key set
                    </Badge>
                  ) : provider.requiresAuth ? (
                    <Badge variant="warning" className="text-[10px]">
                      No key
                    </Badge>
                  ) : null}
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => startEdit(provider)}>
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(provider.name)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Models list */}
              {provider.models.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 grid grid-cols-1 gap-1">
                  {provider.models.map((model) => (
                    <div key={model.id} className="flex items-center gap-2 px-2 py-1 rounded bg-secondary/20 text-xs">
                      <span className="font-medium">{model.name}</span>
                      <span className="text-muted-foreground font-mono text-[11px]">{model.id}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* API key */}
              {provider.requiresAuth && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      placeholder={provider.envVar ? `${provider.envVar}` : 'API key...'}
                      defaultValue={apiKeys[provider.name] || ''}
                      className="h-8 text-xs flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onSaveKey(provider.name, (e.target as HTMLInputElement).value)
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 text-xs"
                      onClick={(e) => {
                        const input = e.currentTarget.parentElement?.querySelector('input')
                        if (input) onSaveKey(provider.name, input.value)
                      }}
                    >
                      Save
                    </Button>
                    {apiKeys[provider.name] && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-destructive"
                        onClick={() => onRemoveKey(provider.name)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!showForm && customProviders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Server className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No custom providers configured.</p>
          <p className="text-xs mt-1">Add a provider to use custom AI services with pi CLI.</p>
        </div>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div className="rounded-xl border border-primary/30 bg-background p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {isEdit ? <Edit3 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {isEdit ? 'Edit Custom Provider' : 'New Custom Provider'}
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Provider ID *"
              placeholder="my-provider"
              value={formName}
              onChange={(e) => setFormName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              className="font-mono text-sm"
              disabled={isEdit}
              hint={isEdit ? 'Cannot change provider ID after creation' : 'Lowercase, dashes only. Used in pi config.'}
            />
            <Input
              label="Display Name *"
              placeholder="My AI Provider"
              value={formDisplayName}
              onChange={(e) => setFormDisplayName(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Base URL"
              placeholder="https://api.example.com/v1"
              value={formBaseUrl}
              onChange={(e) => setFormBaseUrl(e.target.value)}
              className="font-mono text-sm"
              hint="API endpoint base URL (optional)"
            />
            <Input
              label="Env Variable for API Key"
              placeholder="MY_PROVIDER_API_KEY"
              value={formEnvVar}
              onChange={(e) => setFormEnvVar(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
              className="font-mono text-sm"
              hint="Environment variable injected into pi process"
            />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={formRequiresAuth}
                onCheckedChange={setFormRequiresAuth}
              />
              <span className="text-sm">Requires API Key</span>
            </div>
            {formRequiresAuth && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Auth type:</span>
                <select
                  value={formAuthType}
                  onChange={(e) => setFormAuthType(e.target.value as any)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="api-key">API Key</option>
                  <option value="oauth">OAuth</option>
                  <option value="subscription">Subscription</option>
                </select>
              </div>
            )}
          </div>

          {/* Models */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Models</p>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addModelRow}>
                <Plus className="w-3 h-3 mr-1" />
                Add Model
              </Button>
            </div>
            {formModels.length > 0 ? (
              <div className="space-y-2">
                {formModels.map((model, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      placeholder="Model ID (e.g. my-model-v1)"
                      value={model.id}
                      onChange={(e) => updateModelRow(idx, 'id', e.target.value)}
                      className="h-8 text-xs flex-1 font-mono"
                    />
                    <Input
                      placeholder="Display name"
                      value={model.name}
                      onChange={(e) => updateModelRow(idx, 'name', e.target.value)}
                      className="h-8 text-xs flex-1"
                    />
                    <Input
                      type="number"
                      placeholder="Max tokens"
                      value={model.maxTokens ?? ''}
                      onChange={(e) => updateModelRow(idx, 'maxTokens', e.target.value)}
                      className="h-8 text-xs w-24"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => removeModelRow(idx)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">
                No models added yet. You can also add models later in the "Custom Models" tab.
              </p>
            )}
          </div>

          {/* Form actions */}
          <Separator />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {isEdit ? 'Update Provider' : 'Create Provider'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Custom Models Tab — Add custom models to any provider
// ============================================================================

function CustomModelsTab({
  providers,
  onRefresh,
}: {
  providers: Provider[]
  onRefresh: () => void
}) {
  const { addToast } = useToastStore()
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [customModels, setCustomModels] = useState<Model[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  // New model form
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newModelMaxTokens, setNewModelMaxTokens] = useState('')

  useEffect(() => {
    if (selectedProvider) {
      loadCustomModels(selectedProvider)
    } else {
      setCustomModels([])
    }
  }, [selectedProvider])

  const loadCustomModels = async (provider: string) => {
    const models = await window.piStudio.provider.getCustomModels(provider)
    setCustomModels(models)
  }

  const handleAddModel = async () => {
    if (!selectedProvider) {
      addToast('Select a provider first', 'error')
      return
    }
    if (!newModelId.trim() || !newModelName.trim()) {
      addToast('Model ID and name are required', 'error')
      return
    }

    try {
      if (typeof window.piStudio.provider.addCustomModel !== 'function') {
        addToast('App needs restart to load new features. Please restart Pi Studio.', 'warning')
        return
      }
      await window.piStudio.provider.addCustomModel(selectedProvider, {
        id: newModelId.trim(),
        name: newModelName.trim(),
        provider: selectedProvider,
        maxTokens: newModelMaxTokens ? parseInt(newModelMaxTokens) : undefined,
      })
      addToast(`Model "${newModelName}" added to ${selectedProvider}`, 'success')
      setNewModelId('')
      setNewModelName('')
      setNewModelMaxTokens('')
      onRefresh()
      loadCustomModels(selectedProvider)
    } catch (err: any) {
      addToast(err.message, 'error')
    }
  }

  const handleRemoveModel = async (provider: string, modelId: string) => {
    try {
      await window.piStudio.provider.removeCustomModel(provider, modelId)
      addToast('Model removed', 'success')
      onRefresh()
      loadCustomModels(provider)
    } catch (err: any) {
      addToast(err.message, 'error')
    }
  }

  // Group custom models by provider
  const allCustomModelsByProvider: Record<string, Model[]> = {}
  for (const p of providers) {
    const custom = p.models.filter(
      (m) => m.provider === p.name && !BUILT_IN_MODELS[p.name]?.has(m.id)
    )
    if (custom.length > 0) {
      allCustomModelsByProvider[p.name] = custom
    }
  }

  return (
    <div className="space-y-4 pb-4">
      <p className="text-sm text-muted-foreground">
        Add custom models to any provider (built-in or custom). These extend the default model list.
      </p>

      {/* Per-provider custom model summary */}
      {Object.keys(allCustomModelsByProvider).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Currently Added Custom Models</p>
          {Object.entries(allCustomModelsByProvider).map(([prov, models]) => {
            const provData = providers.find((p) => p.name === prov)
            return (
              <div key={prov} className="rounded-lg border border-border bg-background/50 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-secondary/30 transition-colors"
                  onClick={() => setExpanded(expanded === prov ? null : prov)}
                >
                  <div className="flex items-center gap-2">
                    {expanded === prov ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span className="text-sm font-medium">{provData?.displayName ?? prov}</span>
                    <Badge variant="secondary" className="text-[10px]">{models.length} custom</Badge>
                  </div>
                </button>
                {expanded === prov && (
                  <div className="px-4 pb-3 space-y-1.5">
                    {models.map((m) => (
                      <div key={m.id} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-secondary/20 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{m.name}</span>
                          <span className="text-muted-foreground font-mono text-[11px]">{m.id}</span>
                          {m.maxTokens && <span className="text-muted-foreground">{(m.maxTokens / 1000).toFixed(0)}k ctx</span>}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveModel(prov, m.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Separator />

      {/* Add model form */}
      <div className="rounded-xl border border-primary/30 bg-background p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Custom Model
        </h3>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Provider</label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select provider...</option>
              {providers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}{p.isCustom ? ' (custom)' : ''}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Model ID"
            placeholder="model-id-v1"
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            className="font-mono text-sm"
          />
          <Input
            label="Display Name"
            placeholder="My Model v1"
            value={newModelName}
            onChange={(e) => setNewModelName(e.target.value)}
            className="text-sm"
          />
        </div>
        <div className="flex items-end gap-3">
          <Input
            label="Max Tokens (optional)"
            type="number"
            placeholder="32768"
            value={newModelMaxTokens}
            onChange={(e) => setNewModelMaxTokens(e.target.value)}
            className="w-32 font-mono text-sm"
          />
          <Button onClick={handleAddModel} disabled={!selectedProvider || !newModelId.trim() || !newModelName.trim()}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Model
          </Button>
        </div>
      </div>
    </div>
  )
}

// Quick lookup: built-in model IDs per provider (to distinguish custom ones)
const BUILT_IN_MODELS: Record<string, Set<string>> = {
  anthropic: new Set(['claude-sonnet-4-20250514', 'claude-haiku-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229']),
  openai: new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini']),
  google: new Set(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']),
  azure: new Set(['gpt-4o', 'gpt-4o-mini']),
  groq: new Set(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']),
  xai: new Set(['grok-3', 'grok-3-mini']),
  openrouter: new Set(['openrouter/auto']),
  ollama: new Set(['llama3', 'codellama', 'mistral']),
}

// ============================================================================
// General Tab
// ============================================================================

function GeneralTab({
  settings,
  onUpdate,
}: {
  settings: PiSettings
  onUpdate: (partial: Partial<PiSettings>) => void
}) {
  return (
    <div className="space-y-6 pb-4">
      {/* Default Model Settings */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Default Model</h3>
        <div className="space-y-3">
          <Input
            label="Default Provider"
            value={settings.defaultProvider ?? 'anthropic'}
            onChange={(e) => onUpdate({ defaultProvider: e.target.value })}
            className="h-9 text-sm"
          />
          <Input
            label="Default Model"
            value={settings.defaultModel ?? 'claude-sonnet-4-20250514'}
            onChange={(e) => onUpdate({ defaultModel: e.target.value })}
            className="h-9 text-sm"
          />
        </div>
      </div>

      <Separator />

      {/* External Editor */}
      <div>
        <h3 className="text-sm font-semibold mb-3">External Editor</h3>
        <p className="text-xs text-muted-foreground mb-3">
          The command used to open the project folder in an external editor.
          Defaults to VS Code. Use {'{path}'} as a placeholder for the project path.
        </p>
        <EditorCommandInput />
      </div>

      <Separator />

      {/* Compaction */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Context Compaction</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Auto-compaction</p>
              <p className="text-xs text-muted-foreground">Automatically compact context when it gets too long</p>
            </div>
            <Switch
              checked={settings.compaction?.enabled ?? true}
              onCheckedChange={(enabled) =>
                onUpdate({
                  compaction: { ...(settings.compaction ?? { reserveTokens: 2000, keepRecentTokens: 5000 }), enabled },
                })
              }
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Retry */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Auto-Retry</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Auto-retry on errors</p>
              <p className="text-xs text-muted-foreground">Automatically retry when the provider returns an error</p>
            </div>
            <Switch
              checked={settings.retry?.enabled ?? true}
              onCheckedChange={(enabled) =>
                onUpdate({
                  retry: { ...(settings.retry ?? { maxRetries: 3, baseDelayMs: 1000 }), enabled },
                })
              }
            />
          </div>
          {settings.retry?.enabled && (
            <div className="flex items-center gap-4">
              <Input
                label="Max Retries"
                type="number"
                value={settings.retry.maxRetries}
                onChange={(e) =>
                  onUpdate({
                    retry: { ...settings.retry!, maxRetries: parseInt(e.target.value) || 3 },
                  })
                }
                className="w-28 h-9 text-sm"
              />
              <Input
                label="Base Delay (ms)"
                type="number"
                value={settings.retry.baseDelayMs}
                onChange={(e) =>
                  onUpdate({
                    retry: { ...settings.retry!, baseDelayMs: parseInt(e.target.value) || 1000 },
                  })
                }
                className="w-28 h-9 text-sm"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Pi CLI Tab
// ============================================================================

function PiTab() {
  const [version, setVersion] = useState<string | null>(null)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadPiInfo()
  }, [])

  const loadPiInfo = async () => {
    setLoading(true)
    const isInstalled = await window.piStudio.installer.isInstalled()
    setInstalled(isInstalled)

    if (isInstalled) {
      const v = await window.piStudio.installer.getVersion()
      setVersion(v)
    }

    const latest = await window.piStudio.installer.getLatestVersion()
    setLatestVersion(latest)
    setLoading(false)
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="p-5 rounded-xl border border-border bg-background/50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">pi CLI Status</p>
            <p className="text-xs text-muted-foreground mt-1">
              {installed
                ? `Version ${version} installed`
                : 'pi CLI not found on your system'}
            </p>
          </div>
          <div
            className={cn(
              'w-3 h-3 rounded-full',
              installed ? 'bg-green-400' : 'bg-destructive'
            )}
          />
        </div>
      </div>

      {installed && latestVersion && version !== latestVersion && (
        <div className="p-5 rounded-xl bg-orange-500/10 border border-orange-500/20">
          <p className="text-sm font-medium text-orange-400">Update Available</p>
          <p className="text-xs text-muted-foreground mt-1">
            Version {latestVersion} is available (current: {version})
          </p>
          <Button
            size="sm"
            className="mt-3"
            onClick={async () => {
              await window.piStudio.installer.update()
              window.location.reload()
            }}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-2" />
            Update pi
          </Button>
        </div>
      )}

      {!installed && (
        <div className="p-5 rounded-xl bg-destructive/10 border border-destructive/20">
          <p className="text-sm font-medium text-destructive">pi CLI Required</p>
          <p className="text-xs text-muted-foreground mt-1">
            Install the pi coding agent CLI to use Pi Studio.
          </p>
          <Button
            size="sm"
            className="mt-3"
            onClick={async () => {
              await window.piStudio.installer.install()
              window.location.reload()
            }}
          >
            Install pi CLI
          </Button>
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => loadPiInfo()}
        disabled={loading}
      >
        <RefreshCw className={cn('w-3.5 h-3.5 mr-2', loading && 'animate-spin')} />
        Refresh Status
      </Button>
    </div>
  )
}

// ============================================================================
// Editor Command Input (standalone, reads/writes its own setting)
// ============================================================================

function EditorCommandInput() {
  const { addToast } = useToastStore()
  const [command, setCommand] = useState<string | null>(null)

  useEffect(() => {
    window.piStudio.app.getEditor().then(setCommand)
  }, [])

  const handleSave = async () => {
    const value = command ?? ''
    await window.piStudio.app.setEditor(value)
    addToast(value ? 'Editor command saved' : 'Reset to default (VS Code)', 'success')
  }

  const handleReset = async () => {
    setCommand('')
    await window.piStudio.app.setEditor('')
    addToast('Reset to default (VS Code)', 'info')
  }

  const presets = [
    { label: 'VS Code', value: 'code' },
    { label: 'Cursor', value: 'cursor' },
    { label: 'Windsurf', value: 'windsurf' },
    { label: 'WebStorm', value: 'webstorm' },
    { label: 'Sublime Text', value: 'subl' },
    { label: 'Nova', value: 'nova' },
  ]

  return (
    <div className="space-y-3">
      <Input
        label="Editor Command"
        placeholder="code {path}"
        value={command ?? ''}
        onChange={(e) => setCommand(e.target.value)}
        hint="e.g. code {path} or cursor {path}. Leave empty for auto-detect."
        className="h-9 text-sm font-mono"
      />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Presets:</span>
        {presets.map((p) => (
          <button
            key={p.value}
            onClick={() => setCommand(p.value)}
            className={cn(
              'px-2 py-1 text-xs rounded-md border transition-colors',
              command === p.value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleSave}>
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          Reset to Default
        </Button>
      </div>
    </div>
  )
}

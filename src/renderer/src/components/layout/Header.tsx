/**
 * Header - Top bar with project selector, provider/model selector, and settings.
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  MessageSquarePlus,
  Settings,
  Zap,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  Clock,
  RefreshCw,
  Terminal,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/ui-store'
import { useProjectStore } from '@/stores/project-store'
import { useChatStore } from '@/stores/chat-store'
import { useProviderStore } from '@/stores/provider-store'
import { useToastStore } from '@/stores/toast-store'
import { Badge } from '@/components/ui/primitives'

export function Header() {
  const { currentProject, recentProjects } = useProjectStore()
  const { providers, selectedProvider, selectedModel, setSelectedProvider, setSelectedModel, reloadProviders } = useProviderStore()
  const { setSettingsOpen, toggleSidebar, terminalOpen, toggleTerminal } = useUIStore()
  const { isStreaming } = useChatStore()
  const { addToast } = useToastStore()

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const projectMenuRef = useRef<HTMLDivElement>(null)
  const providerMenuRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) setProjectMenuOpen(false)
      if (providerMenuRef.current && !providerMenuRef.current.contains(e.target as Node)) setProviderMenuOpen(false)
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setModelMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        toggleTerminal()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault()
        handleNewChat()
      }
      if (e.key === 'Escape') {
        setProjectMenuOpen(false)
        setProviderMenuOpen(false)
        setModelMenuOpen(false)
        useChatStore.getState().setError(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentProject, selectedProvider, selectedModel])

  const handleRefreshProviders = async () => {
    setRefreshing(true)
    await reloadProviders()
    setRefreshing(false)
    addToast('Providers refreshed', 'info')
  }

  const handleOpenProject = async () => {
    const cwd = await window.piStudio.project.open()
    if (cwd) useProjectStore.getState().setProject(cwd)
  }

  const handleSelectProject = (path: string) => {
    useProjectStore.getState().setProject(path)
    setProjectMenuOpen(false)
    addToast(`Opened: ${path.split(/[\\/]/).pop()}`, 'info')
  }

  const handleNewProject = async () => {
    const name = prompt('Enter project name:')
    if (!name) return
    const resultPath = await window.piStudio.project.create(name)
    useProjectStore.getState().setProject(resultPath)
    setProjectMenuOpen(false)
    addToast('Project created', 'success')
  }

  const handleNewChat = async () => {
    if (!currentProject) return

    const chatState = useChatStore.getState()
    const conversationId = `conv_${crypto.randomUUID()}`

    // If we have a current session, create a new conversation within it
    if (chatState.currentSessionFilePath) {
      const newThreadId = crypto.randomUUID()
      try {
        await window.piStudio.pi.startSession({
          threadId: newThreadId, cwd: currentProject,
          provider: selectedProvider ?? undefined,
          model: selectedModel ?? undefined,
          sessionFilePath: chatState.currentSessionFilePath,
          conversationId,
        })
        useChatStore.getState().createTab({
          cwd: currentProject,
          threadId: newThreadId,
          provider: selectedProvider ?? undefined,
          model: selectedModel ?? undefined,
          label: 'New Chat',
          sessionFilePath: chatState.currentSessionFilePath,
          conversationId,
        })
        addToast('New chat started', 'success')
      } catch (err: any) {
        addToast(err.message || 'Failed to start chat', 'error')
      }
      return
    }

    // No current session — create a brand new one
    const session = await window.piStudio.session.create(currentProject)
    const newThreadId = crypto.randomUUID()
    try {
      await window.piStudio.pi.startSession({
        threadId: newThreadId, cwd: currentProject,
        provider: selectedProvider ?? undefined,
        model: selectedModel ?? undefined,
        sessionFilePath: session.filePath,
        conversationId,
      })
      useChatStore.getState().setCurrentSession(session.filePath)
      useChatStore.getState().createTab({
        cwd: currentProject,
        threadId: newThreadId,
        provider: selectedProvider ?? undefined,
        model: selectedModel ?? undefined,
        label: 'New Chat',
        sessionFilePath: session.filePath,
        conversationId,
      })
      useProjectStore.getState().bumpSessionList()
      addToast('New session started', 'success')
    } catch (err: any) {
      addToast(err.message || 'Failed to start session', 'error')
    }
  }

  const handleOpenInEditor = async () => {
    if (!currentProject) return
    const result = await window.piStudio.app.openInEditor(currentProject)
    if (result.success) {
      addToast(`Opened in ${result.editor || 'editor'}`, 'success')
    } else {
      addToast(result.error || 'Failed to open editor', 'error')
    }
  }

  const currentProviderData = providers.find(p => p.name === selectedProvider)
  const currentModelData = currentProviderData?.models.find(m => m.id === selectedModel)

  // Separate built-in and custom providers for grouping
  const builtInProviders = providers.filter(p => !p.isCustom)
  const customProviders = providers.filter(p => p.isCustom)

  return (
    <div className="flex h-12 items-center gap-2 px-3 border-b border-border bg-card/30">
      {/* Project Selector */}
      <div className="relative" ref={projectMenuRef}>
        <button
          onClick={() => setProjectMenuOpen(!projectMenuOpen)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-sm min-w-0"
        >
          {currentProject ? (
            <>
              <FolderOpen className="w-4 h-4 text-primary shrink-0" />
              <span className="truncate max-w-[180px]">{currentProject.split(/[\\/]/).pop()}</span>
            </>
          ) : (
            <>
              <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">No project</span>
            </>
          )}
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>
        {projectMenuOpen && (
          <div className="absolute top-full left-0 z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-2 shadow-xl animate-fade-in">
            <button onClick={handleOpenProject} className="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-secondary/50 text-sm transition-colors">
              <FolderOpen className="w-4 h-4 text-muted-foreground" />Open Folder
            </button>
            <button onClick={handleNewProject} className="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-secondary/50 text-sm transition-colors">
              <FolderPlus className="w-4 h-4 text-muted-foreground" />New Project
            </button>
            {recentProjects.length > 0 && (
              <>
                <div className="my-1.5 px-3"><div className="h-px bg-border" /></div>
                <div className="px-3 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />Recent
                </div>
                {recentProjects.slice(0, 5).map(project => (
                  <button key={project} onClick={() => handleSelectProject(project)}
                    className={cn(
                      'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors',
                      project === currentProject ? 'bg-secondary/50 text-foreground' : 'hover:bg-secondary/50 text-muted-foreground'
                    )}
                  >
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span className="truncate">{project}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="h-6 w-px bg-border" />

      {/* ─── Provider Selector ─── */}
      <div className="relative" ref={providerMenuRef}>
        <button
          onClick={() => setProviderMenuOpen(!providerMenuOpen)}
          className={cn(
            'flex items-center gap-2 h-8 px-3 rounded-lg border text-sm transition-colors min-w-0',
            'border-border bg-background hover:bg-secondary/50',
            selectedProvider ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <span className="truncate max-w-[140px] font-medium">
            {currentProviderData?.displayName ?? 'Provider'}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>

        {providerMenuOpen && (
          <div className="absolute top-full left-0 z-50 mt-1 w-64 rounded-lg border border-border bg-popover shadow-xl animate-fade-in max-h-[420px] flex flex-col">
            <div className="overflow-auto flex-1 custom-scrollbar p-1">
              {/* Built-in */}
              {builtInProviders.length > 0 && (
                <div className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Built-in
                  </div>
                  {builtInProviders.map(p => (
                    <button key={p.name}
                      onClick={() => { setSelectedProvider(p.name); setProviderMenuOpen(false) }}
                      className={cn(
                        'flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-sm transition-colors',
                        p.name === selectedProvider
                          ? 'bg-secondary/60 text-foreground'
                          : 'text-foreground hover:bg-secondary/40'
                      )}
                    >
                      <span className="font-medium truncate">{p.displayName}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{p.models.length}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Custom */}
              {customProviders.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mt-1">
                    Custom
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
                  </div>
                  {customProviders.map(p => (
                    <button key={p.name}
                      onClick={() => { setSelectedProvider(p.name); setProviderMenuOpen(false) }}
                      className={cn(
                        'flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-sm transition-colors',
                        p.name === selectedProvider
                          ? 'bg-secondary/60 text-foreground'
                          : 'text-foreground hover:bg-secondary/40'
                      )}
                    >
                      <span className="font-medium truncate">{p.displayName}</span>
                      {p.baseUrl && (
                        <span className="text-[9px] text-muted-foreground font-mono truncate max-w-[120px]">{p.baseUrl}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{p.models.length}</span>
                    </button>
                  ))}
                </div>
              )}

              {providers.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No providers available
                </div>
              )}
            </div>

            {/* Refresh + Settings buttons */}
            <div className="border-t border-border p-1.5 flex gap-1">
              <button
                onClick={handleRefreshProviders}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors flex-1"
              >
                <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
                Refresh
              </button>
              <button
                onClick={() => { setProviderMenuOpen(false); setSettingsOpen(true) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors flex-1"
              >
                <Settings className="w-3 h-3" />
                Manage
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Model Selector ─── */}
      <div className="relative" ref={modelMenuRef}>
        <button
          onClick={() => {
            if (!selectedProvider || !currentProviderData?.models.length) return
            setModelMenuOpen(!modelMenuOpen)
          }}
          disabled={!selectedProvider}
          className={cn(
            'flex items-center gap-2 h-8 px-3 rounded-lg border text-sm transition-colors min-w-0',
            'border-border bg-background',
            selectedProvider && selectedModel ? 'text-foreground hover:bg-secondary/50' : 'text-muted-foreground',
            !selectedProvider && 'opacity-50 cursor-not-allowed'
          )}
        >
          <span className="truncate max-w-[180px]">
            {currentModelData?.name ?? selectedModel ?? 'Model'}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>

        {modelMenuOpen && currentProviderData && (
          <div className="absolute top-full left-0 z-50 mt-1 w-72 rounded-lg border border-border bg-popover shadow-xl animate-fade-in max-h-[360px] overflow-auto custom-scrollbar p-1">
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {currentProviderData.displayName}
              {!currentProviderData.isCustom && (
                <span className="text-[9px] normal-case tracking-normal ml-1 text-muted-foreground/60">
                  — select a model
                </span>
              )}
            </div>
            {currentProviderData.models.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                No models configured for this provider.
                <br />
                Add models in Settings → Custom Models.
              </div>
            ) : (
              currentProviderData.models.map(m => (
                <button key={m.id}
                  onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false) }}
                  className={cn(
                    'flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-sm transition-colors',
                    m.id === selectedModel
                      ? 'bg-secondary/60 text-foreground'
                      : 'text-foreground hover:bg-secondary/40'
                  )}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{m.name}</span>
                    <span className="text-[10px] text-muted-foreground font-mono truncate">{m.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto shrink-0">
                    {m.supportsThinking && (
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">thinking</Badge>
                    )}
                    {m.maxTokens && (
                      <span className="text-[10px] text-muted-foreground">{(m.maxTokens / 1000).toFixed(0)}k</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* ─── Actions ─── */}
      <div className="flex items-center gap-1.5 ml-auto">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleOpenInEditor}
          disabled={!currentProject}
          title="Open in Editor"
        >
          <ExternalLink className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTerminal}
          disabled={!currentProject}
          title="Toggle Terminal (Ctrl+`)"
          className={cn(terminalOpen && 'bg-secondary/50 text-foreground')}
        >
          <Terminal className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleNewChat} disabled={!currentProject} title="New Chat (Ctrl+Shift+N)">
          <MessageSquarePlus className="w-4 h-4" />
        </Button>
        {isStreaming && (
          <Badge variant="warning" className="animate-pulse text-[10px]">
            <Zap className="w-3 h-3 mr-1" />Running
          </Badge>
        )}
        <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} title="Settings (Ctrl+,)">
          <Settings className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={toggleSidebar} title="Toggle Sidebar (Ctrl+B)">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </Button>
      </div>
    </div>
  )
}

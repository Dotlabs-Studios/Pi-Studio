/**
 * Sidebar - Collapsible panel with tabs for Sessions, Skills, Config, Files.
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  MessageSquare,
  Sparkles,
  Settings2,
  Plus,
  Trash2,
  GitBranch,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea, Badge, Separator } from '@/components/ui/primitives'
import { useUIStore } from '@/stores/ui-store'
import { useProjectStore } from '@/stores/project-store'
import { useChatStore } from '@/stores/chat-store'
import type { TabStatus } from '@/stores/chat-store'
import { useProviderStore } from '@/stores/provider-store'
import { useToastStore } from '@/stores/toast-store'
import { uuid, formatDate, truncate } from '@/lib/utils'
import type { SessionSummary, Skill, ChatMessage } from '../../../shared/types'

const STATUS_DOT_COLORS: Record<TabStatus, string> = {
  idle: 'bg-muted-foreground/30',
  streaming: 'bg-yellow-400',
  completed: 'bg-green-400',
  error: 'bg-red-400',
}

const SIDEBAR_TABS = [
  { id: 'sessions' as const, label: 'Sessions', icon: MessageSquare },
  { id: 'skills' as const, label: 'Skills', icon: Sparkles },
  { id: 'config' as const, label: 'Config', icon: Settings2 },
]

export function Sidebar() {
  const { sidebarOpen, sidebarTab, setSidebarTab } = useUIStore()
  const { currentProject } = useProjectStore()

  if (!sidebarOpen) return null

  return (
    <div className="flex flex-col w-72 border-r border-border bg-card/20 shrink-0">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 pt-2">
        {SIDEBAR_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSidebarTab(tab.id)}
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-lg text-xs transition-colors',
              sidebarTab === tab.id
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            )}
            title={tab.label}
          >
            <tab.icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      <Separator className="my-2" />

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {sidebarTab === 'sessions' && <SessionsPanel />}
        {sidebarTab === 'skills' && <SkillsPanel />}
        {sidebarTab === 'config' && <ConfigPanel />}
      </div>
    </div>
  )
}

// ============================================================================
// Sessions Panel — full session management with load/fork
// ============================================================================

function SessionsPanel() {
  const { currentProject } = useProjectStore()
  const { threadId } = useChatStore()
  const chatTabs = useChatStore((s) => s.tabs)
  const sessionListVersion = useProjectStore((s) => s.sessionListVersion)
  const { selectedProvider, selectedModel } = useProviderStore()
  const { addToast } = useToastStore()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    if (!currentProject) { setSessions([]); return }
    setLoading(true)
    try {
      const result = await window.piStudio.session.listProject(currentProject)
      setSessions(result)
    } catch (err) {
      console.error('Failed to load sessions:', err)
    }
    setLoading(false)
  }, [currentProject])

  useEffect(() => { loadSessions() }, [loadSessions, sessionListVersion])

  const handleNewSession = async () => {
    if (!currentProject) return

    // Create a new session file on disk
    const session = await window.piStudio.session.create(currentProject)
    const conversationId = `conv_${uuid()}`

    const newThreadId = uuid()
    try {
      await window.piStudio.pi.startSession({
        threadId: newThreadId,
        cwd: currentProject,
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
      useChatStore.getState().setError(err.message || 'Failed to start session')
    }
  }

  const handleLoadSession = async (filePath: string) => {
    try {
      // Extract conversations from the session file
      const conversations = await window.piStudio.session.conversations(filePath)
      if (!conversations || conversations.length === 0) { addToast('Could not load session', 'error'); return }

      const session = await window.piStudio.session.load(filePath)
      if (!session) { addToast('Could not load session', 'error'); return }

      // Close previous tabs (from a different session)
      useChatStore.getState().closeAllTabs()
      useChatStore.getState().setCurrentSession(filePath)

      // Create one tab per conversation (no pi process — threadId is empty string)
      for (const conv of conversations) {
        const chatMessages: ChatMessage[] = conv.entries
          .filter(e => e.role === 'user' || e.role === 'assistant')
          .map(e => ({
            id: e.id,
            role: e.role as 'user' | 'assistant',
            content: typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
            timestamp: e.timestamp,
            status: 'completed' as const,
          }))

        if (chatMessages.length === 0) continue

        useChatStore.getState().createTab({
          cwd: session.cwd,
          threadId: '',  // no pi process yet — will start on first send
          provider: session.provider,
          model: session.model,
          label: conv.label,
          sessionFilePath: filePath,
          conversationId: conv.id,
        })
        // Load the messages into the just-created (active) tab
        useChatStore.getState().setMessages(chatMessages)
      }

      // Switch to the first tab
      if (conversations.length > 0) {
        const firstTabId = useChatStore.getState().tabs[0]?.id
        if (firstTabId) useChatStore.getState().switchToTab(firstTabId)
      }

      // Update provider/model selectors
      if (session.provider) useProviderStore.getState().setSelectedProvider(session.provider)
      if (session.model) useProviderStore.getState().setSelectedModel(session.model)

      addToast(`Session loaded (${conversations.length} conversation${conversations.length > 1 ? 's' : ''})`, 'success')
    } catch (err: any) {
      addToast(`Failed to load: ${err.message}`, 'error')
    }
  }

  const handleDeleteSession = async (filePath: string) => {
    if (confirmDelete !== filePath) {
      setConfirmDelete(filePath)
      return
    }
    setConfirmDelete(null)
    await window.piStudio.session.delete(filePath)
    loadSessions()
    addToast('Session deleted', 'info')
  }

  const handleExportSession = async (filePath: string) => {
    const session = await window.piStudio.session.load(filePath)
    if (!session) return
    // Export as markdown
    let md = `# Pi Studio Session\n\n`
    for (const entry of session.entries) {
      if (entry.role === 'user' || entry.role === 'assistant') {
        md += `## ${entry.role === 'user' ? '👤 You' : '🤖 Pi'}\n\n`
        md += `${typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content)}\n\n`
      }
    }
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `session-${session.id.substring(0, 8)}.md`
    a.click()
    URL.revokeObjectURL(url)
    addToast('Session exported as Markdown', 'success')
  }

  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
          Sessions
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewSession} disabled={!currentProject} title="New Session">
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <Input placeholder="Search sessions..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-7 text-xs" />
      </div>

      <ScrollArea className="flex-1 px-2">
        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-4">Loading...</div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            {search ? 'No matching sessions' : 'No sessions yet'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredSessions.map(session => {
              // Check if this session is open in a tab — show status dot
              const openTab = chatTabs.find(t => t.threadId && t.messages.length > 0)
              // We check by matching loaded session titles/content heuristically
              // Actually, we can't match directly. Skip status dot for session list.
              return (
              <div key={session.id} className="relative group">
                <button
                  onClick={() => handleLoadSession(session.filePath)}
                  className={cn(
                    'flex flex-col items-start w-full px-3 py-2 rounded-lg text-left transition-colors',
                    'hover:bg-secondary/40 text-muted-foreground hover:text-foreground'
                  )}
                >
                  <div className="flex items-center gap-2 w-full min-w-0">
                    <span className="text-sm font-medium truncate">{truncate(session.title, 50)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground/60">{formatDate(session.updatedAt)}</span>
                    <Badge variant="outline" className="text-[9px] h-4">{session.entryCount} msgs</Badge>
                  </div>
                </button>
                {/* Action buttons on hover */}
                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExportSession(session.filePath) }}
                    className="h-6 w-6 rounded flex items-center justify-center hover:bg-secondary text-muted-foreground hover:text-foreground"
                    title="Export as Markdown"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.filePath) }}
                    className={cn(
                      'h-6 w-6 rounded flex items-center justify-center transition-colors',
                      confirmDelete === session.filePath
                        ? 'bg-destructive text-destructive-foreground'
                        : 'hover:bg-destructive/20 hover:text-destructive text-muted-foreground'
                    )}
                    title={confirmDelete === session.filePath ? 'Click again to confirm' : 'Delete'}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )})}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// Skills Panel
// ============================================================================

function SkillsPanel() {
  const { currentProject } = useProjectStore()
  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [installMode, setInstallMode] = useState(false)
  const [installSource, setInstallSource] = useState('')
  const { addToast } = useToastStore()

  useEffect(() => { loadSkills() }, [currentProject])

  const loadSkills = async () => {
    if (!currentProject) return
    try {
      const result = await window.piStudio.skill.index(currentProject)
      setSkills(result)
    } catch (err) { console.error(err) }
  }

  const handleToggle = async (name: string, enabled: boolean) => {
    await window.piStudio.skill.toggle(name, enabled)
    setSkills(prev => prev.map(s => (s.name === name ? { ...s, enabled } : s)))
    addToast(`${name} ${enabled ? 'enabled' : 'disabled'}`, enabled ? 'success' : 'info')
  }

  const handleInstall = async () => {
    const src = installSource.trim()
    if (!src) return
    try {
      if (src.startsWith('http') || src.startsWith('git')) {
        await window.piStudio.skill.install({ type: 'git', url: src })
      } else if (src.includes('/')) {
        await window.piStudio.skill.install({ type: 'npm', name: src })
      } else {
        await window.piStudio.skill.install({ type: 'local', path: src })
      }
      addToast('Skill installed', 'success')
      setInstallSource('')
      setInstallMode(false)
      loadSkills()
    } catch (err: any) {
      addToast(`Install failed: ${err.message}`, 'error')
    }
  }

  const handleDelete = async (name: string) => {
    try {
      await window.piStudio.skill.toggle(name, false)
      // skill.delete not exposed yet, just disable
      addToast(`Skill ${name} disabled`, 'info')
    } catch (err: any) {
      addToast(`Failed: ${err.message}`, 'error')
    }
  }

  const filteredSkills = skills.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description && s.description.toLowerCase().includes(search.toLowerCase()))
  )

  if (selectedSkill) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 pb-2">
          <button onClick={() => setSelectedSkill(null)} className="text-xs text-primary hover:underline">← Back</button>
        </div>
        <ScrollArea className="flex-1 px-3">
          <h3 className="text-sm font-semibold mb-2">{selectedSkill.name}</h3>
          {selectedSkill.description && (
            <p className="text-xs text-muted-foreground mb-3">{selectedSkill.description}</p>
          )}
          <Badge variant="outline" className="text-[10px] mb-3">{selectedSkill.source} · {selectedSkill.enabled ? 'Enabled' : 'Disabled'}</Badge>
          <div className="code-block text-xs whitespace-pre-wrap max-h-[400px] overflow-auto">
            {selectedSkill.content}
          </div>
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">Skills</span>
        <Badge variant="secondary" className="text-[10px]">
          {skills.filter(s => s.enabled).length}/{skills.length}
        </Badge>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInstallMode(!installMode)} title="Install skill">
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      {installMode && (
        <div className="px-3 pb-2 flex gap-1.5">
          <Input placeholder="npm pkg / git url / local path" value={installSource} onChange={e => setInstallSource(e.target.value)} className="h-7 text-xs flex-1" onKeyDown={e => e.key === 'Enter' && handleInstall()} />
          <Button size="sm" className="h-7 text-xs px-2" onClick={handleInstall} disabled={!installSource.trim()}>Install</Button>
        </div>
      )}

      <div className="px-3 pb-2">
        <Input placeholder="Search skills..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-xs" />
      </div>

      <ScrollArea className="flex-1 px-2">
        {filteredSkills.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            {currentProject ? (search ? 'No matching skills' : 'No skills found') : 'Open a project first'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredSkills.map(skill => (
              <div key={skill.name} className={cn('flex items-start gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-secondary/40', !skill.enabled && 'opacity-50')}>
                <button className="flex flex-col gap-1 flex-1 min-w-0 text-left" onClick={() => setSelectedSkill(skill)}>
                  <span className="text-sm font-medium truncate">{skill.name}</span>
                  {skill.description && <span className="text-[10px] text-muted-foreground line-clamp-2">{skill.description}</span>}
                  <Badge variant="outline" className="text-[9px] h-4 w-fit">{skill.source}</Badge>
                </button>
                <button
                  onClick={() => handleToggle(skill.name, !skill.enabled)}
                  className={cn('mt-0.5 h-5 w-9 rounded-full transition-colors relative shrink-0', skill.enabled ? 'bg-primary' : 'bg-secondary')}
                >
                  <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', skill.enabled ? 'left-4' : 'left-0.5')} />
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// Config Panel
// ============================================================================

function ConfigPanel() {
  const { currentProject } = useProjectStore()
  const [config, setConfig] = useState<any>(null)
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null)
  const [agentsMd, setAgentsMd] = useState<string | null>(null)
  const [viewFile, setViewFile] = useState<'system' | 'agents' | null>(null)

  useEffect(() => { loadConfig() }, [currentProject])

  const loadConfig = async () => {
    if (!currentProject) return
    try {
      const result = await window.piStudio.config.scan(currentProject)
      setConfig(result)
    } catch (err) { console.error(err) }
  }

  if (!currentProject) {
    return <div className="text-xs text-muted-foreground text-center py-4 px-3">Open a project to view config</div>
  }
  if (!config) return <div className="text-xs text-muted-foreground text-center py-4 px-3">Loading...</div>

  if (viewFile) {
    const content = viewFile === 'system'
      ? config.project?.systemPrompt || config.user?.systemPrompt || 'No system prompt configured.'
      : config.project?.agentsMd || config.user?.agentsMd || 'No AGENTS.md configured.'
    return (
      <div className="flex flex-col h-full">
        <button onClick={() => setViewFile(null)} className="px-3 pb-2 text-xs text-primary hover:underline">← Back</button>
        <ScrollArea className="flex-1 px-3">
          <div className="code-block text-xs whitespace-pre-wrap">{content}</div>
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full px-3 gap-3">
      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project Config</span>
        <div className="mt-2 space-y-2">
          <ConfigItem label="Settings" value={config.project?.settings ? '✓ Found' : '—'} />
          <button className="flex items-center justify-between w-full text-xs" onClick={() => setViewFile('system')}>
            <span className="text-muted-foreground">System Prompt</span>
            <span className={cn('font-mono text-foreground/80', config.project?.systemPrompt && 'text-primary cursor-pointer hover:underline')}>
              {config.project?.systemPrompt ? '✓ View' : '—'}
            </span>
          </button>
          <button className="flex items-center justify-between w-full text-xs" onClick={() => setViewFile('agents')}>
            <span className="text-muted-foreground">Agents.md</span>
            <span className={cn('font-mono text-foreground/80', config.project?.agentsMd && 'text-primary cursor-pointer hover:underline')}>
              {config.project?.agentsMd ? '✓ View' : '—'}
            </span>
          </button>
          <ConfigItem label="Skills" value={`${config.project?.skills?.length ?? 0} found`} />
        </div>
      </div>
      <Separator />
      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">User Config</span>
        <div className="mt-2 space-y-2">
          <ConfigItem label="Settings" value={config.user?.settings ? '✓ Found' : '—'} />
          <ConfigItem label="System Prompt" value={config.user?.systemPrompt ? '✓ Custom' : '—'} />
          <ConfigItem label="Skills" value={`${config.user?.skills?.length ?? 0} found`} />
        </div>
      </div>
      <Separator />
      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resolved</span>
        <div className="mt-2 space-y-2">
          <ConfigItem label="Provider" value={config.settings?.defaultProvider ?? 'anthropic'} />
          <ConfigItem label="Model" value={config.settings?.defaultModel ?? 'claude-sonnet-4'} />
          <ConfigItem label="Thinking" value={config.settings?.defaultThinkingLevel ?? 'medium'} />
          <ConfigItem label="Compaction" value={config.settings?.compaction?.enabled ? 'Enabled' : 'Disabled'} />
          <ConfigItem label="Retry" value={config.settings?.retry?.enabled ? `${config.settings.retry.maxRetries}x` : 'Disabled'} />
        </div>
      </div>
    </div>
  )
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground/80">{value}</span>
    </div>
  )
}

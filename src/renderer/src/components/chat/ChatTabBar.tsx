/**
 * ChatTabBar - Tab strip for multiple concurrent chat sessions.
 *
 * Shows:
 *   - Session indicator (left) with the current session name
 *   - One tab per conversation in the session
 *   - "+" button to add a new conversation within the session
 *
 * Tab status dots:
 *   🟡 Yellow = streaming
 *   🟢 Green  = completed
 *   🔴 Red    = error
 *   ⚪ Gray   = idle
 */

import React from 'react'
import { Plus, X, MessageSquare } from 'lucide-react'
import { cn, uuid } from '@/lib/utils'
import { useChatStore, type TabStatus } from '@/stores/chat-store'
import { useProjectStore } from '@/stores/project-store'
import { useProviderStore } from '@/stores/provider-store'
import { useToastStore } from '@/stores/toast-store'

const STATUS_COLORS: Record<TabStatus, string> = {
  idle: 'bg-muted-foreground/40',
  streaming: 'bg-yellow-400 animate-pulse',
  completed: 'bg-green-400',
  error: 'bg-red-400',
}

export function ChatTabBar() {
  const tabs = useChatStore((s) => s.tabs)
  const activeTabId = useChatStore((s) => s.activeTabId)
  const currentSessionName = useChatStore((s) => s.currentSessionName)
  const switchToTab = useChatStore((s) => s.switchToTab)
  const closeTab = useChatStore((s) => s.closeTab)
  const currentProject = useProjectStore((s) => s.currentProject)

  const handleNewConversation = async () => {
    const cwd = useProjectStore.getState().currentProject
    if (!cwd) return
    const { selectedProvider, selectedModel } = useProviderStore.getState()
    const chatState = useChatStore.getState()
    const conversationId = `conv_${uuid()}`

    if (chatState.currentSessionFilePath) {
      // New conversation within the existing session
      const newThreadId = uuid()
      try {
        await window.piStudio.pi.startSession({
          threadId: newThreadId,
          cwd,
          provider: selectedProvider ?? undefined,
          model: selectedModel ?? undefined,
          sessionFilePath: chatState.currentSessionFilePath,
          conversationId,
        })
        useChatStore.getState().createTab({
          cwd,
          threadId: newThreadId,
          provider: selectedProvider ?? undefined,
          model: selectedModel ?? undefined,
          label: 'New Chat',
          sessionFilePath: chatState.currentSessionFilePath,
          conversationId,
        })
      } catch (err: any) {
        useToastStore.getState().addToast(err.message || 'Failed to start chat', 'error')
      }
    } else {
      // No current session — create a brand new one
      const session = await window.piStudio.session.create(cwd)
      const newThreadId = uuid()
      try {
        await window.piStudio.pi.startSession({
          threadId: newThreadId,
          cwd,
          provider: selectedProvider ?? undefined,
          model: selectedModel ?? undefined,
          sessionFilePath: session.filePath,
          conversationId,
        })
        useChatStore.getState().setCurrentSession(session.filePath, 'New Session')
        useChatStore.getState().createTab({
          cwd,
          threadId: newThreadId,
          provider: selectedProvider ?? undefined,
          model: selectedModel ?? undefined,
          label: 'New Chat',
          sessionFilePath: session.filePath,
          conversationId,
        })
        useProjectStore.getState().bumpSessionList()
      } catch (err: any) {
        useToastStore.getState().addToast(err.message || 'Failed to start session', 'error')
      }
    }
  }

  return (
    <div className="flex items-center h-9 border-b border-border bg-card/30 overflow-x-auto shrink-0">
      {/* Session indicator */}
      {currentSessionName && (
        <div className="flex items-center gap-1.5 px-2.5 border-r border-border/30 shrink-0 select-none">
          <MessageSquare className="w-3 h-3 text-primary/60" />
          <span
            className="text-[11px] text-muted-foreground font-medium truncate max-w-[140px]"
            title={currentSessionName}
          >
            {currentSessionName}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0 flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex items-center gap-1.5 h-full px-3 cursor-pointer border-r border-border/30 select-none shrink-0 max-w-[200px]',
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/30'
              )}
              onClick={() => switchToTab(tab.id)}
            >
              <span
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  STATUS_COLORS[tab.status]
                )}
                title={tab.status}
              />
              <span className="text-xs font-medium truncate">{tab.label}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                  className="h-4 w-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all shrink-0"
                  title="Close tab"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Add conversation button */}
      {currentProject && (
        <div className="shrink-0">
          <button
            onClick={handleNewConversation}
            className="flex items-center justify-center h-full w-9 text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
            title="New conversation in this session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

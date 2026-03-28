/**
 * ChatTabBar - Tab strip for multiple concurrent chat sessions.
 *
 * Shows tabs with status dots:
 *   🟡 Yellow = streaming
 *   🟢 Green  = completed
 *   🔴 Red    = error
 *   ⚪ Gray   = idle
 */

import React from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore, type TabStatus } from '@/stores/chat-store'

const STATUS_COLORS: Record<TabStatus, string> = {
  idle: 'bg-muted-foreground/40',
  streaming: 'bg-yellow-400 animate-pulse',
  completed: 'bg-green-400',
  error: 'bg-red-400',
}

export function ChatTabBar() {
  const tabs = useChatStore((s) => s.tabs)
  const activeTabId = useChatStore((s) => s.activeTabId)
  const switchToTab = useChatStore((s) => s.switchToTab)
  const closeTab = useChatStore((s) => s.closeTab)

  if (tabs.length === 0) return null

  return (
    <div className="flex items-center h-9 border-b border-border bg-card/30 overflow-x-auto shrink-0">
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
    </div>
  )
}

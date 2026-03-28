/**
 * Chat Store - Multi-tab chat management with per-tab state.
 *
 * Each tab has its own messages, threadId, streaming state, token usage.
 * Active tab's state is synced to flat properties for backwards compatibility.
 * Runtime events are routed to the correct tab by threadId.
 */

import { create } from 'zustand'
import type {
  RuntimeEvent,
  ChatMessage,
  ToolCallInfo,
  ApprovalRequest,
} from '../../../shared/types'
import { uuid } from '../lib/utils'

// ============================================================================
// Tab Data
// ============================================================================

export type TabStatus = 'idle' | 'streaming' | 'completed' | 'error'

export interface ChatTab {
  id: string
  threadId: string
  label: string
  cwd: string
  provider?: string
  model?: string
  sessionFilePath?: string
  conversationId?: string
  messages: ChatMessage[]
  isStreaming: boolean
  pendingRequests: ApprovalRequest[]
  error: string | null
  status: TabStatus

  // Token usage tracking (per-tab)
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCost: number
  lastUsage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
    cost: number
  } | null
}

function emptyTab(overrides: Partial<ChatTab> & { id: string; threadId: string; cwd: string }): ChatTab {
  return {
    label: 'New Chat',
    messages: [],
    isStreaming: false,
    pendingRequests: [],
    error: null,
    status: 'idle',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    lastUsage: null,
    ...overrides,
  }
}

// ============================================================================
// Pure helpers
// ============================================================================

function ensureAssistantMessage(messages: ChatMessage[], itemId?: string): ChatMessage[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant' && last.isStreaming) {
    return messages
  }
  return [
    ...messages,
    {
      id: itemId || uuid(),
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      isStreaming: true,
      status: 'inProgress' as const,
    },
  ]
}

/**
 * Apply a single runtime event to a tab, returning the updated tab.
 * Pure function — no side effects.
 */
function applyEventToTab(tab: ChatTab, event: RuntimeEvent): ChatTab {
  switch (event.type) {
    case 'session.started':
      return tab

    case 'session.state.changed': {
      const running = event.payload.state === 'running'
      return { ...tab, isStreaming: running, status: running ? 'streaming' : tab.status }
    }

    case 'turn.started': {
      let messages = ensureAssistantMessage(tab.messages, event.itemId)
      return { ...tab, messages, isStreaming: true, error: null, status: 'streaming' }
    }

    case 'content.delta': {
      const { streamKind, delta } = event.payload
      if (!delta) return tab

      let messages = ensureAssistantMessage([...tab.messages], event.itemId)
      const lastMsg = messages[messages.length - 1]

      if (streamKind === 'assistant_thinking') {
        messages[messages.length - 1] = {
          ...lastMsg,
          thinking: (lastMsg.thinking || '') + delta,
        }
      } else {
        messages[messages.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + delta,
        }
      }
      return { ...tab, messages, status: 'streaming' }
    }

    case 'item.started': {
      if (event.payload.itemType === 'dynamic_tool_call') {
        const toolCall: ToolCallInfo = {
          id: event.itemId || uuid(),
          name: event.payload.title || 'Tool',
          status: 'inProgress',
        }
        let messages = ensureAssistantMessage([...tab.messages])
        const lastMsg = messages[messages.length - 1]
        messages[messages.length - 1] = {
          ...lastMsg,
          toolCalls: [...(lastMsg.toolCalls || []), toolCall],
        }
        return { ...tab, messages }
      }
      return tab
    }

    case 'item.updated': {
      if (event.payload.itemType === 'dynamic_tool_call' && event.itemId) {
        const messages = [...tab.messages]
        const lastMsg = messages[messages.length - 1]
        if (lastMsg?.toolCalls) {
          const toolCalls = lastMsg.toolCalls.map((tc) =>
            tc.id === event.itemId ? { ...tc, ...event.payload.data } : tc
          )
          messages[messages.length - 1] = { ...lastMsg, toolCalls }
        }
        return { ...tab, messages }
      }
      return tab
    }

    case 'item.completed': {
      if (event.payload.itemType === 'dynamic_tool_call' && event.itemId) {
        const messages = [...tab.messages]
        const lastMsg = messages[messages.length - 1]
        if (lastMsg?.toolCalls) {
          const toolCalls = lastMsg.toolCalls.map((tc) =>
            tc.id === event.itemId
              ? { ...tc, status: 'completed' as const, result: event.payload.data }
              : tc
          )
          messages[messages.length - 1] = { ...lastMsg, toolCalls }
        }
        return { ...tab, messages }
      }
      return tab
    }

    case 'turn.completed': {
      const messages = [...tab.messages]
      const lastMsg = messages[messages.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') {
        messages[messages.length - 1] = {
          ...lastMsg,
          isStreaming: false,
          status: event.payload.state === 'completed' ? 'completed' : 'error',
          errorMessage: event.payload.errorMessage,
        }
      }
      return {
        ...tab,
        messages,
        isStreaming: false,
        status: event.payload.errorMessage ? 'error' : 'completed',
        error: event.payload.errorMessage ?? null,
      }
    }

    case 'runtime.error': {
      const messages = [...tab.messages]
      const lastMsg = messages[messages.length - 1]
      if (lastMsg && lastMsg.isStreaming) {
        messages[messages.length - 1] = {
          ...lastMsg,
          isStreaming: false,
          status: 'error',
          errorMessage: event.payload.message,
        }
      }
      return { ...tab, messages, isStreaming: false, error: event.payload.message, status: 'error' }
    }

    case 'runtime.warning':
      return tab

    case 'request.opened': {
      const args = event.payload.args as {
        id: string; method: string; title?: string; message?: string; options?: string[]
      }
      if (args) {
        const request: ApprovalRequest = {
          id: event.requestId,
          threadId: event.threadId,
          title: args.title ?? event.payload.detail,
          message: args.message,
          options: args.options,
          method: args.method,
          args: event.payload.args,
        }
        return { ...tab, pendingRequests: [...tab.pendingRequests, request] }
      }
      return tab
    }

    case 'request.resolved': {
      return { ...tab, pendingRequests: tab.pendingRequests.filter((r) => r.id !== event.requestId) }
    }

    case 'turn.usage': {
      const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, cost } = event.payload
      return {
        ...tab,
        totalInputTokens: tab.totalInputTokens + inputTokens,
        totalOutputTokens: tab.totalOutputTokens + outputTokens,
        totalCacheReadTokens: tab.totalCacheReadTokens + cacheReadTokens,
        totalCacheWriteTokens: tab.totalCacheWriteTokens + cacheWriteTokens,
        totalCost: tab.totalCost + cost,
        lastUsage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, cost },
      }
    }

    case 'session.exited':
      return { ...tab, isStreaming: false, error: event.payload.reason, status: 'error' }

    default:
      return tab
  }
}

// ============================================================================
// Store Interface
// ============================================================================

type SetFn = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
type GetFn = () => ChatState

interface ChatState {
  // ── Tab storage ──
  tabs: ChatTab[]
  activeTabId: string | null
  currentSessionFilePath: string | null
  currentSessionName: string | null

  // ── Active tab's state (flat, for backwards compatibility) ──
  threadId: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  pendingRequests: ApprovalRequest[]
  error: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCost: number
  lastUsage: ChatTab['lastUsage']

  // ── Tab actions ──
  createTab: (options: {
    cwd: string; threadId: string; provider?: string; model?: string;
    label?: string; sessionFilePath?: string; conversationId?: string;
  }) => string
  closeTab: (tabId: string) => void
  switchToTab: (tabId: string) => void
  closeAllTabs: () => void
  setCurrentSession: (filePath: string | null, name?: string) => void

  // ── Active tab actions (backwards compatible) ──
  setThreadId: (threadId: string | null) => void
  addUserMessage: (content: string) => void
  setMessages: (messages: ChatMessage[]) => void
  handleRuntimeEvent: (event: RuntimeEvent) => void
  clearMessages: () => void
  resolveRequest: (requestId: string, decision: string, value?: string) => Promise<void>
  setError: (error: string | null) => void
}

// ============================================================================
// Helpers to sync active tab → flat state
// ============================================================================

function tabToFlat(tab: ChatTab) {
  return {
    threadId: tab.threadId,
    messages: tab.messages,
    isStreaming: tab.isStreaming,
    pendingRequests: tab.pendingRequests,
    error: tab.error,
    totalInputTokens: tab.totalInputTokens,
    totalOutputTokens: tab.totalOutputTokens,
    totalCacheReadTokens: tab.totalCacheReadTokens,
    totalCacheWriteTokens: tab.totalCacheWriteTokens,
    totalCost: tab.totalCost,
    lastUsage: tab.lastUsage,
  }
}

function emptyFlat() {
  return {
    threadId: null as string | null,
    messages: [] as ChatMessage[],
    isStreaming: false,
    pendingRequests: [] as ApprovalRequest[],
    error: null as string | null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    lastUsage: null,
  }
}

/**
 * Update the active tab in the tabs array AND sync flat properties.
 */
function updateActive(set: SetFn, updater: (tab: ChatTab) => ChatTab): void {
  set((state) => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId)
    if (!tab) return state
    const updated = updater(tab)
    const tabs = state.tabs.map((t) => (t.id === state.activeTabId ? updated : t))
    return { tabs, ...tabToFlat(updated) }
  })
}

// ============================================================================
// Store
// ============================================================================

export const useChatStore = create<ChatState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  currentSessionFilePath: null,
  currentSessionName: null,
  ...emptyFlat(),

  // ── Tab Management ──────────────────────────────────────────────────────

  createTab: ({ cwd, threadId, provider, model, label, sessionFilePath, conversationId }) => {
    const tab = emptyTab({
      id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      threadId,
      cwd,
      provider,
      model,
      label: label || 'New Chat',
      sessionFilePath,
      conversationId,
    })
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      ...tabToFlat(tab),
    }))
    return tab.id
  },

  closeTab: (tabId) => {
    const state = get()
    const tab = state.tabs.find((t) => t.id === tabId)
    if (!tab) return

    // Kill the pi session
    if (tab.threadId) {
      window.piStudio.pi.stopSession(tab.threadId).catch(() => {})
    }

    const newTabs = state.tabs.filter((t) => t.id !== tabId)
    const wasActive = state.activeTabId === tabId

    if (wasActive && newTabs.length > 0) {
      // Activate the last remaining tab
      const nextTab = newTabs[newTabs.length - 1]
      set({ tabs: newTabs, activeTabId: nextTab.id, ...tabToFlat(nextTab) })
    } else if (newTabs.length === 0) {
      set({ tabs: newTabs, activeTabId: null, ...emptyFlat() })
    } else {
      set({ tabs: newTabs })
    }
  },

  switchToTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    set((state) => ({
      activeTabId: tabId,
      ...tabToFlat(tab),
      // Sync session context when switching tabs
      currentSessionFilePath: tab.sessionFilePath ?? state.currentSessionFilePath,
    }))
  },

  closeAllTabs: () => {
    const state = get()
    for (const tab of state.tabs) {
      if (tab.threadId) {
        window.piStudio.pi.stopSession(tab.threadId).catch(() => {})
      }
    }
    set({ tabs: [], activeTabId: null, currentSessionFilePath: null, currentSessionName: null, ...emptyFlat() })
  },

  setCurrentSession: (filePath, name) => set({ currentSessionFilePath: filePath, currentSessionName: name ?? null }),

  // ── Active Tab Actions (backwards compatible) ───────────────────────────

  setThreadId: (threadId) => {
    updateActive(set, (tab) => ({ ...tab, threadId: threadId ?? tab.threadId }))
  },

  addUserMessage: (content) => {
    const msg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    updateActive(set, (tab) => ({
      ...tab,
      messages: [...tab.messages, msg],
      // Auto-rename tab on first user message
      label: tab.label === 'New Chat' ? content.substring(0, 60) : tab.label,
    }))
    // Auto-rename session indicator on first message
    const state = get()
    if (state.currentSessionName === 'New Session') {
      set({ currentSessionName: content.substring(0, 60) })
    }
  },

  setMessages: (messages) => {
    updateActive(set, (tab) => ({
      ...tab,
      messages,
      error: null,
    }))
  },

  clearMessages: () => {
    updateActive(set, (tab) => ({
      ...tab,
      messages: [],
      pendingRequests: [],
      error: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCost: 0,
      lastUsage: null,
      status: 'idle',
    }))
  },

  setError: (error) => {
    updateActive(set, (tab) => ({ ...tab, error }))
  },

  resolveRequest: async (requestId, decision, value) => {
    // Find which tab owns this request
    const state = get()
    const tab = state.tabs.find((t) => t.pendingRequests.some((r) => r.id === requestId))
    if (!tab?.threadId) return
    try {
      await window.piStudio.pi.respondRequest(tab.threadId, requestId, decision, value)
    } catch (err) {
      console.error('[ChatStore] Failed to resolve request:', err)
    }
  },

  // ── Event Routing ───────────────────────────────────────────────────────

  handleRuntimeEvent: (event) => {
    const state = get()

    // Find the tab that owns this event (by threadId)
    const tab = state.tabs.find((t) => t.threadId === event.threadId)
    if (!tab) return // Unknown thread — ignore

    // Apply event to the tab
    const updatedTab = applyEventToTab(tab, event)

    if (tab.id === state.activeTabId) {
      // Active tab — update tab data AND flat properties
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tab.id ? updatedTab : t)),
        ...tabToFlat(updatedTab),
      }))
    } else {
      // Background tab — only update the tabs array (for status dots)
      // Don't touch flat state since the user isn't looking at this tab
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tab.id ? updatedTab : t)),
      }))
    }
  },
}))

/**
 * Chat Store - Manages chat messages, streaming state, and turn lifecycle.
 *
 * Driven by RuntimeEvent from the PiRuntime via IPC.
 */

import { create } from 'zustand'
import type {
  RuntimeEvent,
  ChatMessage,
  ToolCallInfo,
  ApprovalRequest,
} from '../../../shared/types'
import { uuid } from '../lib/utils'

interface ChatState {
  threadId: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  pendingRequests: ApprovalRequest[]
  error: string | null

  setThreadId: (threadId: string | null) => void
  addUserMessage: (content: string) => void
  setMessages: (messages: ChatMessage[]) => void
  handleRuntimeEvent: (event: RuntimeEvent) => void
  clearMessages: () => void
  resolveRequest: (requestId: string, decision: string, value?: string) => Promise<void>
  setError: (error: string | null) => void
}

/**
 * Ensure there is a streaming assistant message at the end of the messages array.
 * If not, create one. Returns the updated messages array.
 */
function ensureAssistantMessage(messages: ChatMessage[], itemId?: string): ChatMessage[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant' && last.isStreaming) {
    return messages
  }
  // No streaming assistant message — create one
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

export const useChatStore = create<ChatState>((set, get) => ({
  threadId: null,
  messages: [],
  isStreaming: false,
  pendingRequests: [],
  error: null,

  setThreadId: (threadId) => set({ threadId }),

  addUserMessage: (content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: uuid(),
          role: 'user',
          content,
          timestamp: Date.now(),
        },
      ],
    })),

  setMessages: (messages: ChatMessage[]) => set({ messages: messages, error: null }),

  handleRuntimeEvent: (event) => {
    switch (event.type) {
      case 'session.started':
        break

      case 'session.state.changed': {
        const running = event.payload.state === 'running'
        set({ isStreaming: running })
        break
      }

      case 'turn.started': {
        // Ensure an assistant message exists for this turn
        set((s) => {
          const messages = ensureAssistantMessage(s.messages, event.itemId)
          if (messages.length === s.messages.length) {
            // Already existed — just ensure streaming
            return { isStreaming: true, error: null }
          }
          return { messages, isStreaming: true, error: null }
        })
        break
      }

      case 'content.delta': {
        const { streamKind, delta } = event.payload
        if (!delta) break

        set((s) => {
          // Always ensure there's a streaming assistant message
          let messages = ensureAssistantMessage([...s.messages], event.itemId)
          const lastMsg = messages[messages.length - 1]

          if (streamKind === 'assistant_thinking') {
            messages[messages.length - 1] = {
              ...lastMsg,
              thinking: (lastMsg.thinking || '') + delta,
            }
          } else {
            // assistant_text or anything else → content
            messages[messages.length - 1] = {
              ...lastMsg,
              content: lastMsg.content + delta,
            }
          }

          return { messages }
        })
        break
      }

      case 'item.started': {
        if (event.payload.itemType === 'dynamic_tool_call') {
          const toolCall: ToolCallInfo = {
            id: event.itemId || uuid(),
            name: event.payload.title || 'Tool',
            status: 'inProgress',
          }

          set((s) => {
            let messages = ensureAssistantMessage([...s.messages])
            const lastMsg = messages[messages.length - 1]
            messages[messages.length - 1] = {
              ...lastMsg,
              toolCalls: [...(lastMsg.toolCalls || []), toolCall],
            }
            return { messages }
          })
        }
        break
      }

      case 'item.updated': {
        if (event.payload.itemType === 'dynamic_tool_call' && event.itemId) {
          set((s) => {
            const messages = [...s.messages]
            const lastMsg = messages[messages.length - 1]
            if (lastMsg?.toolCalls) {
              const toolCalls = lastMsg.toolCalls.map((tc) =>
                tc.id === event.itemId ? { ...tc, ...event.payload.data } : tc
              )
              messages[messages.length - 1] = { ...lastMsg, toolCalls }
            }
            return { messages }
          })
        }
        break
      }

      case 'item.completed': {
        if (event.payload.itemType === 'dynamic_tool_call' && event.itemId) {
          set((s) => {
            const messages = [...s.messages]
            const lastMsg = messages[messages.length - 1]
            if (lastMsg?.toolCalls) {
              const toolCalls = lastMsg.toolCalls.map((tc) =>
                tc.id === event.itemId
                  ? { ...tc, status: 'completed' as const, result: event.payload.data }
                  : tc
              )
              messages[messages.length - 1] = { ...lastMsg, toolCalls }
            }
            return { messages }
          })
        }
        // assistant_message completion — let turn.completed handle it
        break
      }

      case 'turn.completed': {
        set((s) => {
          const messages = [...s.messages]
          const lastMsg = messages[messages.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            messages[messages.length - 1] = {
              ...lastMsg,
              isStreaming: false,
              status: event.payload.state === 'completed' ? 'completed' : 'error',
              errorMessage: event.payload.errorMessage,
            }
          }
          return { messages, isStreaming: false }
        })
        if (event.payload.errorMessage) {
          set({ error: event.payload.errorMessage })
        }
        break
      }

      case 'runtime.error': {
        set({ error: event.payload.message, isStreaming: false })
        set((s) => {
          const messages = [...s.messages]
          const lastMsg = messages[messages.length - 1]
          if (lastMsg && lastMsg.isStreaming) {
            messages[messages.length - 1] = {
              ...lastMsg,
              isStreaming: false,
              status: 'error',
              errorMessage: event.payload.message,
            }
          }
          return { messages }
        })
        break
      }

      case 'runtime.warning':
        break

      case 'request.opened': {
        const args = event.payload.args as {
          id: string
          method: string
          title?: string
          message?: string
          options?: string[]
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
          set((s) => ({
            pendingRequests: [...s.pendingRequests, request],
          }))
        }
        break
      }

      case 'request.resolved': {
        set((s) => ({
          pendingRequests: s.pendingRequests.filter((r) => r.id !== event.requestId),
        }))
        break
      }

      case 'session.exited':
        set({ isStreaming: false, error: event.payload.reason })
        break
    }
  },

  clearMessages: () =>
    set({ messages: [], pendingRequests: [], error: null }),

  resolveRequest: async (requestId, decision, value) => {
    const { threadId } = get()
    if (!threadId) return
    try {
      await window.piStudio.pi.respondRequest(threadId, requestId, decision, value)
    } catch (err) {
      console.error('[ChatStore] Failed to resolve request:', err)
    }
  },

  setError: (error) => set({ error }),
}))

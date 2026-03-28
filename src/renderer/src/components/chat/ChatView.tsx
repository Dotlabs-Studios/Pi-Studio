/**
 * ChatView - Main chat area with message list, composer, and @mentions.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react'
import {
  Send, Square, AlertCircle, CheckCircle, XCircle, Loader2, Terminal,
  Copy, RotateCcw, ChevronDown, ChevronRight, Brain,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea, Badge } from '@/components/ui/primitives'
import { useChatStore } from '@/stores/chat-store'
import { useProjectStore } from '@/stores/project-store'
import { useProviderStore } from '@/stores/provider-store'
import { useToastStore } from '@/stores/toast-store'
import { useUIStore } from '@/stores/ui-store'
import { uuid, debounce } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { ChatMessage, ToolCallInfo, ApprovalRequest } from '../../../shared/types'

export function ChatView() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { messages, isStreaming, error, pendingRequests, resolveRequest } = useChatStore()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          {messages.length === 0 && !error && <EmptyState />}
          {messages.map(message => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {pendingRequests.map(request => (
            <ApprovalRequestCard key={request.id} request={request} onResolve={(d, v) => resolveRequest(request.id, d, v)} />
          ))}
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 animate-fade-in">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-destructive font-medium">Error</p>
                <p className="text-xs text-destructive/80 mt-1">{error}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => useChatStore.getState().setError(null)} title="Dismiss">
                  <XCircle className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      <Composer />
    </div>
  )
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState() {
  const { currentProject } = useProjectStore()
  const { threadId } = useChatStore()

  if (threadId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <Terminal className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Pi Studio Ready</h2>
        <p className="text-sm text-muted-foreground max-w-md">Pi agent is connected and ready. Type a message below to start.</p>
        <div className="flex flex-wrap gap-2 mt-6 justify-center">
          {['Explain this codebase', 'Fix any bugs', 'Refactor for clarity', 'Add tests'].map(s => (
            <SuggestionChip key={s} text={s} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center mb-4">
        <span className="text-xl font-bold text-white">π</span>
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        {currentProject ? 'Start a Conversation' : 'Open a Project'}
      </h2>
      <p className="text-sm text-muted-foreground max-w-md">
        {currentProject
          ? 'Click "New Chat" or start typing below.'
          : 'Open a project folder from the header to start working with pi agent.'}
      </p>
    </div>
  )
}

function SuggestionChip({ text }: { text: string }) {
  const { currentProject } = useProjectStore()
  return (
    <button
      onClick={() => {
        // Find the composer textarea and set its value
        const el = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Ask pi"]')
        if (el) {
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
          nativeSet?.call(el, text)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.focus()
        }
      }}
      disabled={!currentProject}
      className="px-3 py-1.5 rounded-full border border-border bg-card text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-40"
    >
      {text}
    </button>
  )
}

// ============================================================================
// Message Bubble
// ============================================================================

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const { addToast } = useToastStore()

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    addToast('Copied to clipboard', 'success', 2000)
  }

  return (
    <div className={cn('flex gap-3 animate-slide-up', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5', isUser ? 'bg-primary/20 text-primary' : 'bg-gradient-to-br from-primary to-purple-500 text-white')}>
        {isUser ? (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        ) : (
          <span className="text-xs font-bold">π</span>
        )}
      </div>

      <div className={cn('flex flex-col max-w-[80%] min-w-0', isUser ? 'items-end' : 'items-start')}>
        <div className={cn(
          'rounded-xl px-4 py-3 text-sm group relative',
          isUser ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary/70 text-foreground rounded-tl-sm',
          message.status === 'error' && 'border border-destructive/30',
          message.status === 'inProgress' && 'ring-1 ring-primary/20'
        )}>
          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="space-y-2 mb-2">
              {message.toolCalls.map(tc => <ToolCallCard key={tc.id} toolCall={tc} />)}
            </div>
          )}

          {/* Thinking block */}
          {message.thinking && (
            <ThinkingBlock text={message.thinking} isStreaming={!!message.isStreaming && !message.content} />
          )}

          {/* Content */}
          <div className={cn('message-content', message.isStreaming && !message.content && 'streaming-cursor')}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : message.content ? (
              <ReactMarkdown components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const isInline = !match
                  if (isInline) {
                    return <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-primary" {...props}>{children}</code>
                  }
                  return (
                    <div className="relative my-2">
                      <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ margin: 0, borderRadius: '0.5rem', background: 'hsl(0 0% 5%)', fontSize: '0.8125rem' }} {...props}>
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                      <button onClick={() => { navigator.clipboard.writeText(String(children)); addToast('Code copied', 'success', 2000) }}
                        className="absolute top-2 right-2 p-1 rounded hover:bg-white/10 transition-colors text-white/40 hover:text-white">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                },
              }}>
                {message.content}
              </ReactMarkdown>
            ) : message.isStreaming && !message.thinking ? (
              <span className="text-muted-foreground text-xs flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />Thinking...
              </span>
            ) : null}
          </div>

          {/* Copy button (assistant only, on hover) */}
          {!isUser && message.content && !message.isStreaming && (
            <button onClick={handleCopy} className="absolute -bottom-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 rounded-full bg-secondary border border-border flex items-center justify-center hover:bg-card" title="Copy">
              <Copy className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {message.status === 'error' && message.errorMessage && (
          <p className="text-xs text-destructive mt-1 px-1">{message.errorMessage}</p>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Thinking Block — collapsible reasoning display
// ============================================================================

function ThinkingBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const hasText = text.length > 0

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full',
          !hasText && 'animate-pulse'
        )}
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Brain className="w-3 h-3" />
        {hasText
          ? (isStreaming ? 'Thinking...' : 'Thoughts')
          : <><Loader2 className="w-3 h-3 animate-spin" />Thinking...</>
        }
      </button>
      {expanded && hasText && (
        <div className="mt-1.5 pl-4 border-l-2 border-primary/30 text-xs text-muted-foreground whitespace-pre-wrap max-h-60 overflow-auto custom-scrollbar">
          {text}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Tool Call Card
// ============================================================================

function ToolCallCard({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false)
  const isInProgress = toolCall.status === 'inProgress'

  return (
    <div className={cn('rounded-lg border border-border bg-background/50 text-xs', isInProgress && 'tool-pulse')}>
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 px-3 py-2 w-full text-left">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground truncate flex-1">{toolCall.name}</span>
        {isInProgress ? (
          <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
        ) : toolCall.status === 'completed' ? (
          <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
        ) : (
          <XCircle className="w-3 h-3 text-destructive shrink-0" />
        )}
        <ChevronDown className={cn('w-3 h-3 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && toolCall.result && (
        <div className="px-3 pb-2 border-t border-border">
          <pre className="mt-2 p-2 bg-background rounded text-[10px] overflow-auto max-h-40 custom-scrollbar">
            {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Approval Request Card
// ============================================================================

function ApprovalRequestCard({ request, onResolve }: { request: ApprovalRequest; onResolve: (d: string, v?: string) => void }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-orange-500/10 border border-orange-500/20 animate-slide-up">
      <AlertCircle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{request.title}</p>
        {request.message && <p className="text-xs text-muted-foreground mt-1">{request.message}</p>}
        {request.options && request.options.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {request.options.map((option: string) => (
              <Button key={option} variant="secondary" size="sm" onClick={() => onResolve('allow', option)}>{option}</Button>
            ))}
          </div>
        )}
        {(!request.options || request.options.length === 0) && (
          <div className="flex items-center gap-2 mt-3">
            <Button size="sm" onClick={() => onResolve('allow')} className="bg-green-600 hover:bg-green-700"><CheckCircle className="w-3.5 h-3.5 mr-1" />Allow</Button>
            <Button variant="secondary" size="sm" onClick={() => onResolve('decline')}><XCircle className="w-3.5 h-3.5 mr-1" />Decline</Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Composer with @mentions
// ============================================================================

function Composer() {
  const [input, setInput] = useState('')
  const [mentionQuery, setMentionQuery] = useState('')
  const [showMentions, setShowMentions] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const { threadId, isStreaming, addUserMessage } = useChatStore()
  const { currentProject } = useProjectStore()
  const { selectedProvider, selectedModel } = useProviderStore()
  const { addToast } = useToastStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Available mention items
  const mentionItems = useMemo(() => {
    const items = [
      { type: 'command' as const, label: '@file', desc: 'Reference a file' },
      { type: 'command' as const, label: '@skill', desc: 'Reference a skill' },
      { type: 'command' as const, label: '@session', desc: 'Reference a session' },
      { type: 'command' as const, label: '@config', desc: 'Reference config' },
    ]
    if (mentionQuery) {
      return items.filter(i => i.label.toLowerCase().includes(mentionQuery.toLowerCase()))
    }
    return items
  }, [mentionQuery])

  const handleSend = async (overrideInput?: string) => {
    const text = overrideInput ?? input.trim()
    if (!text || !currentProject) return

    const state = useChatStore.getState()
    let activeThreadId = state.threadId

    if (!activeThreadId) {
      activeThreadId = uuid()
      const tab = useChatStore.getState().tabs.find(t => t.id === useChatStore.getState().activeTabId)
      try {
        await window.piStudio.pi.startSession({
          threadId: activeThreadId, cwd: currentProject,
          provider: selectedProvider ?? undefined, model: selectedModel ?? undefined,
          sessionFilePath: tab?.sessionFilePath,
          conversationId: tab?.conversationId,
        })
        useChatStore.getState().setThreadId(activeThreadId)
        if (!tab?.sessionFilePath) {
          // New session was created — save the filePath
          useChatStore.getState().setCurrentSession(useChatStore.getState().currentSessionFilePath || '')
          useProjectStore.getState().bumpSessionList()
        }
      } catch (err: any) {
        addToast(err.message || 'Failed to start session', 'error')
        return
      }
    }

    addUserMessage(text)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      await window.piStudio.pi.sendTurn(activeThreadId, text)
    } catch (err: any) {
      addToast(err.message || 'Failed to send', 'error')
    }
  }

  const handleInterrupt = async () => {
    if (!threadId) return
    try { await window.piStudio.pi.interrupt(threadId) } catch (err) { console.error(err) }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Mention menu navigation
    if (showMentions) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionItems.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const item = mentionItems[mentionIndex]
        if (item) insertMention(item.label)
        return
      }
      if (e.key === 'Escape') { setShowMentions(false); return }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isStreaming) return
      handleSend()
    }
  }

  const insertMention = (label: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart
    // Find the @ symbol before cursor
    const before = input.substring(0, pos)
    const atIndex = before.lastIndexOf('@')
    const beforeMention = input.substring(0, atIndex)
    const after = input.substring(pos)
    setInput(`${beforeMention}${label} ${after}`)
    setShowMentions(false)
    setMentionQuery('')
    // Restore cursor position
    requestAnimationFrame(() => {
      const newPos = atIndex + label.length + 1
      textarea.selectionStart = textarea.selectionEnd = newPos
      textarea.focus()
    })
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'

    // Detect @mentions
    const pos = textarea.selectionStart
    const before = val.substring(0, pos)
    const atMatch = before.match(/@(\w*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionIndex(0)
      setShowMentions(true)
    } else {
      setShowMentions(false)
    }
  }

  return (
    <div className="border-t border-border bg-card/20 px-4 py-3 relative">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={currentProject ? 'Ask pi anything... (@ for mentions)' : 'Open a project to start chatting...'}
              disabled={!currentProject}
              rows={1}
              className={cn(
                'w-full resize-none rounded-xl border border-border bg-background px-4 py-3 pr-12 text-sm',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed custom-scrollbar'
              )}
              style={{ minHeight: '44px', maxHeight: '200px' }}
            />

            {/* @Mention dropdown */}
            {showMentions && mentionItems.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg border border-border bg-popover p-1 shadow-xl animate-fade-in z-20">
                {mentionItems.map((item, i) => (
                  <button
                    key={item.label}
                    onClick={() => insertMention(item.label)}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={cn(
                      'flex flex-col w-full px-3 py-2 rounded-md text-sm transition-colors text-left',
                      i === mentionIndex ? 'bg-secondary/50 text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
                    )}
                  >
                    <span className="font-medium">{item.label}</span>
                    <span className="text-[10px]">{item.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {isStreaming ? (
              <Button variant="destructive" size="icon" className="absolute right-2 bottom-2 h-8 w-8 rounded-lg" onClick={handleInterrupt} title="Stop generation (Escape)">
                <Square className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="absolute right-2 bottom-2 h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground" onClick={() => handleSend()} disabled={!input.trim() || !currentProject} title="Send (Enter)">
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <p className="text-[10px] text-muted-foreground/40">Powered by pi coding agent</p>
          <div className="flex gap-2 text-[10px] text-muted-foreground/30">
            <span>Enter send</span><span>Shift+Enter newline</span><span>@ mentions</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Pi Runtime - Core module for managing pi CLI child processes.
 *
 * Adapted from PiAdapter.ts (T3 Code) to work as a standalone module
 * without Effect/Layer dependencies. Uses Node.js child_process with
 * RPC mode (JSONL over stdio).
 *
 * Key design decisions:
 * - JSONL reader splits ONLY on `\n` (not U+2028/U+2029) for protocol compliance
 * - Request/response queue with configurable timeout
 * - Event mapping from native pi events → canonical RuntimeEvent types
 * - Support for multiple concurrent sessions
 */

import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import path from 'node:path'
import os from 'node:os'

import { eventBus } from './event-bus'
import type {
  RuntimeEvent,
  StartSessionOptions,
  SessionInfo,
  PiEvent,
} from '../shared/types'

// ============================================================================
// Constants
// ============================================================================

const PI_STDIO_TIMEOUT_MS = 30_000
const SESSION_INIT_DELAY_MS = 500

// ============================================================================
// Internal Types
// ============================================================================

interface PendingRequest {
  method: string
  timeout: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface PendingUIRequest {
  requestId: string
  jsonRpcId: string
  method: string
}

interface PiSessionContext {
  threadId: string
  child: ChildProcessWithoutNullStreams
  pending: Map<string, PendingRequest>
  pendingUIRequests: Map<string, PendingUIRequest>
  nextRequestId: number
  stopping: boolean
  activeTurnId: string | undefined
  activeAssistantItemId: string | undefined
  accumulatedAssistantText: string
  /** True if at least one content.delta was already emitted (streaming occurred). */
  hasEmittedDeltas: boolean
  cwd: string
  model: string | undefined
  provider: string | undefined
}

// ============================================================================
// Helpers
// ============================================================================

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message
  return String(fallback)
}

/**
 * Extract assistant text content from a pi AgentMessage.
 */
function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const msg = message as Record<string, unknown>
  if (msg.role !== 'assistant') return ''
  const content = msg.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block: unknown) => {
      if (!block || typeof block !== 'object') return false
      return (block as Record<string, unknown>).type === 'text'
    })
    .map((block: unknown) => {
      const b = block as Record<string, unknown>
      return typeof b.text === 'string' ? b.text : ''
    })
    .join('')
}

function makeEventId(): string {
  return randomUUID()
}

// ============================================================================
// Pi Runtime
// ============================================================================

class PiRuntime {
  private sessions = new Map<string, PiSessionContext>()
  private binaryPath: string = 'pi'

  constructor() {
    this.detectBinaryPath()
  }

  /**
   * Try to detect the pi binary path.
   */
  private detectBinaryPath(): void {
    // Default: rely on PATH
    // Could be overridden by settings
    this.binaryPath = 'pi'
  }

  /**
   * Set a custom binary path.
   */
  setBinaryPath(path: string): void {
    this.binaryPath = path
  }

  /**
   * Get the current binary path.
   */
  getBinaryPath(): string {
    return this.binaryPath
  }

  // ---------------------------------------------------------------------------
  // JSONL Reader — splits on `\n` ONLY (not U+2028 / U+2029)
  // ---------------------------------------------------------------------------

  private attachJsonlReader(
    stream: NodeJS.ReadableStream,
    onLine: (line: string) => void
  ): void {
    const decoder = new StringDecoder('utf8')
    let buffer = ''

    const onData = (chunk: Buffer | string): void => {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        // Strip optional trailing \r
        if (line.endsWith('\r')) line = line.slice(0, -1)
        onLine(line)
      }
    }

    const onEnd = (): void => {
      buffer += decoder.end()
      if (buffer.length > 0) {
        const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
        onLine(line)
        buffer = ''
      }
    }

    stream.on('data', onData)
    stream.on('end', onEnd)
  }

  // ---------------------------------------------------------------------------
  // RPC Communication
  // ---------------------------------------------------------------------------

  private sendRequest(
    context: PiSessionContext,
    command: unknown,
    timeoutMs = PI_STDIO_TIMEOUT_MS
  ): Promise<unknown> {
    const id = String(context.nextRequestId)
    context.nextRequestId += 1

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        context.pending.delete(id)
        console.error(`[pi-runtime] TIMEOUT id=${id} cmd=${(command as Record<string, unknown>)?.type}`)
        reject(new Error(`Timed out waiting for command response (id=${id})`))
      }, timeoutMs)

      context.pending.set(id, { method: 'rpc', timeout, resolve, reject })

      const fullCommand = { ...(command as Record<string, unknown>), id }
      const encoded = JSON.stringify(fullCommand)

      if (context.child.stdin.writable) {
        console.log(`[pi-runtime] >> id=${id} ${encoded.substring(0, 300)}`)
        context.child.stdin.write(`${encoded}\n`)
      } else {
        clearTimeout(timeout)
        context.pending.delete(id)
        reject(new Error('stdin not writable — process may have exited'))
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Pi native event → canonical RuntimeEvent mapping
  // ---------------------------------------------------------------------------

  private mapPiNativeToRuntime(
    context: PiSessionContext,
    event: { type?: string; [key: string]: unknown }
  ): RuntimeEvent[] {
    const eventId = makeEventId()
    const threadId = context.threadId
    const createdAt = new Date().toISOString()

    switch (event.type) {
      // ---- Agent lifecycle --------------------------------------------------
      case 'agent_start':
        // Don't re-emit session.state.changed — sendTurn() already emitted it
        return []

      case 'agent_end': {
        const turnId = context.activeTurnId
        const assistantItemId = context.activeAssistantItemId
        const accumulatedLen = context.accumulatedAssistantText.length
        const hadStreaming = context.hasEmittedDeltas
        context.activeTurnId = undefined
        context.activeAssistantItemId = undefined
        context.accumulatedAssistantText = ''
        context.hasEmittedDeltas = false

        const events: RuntimeEvent[] = []

        // Extract final assistant text from messages (fallback for non-streamed responses)
        let finalText = ''
        let errorMessage: string | undefined

        if (Array.isArray(event.messages)) {
          for (const msg of event.messages) {
            const text = extractAssistantText(msg)
            if (text.length > finalText.length) finalText = text
            const rec = msg as Record<string, unknown> | undefined
            if (rec?.role === 'assistant' && rec.stopReason === 'error') {
              errorMessage = typeof rec.errorMessage === 'string' ? rec.errorMessage : 'Provider error'
            }
          }
        }

        // Only emit content.delta if NO streaming occurred (fallback path)
        // If hasEmittedDeltas is true, the text was already streamed — skip to avoid duplication
        if (turnId && finalText.length > 0 && !hadStreaming) {
          const itemId = assistantItemId ?? randomUUID()
          events.push({
            type: 'content.delta',
            eventId: makeEventId(),
            threadId,
            turnId,
            itemId,
            payload: { streamKind: 'assistant_text', delta: finalText },
          })
          events.push({
            type: 'item.completed',
            eventId: makeEventId(),
            threadId,
            turnId,
            itemId,
            payload: {
              itemType: 'assistant_message',
              status: 'completed',
              title: 'Assistant message',
              detail: finalText.length > 0 ? finalText : undefined,
            },
          })
        }

        // If streaming occurred, just mark the assistant message as completed
        if (turnId && hadStreaming) {
          const itemId = assistantItemId ?? randomUUID()
          events.push({
            type: 'item.completed',
            eventId: makeEventId(),
            threadId,
            turnId,
            itemId,
            payload: {
              itemType: 'assistant_message',
              status: errorMessage ? 'error' : 'completed',
              title: 'Assistant message',
            },
          })
        }

        // Error event
        if (errorMessage) {
          events.push({
            type: 'runtime.error',
            eventId: makeEventId(),
            threadId,
            turnId,
            payload: { message: errorMessage, class: 'provider_error' },
          })
        }

        // Extract token usage from assistant messages
        if (Array.isArray(event.messages)) {
          for (const msg of event.messages) {
            if (msg && typeof msg === 'object' && (msg as Record<string, unknown>).role === 'assistant') {
              const usage = (msg as Record<string, unknown>).usage as
                | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } }
                | undefined
              if (usage && (usage.input || usage.output)) {
                const inputTokens = usage.input ?? 0
                const outputTokens = usage.output ?? 0
                const cacheReadTokens = usage.cacheRead ?? 0
                const cacheWriteTokens = usage.cacheWrite ?? 0
                const cost = usage.cost?.total ?? 0
                events.push({
                  type: 'turn.usage',
                  eventId: makeEventId(),
                  threadId,
                  turnId,
                  payload: {
                    inputTokens,
                    outputTokens,
                    cacheReadTokens,
                    cacheWriteTokens,
                    totalTokens: inputTokens + outputTokens,
                    cost,
                  },
                })
              }
            }
          }
        }

        // Turn completed
        if (turnId) {
          events.push({
            type: 'turn.completed',
            eventId: makeEventId(),
            threadId,
            turnId,
            payload: {
              state: errorMessage ? 'failed' : 'completed',
              ...(errorMessage ? { errorMessage } : {}),
            },
          })
        }

        events.push({
          type: 'session.state.changed',
          eventId: makeEventId(),
          threadId,
          payload: { state: 'ready', reason: 'Pi agent finished' },
        })

        return events
      }

      // ---- Turn lifecycle ---------------------------------------------------
      case 'turn_start':
        return [] // We emit turn.started from sendTurn to avoid double

      case 'turn_end': {
        const turnMessage = event.message
        if (turnMessage) {
          const text = extractAssistantText(turnMessage)
          if (text.length > context.accumulatedAssistantText.length) {
            context.accumulatedAssistantText = text
          }
        }
        return []
      }

      // ---- Message lifecycle ------------------------------------------------
      case 'message_start':
        return []

      case 'message_update': {
        const assistantEvent = event.assistantMessageEvent as {
          type?: string
          delta?: string
        }
        // Handle text deltas (actual response content)
        if (assistantEvent?.type === 'text_delta' && assistantEvent.delta) {
          if (!context.activeAssistantItemId) {
            context.activeAssistantItemId = randomUUID()
          }
          context.accumulatedAssistantText += assistantEvent.delta
          context.hasEmittedDeltas = true
          return [
            {
              type: 'content.delta',
              eventId,
              threadId,
              turnId: context.activeTurnId,
              itemId: context.activeAssistantItemId,
              payload: {
                streamKind: 'assistant_text',
                delta: assistantEvent.delta,
              },
            },
          ]
        }
        // Handle thinking deltas (reasoning content)
        if (assistantEvent?.type === 'thinking_delta' && assistantEvent.delta) {
          if (!context.activeAssistantItemId) {
            context.activeAssistantItemId = randomUUID()
          }
          return [
            {
              type: 'content.delta',
              eventId,
              threadId,
              turnId: context.activeTurnId,
              itemId: context.activeAssistantItemId,
              payload: {
                streamKind: 'assistant_thinking',
                delta: assistantEvent.delta,
              },
            },
          ]
        }
        return []
      }

      case 'message_end':
        return []

      // ---- Tool execution --------------------------------------------------
      case 'tool_execution_start': {
        const toolName = typeof event.toolName === 'string' ? event.toolName : undefined
        const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
        return [
          {
            type: 'item.started',
            eventId,
            threadId,
            turnId: context.activeTurnId,
            itemId: toolCallId,
            payload: {
              itemType: 'dynamic_tool_call',
              status: 'inProgress',
              title: toolName ?? 'Tool',
              detail: `${toolName ?? 'Tool'} started`,
              data: event,
            },
          },
        ]
      }

      case 'tool_execution_update': {
        const toolName = typeof event.toolName === 'string' ? event.toolName : undefined
        const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
        return [
          {
            type: 'item.updated',
            eventId,
            threadId,
            turnId: context.activeTurnId,
            itemId: toolCallId,
            payload: { itemType: 'dynamic_tool_call', title: toolName ?? 'Tool', data: event },
          },
        ]
      }

      case 'tool_execution_end': {
        const toolName = typeof event.toolName === 'string' ? event.toolName : undefined
        const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
        return [
          {
            type: 'item.completed',
            eventId,
            threadId,
            turnId: context.activeTurnId,
            itemId: toolCallId,
            payload: {
              itemType: 'dynamic_tool_call',
              status: 'completed',
              title: toolName ?? 'Tool',
              detail: `${toolName ?? 'Tool'} completed`,
              data: event,
            },
          },
        ]
      }

      // ---- Extension UI (approval / user-input) -----------------------------
      case 'extension_ui_request': {
        const uiRequest = event as {
          id: string
          method: string
          title?: string
          message?: string
          options?: string[]
        }
        const requestId = randomUUID()

        context.pendingUIRequests.set(requestId, {
          requestId,
          jsonRpcId: uiRequest.id,
          method: uiRequest.method,
        })

        return [
          {
            type: 'request.opened',
            eventId,
            threadId,
            requestId,
            payload: {
              requestType: 'command_execution_approval',
              detail: uiRequest.title ?? uiRequest.message ?? uiRequest.method,
              args: uiRequest,
            },
          },
        ]
      }

      // ---- Errors -----------------------------------------------------------
      case 'extension_error':
        return [
          {
            type: 'runtime.error',
            eventId,
            threadId,
            turnId: context.activeTurnId,
            payload: {
              message: String(event.error ?? 'Extension error'),
              class: 'provider_error',
              detail: event,
            },
          },
        ]

      case 'auto_retry_start':
        return [
          {
            type: 'runtime.warning',
            eventId,
            threadId,
            payload: {
              message: `Auto-retry attempt ${event.attempt ?? 1}/${event.maxAttempts ?? '?'}`,
              detail: event,
            },
          },
        ]

      case 'auto_retry_end':
        return []

      case 'auto_compaction_start':
        return [
          {
            type: 'runtime.warning',
            eventId,
            threadId,
            payload: { message: 'Auto-compaction started' },
          },
        ]

      case 'auto_compaction_end':
        return [
          {
            type: 'runtime.warning',
            eventId,
            threadId,
            payload: { message: 'Auto-compaction completed' },
          },
        ]

      default:
        return []
    }
  }

  // ---------------------------------------------------------------------------
  // stdout / stderr handling
  // ---------------------------------------------------------------------------

  private handlePiOutput(context: PiSessionContext, line: string): void {
    if (line.length === 0) return
    console.log(`[pi-runtime] << ${line.substring(0, 500)}`)

    try {
      const parsed = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object') return

      const event = parsed as { id?: string; type?: string; [key: string]: unknown }

      // Handle JSON-RPC responses
      if (event.type === 'response' && event.id) {
        const key = String(event.id)
        const pending = context.pending.get(key)
        if (pending) {
          clearTimeout(pending.timeout)
          context.pending.delete(key)
          if (event.success === false && event.error) {
            pending.reject(new Error(String(event.error)))
          } else {
            pending.resolve(event.data)
          }
        }
        return
      }

      // Map native pi events → canonical runtime events
      const runtimeEvents = this.mapPiNativeToRuntime(context, event)
      for (const re of runtimeEvents) {
        if (re.type === 'content.delta') {
          console.log(`[pi-runtime] >> emit ${re.type} kind=${re.payload.streamKind} delta="${re.payload.delta.substring(0, 30)}..."`)
        } else {
          console.log(`[pi-runtime] >> emit ${re.type}`)
        }
        eventBus.emit(re)
      }
    } catch {
      // Ignore JSON parse errors on unrecognized output
    }
  }

  private attachProcessListeners(context: PiSessionContext): void {
    // stdout — JSONL reader
    this.attachJsonlReader(context.child.stdout!, (line) => {
      this.handlePiOutput(context, line)
    })

    // stderr — raw log
    context.child.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[pi stderr] ${chunk.toString()}`)
    })

    // Error
    context.child.on('error', (error) => {
      eventBus.emit({
        type: 'runtime.error',
        eventId: makeEventId(),
        threadId: context.threadId,
        payload: { message: error.message, class: 'transport_error' },
      })
    })

    // Exit
    context.child.on('exit', (code, signal) => {
      if (context.stopping) return

      console.log(
        `[pi-runtime] exit code=${code} signal=${signal} threadId=${context.threadId}`
      )

      const turnId = context.activeTurnId
      context.activeTurnId = undefined
      context.activeAssistantItemId = undefined
      this.sessions.delete(context.threadId)

      if (turnId) {
        eventBus.emit({
          type: 'turn.completed',
          eventId: makeEventId(),
          threadId: context.threadId,
          turnId,
          payload: {
            state: 'failed',
            errorMessage: `pi exited (code=${code}, signal=${signal})`,
          },
        })
      }

      eventBus.emit({
        type: 'session.exited',
        eventId: makeEventId(),
        threadId: context.threadId,
        payload: {
          reason: `pi exited (code=${code}, signal=${signal})`,
          recoverable: false,
        },
      })
    })
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start a new pi session (spawns child process in RPC mode).
   */
  async startSession(options: StartSessionOptions): Promise<SessionInfo> {
    const { threadId, cwd, provider, model } = options
    const now = new Date().toISOString()
    const resolvedCwd = cwd || process.cwd()

    // Build args
    const args = ['--mode', 'rpc']
    if (model) {
      if (model.indexOf('/') >= 0) {
        const slashIndex = model.indexOf('/')
        args.push('--provider', model.substring(0, slashIndex), '--model', model.substring(slashIndex + 1))
      } else {
        args.push('--model', model)
      }
    }
    if (provider) {
      // Only add if not already specified via model
      if (!model || model.indexOf('/') < 0) {
        args.push('--provider', provider)
      }
    }

    // Merge environment
    const env = { ...process.env }

    const child = spawn(this.binaryPath, args, {
      cwd: resolvedCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    const context: PiSessionContext = {
      threadId,
      child,
      pending: new Map(),
      pendingUIRequests: new Map(),
      nextRequestId: 1,
      stopping: false,
      activeTurnId: undefined,
      activeAssistantItemId: undefined,
      accumulatedAssistantText: '',
      hasEmittedDeltas: false,
      cwd: resolvedCwd,
      model,
      provider,
    }

    this.sessions.set(threadId, context)
    this.attachProcessListeners(context)

    // Wait for pi to initialize
    await new Promise((resolve) => setTimeout(resolve, SESSION_INIT_DELAY_MS))

    // Emit session lifecycle events
    eventBus.emit({
      type: 'session.started',
      eventId: makeEventId(),
      threadId,
      payload: { message: 'Connected to pi agent' },
    })

    eventBus.emit({
      type: 'session.state.changed',
      eventId: makeEventId(),
      threadId,
      payload: { state: 'ready', reason: 'Connected to pi agent' },
    })

    return { threadId, status: 'ready' }
  }

  /**
   * Send a user turn (prompt) to the pi session.
   */
  async sendTurn(threadId: string, input: string): Promise<void> {
    const context = this.sessions.get(threadId)
    if (!context) {
      throw new Error(`No session for threadId=${threadId}`)
    }

    console.log(
      `[pi-runtime] sendTurn threadId=${threadId} pid=${context.child.pid} alive=${!context.child.killed}`
    )

    const turnId = randomUUID()
    context.activeTurnId = turnId
    context.activeAssistantItemId = undefined
    context.accumulatedAssistantText = ''
    context.hasEmittedDeltas = false

    // Emit turn.started before sending
    eventBus.emit({
      type: 'turn.started',
      eventId: makeEventId(),
      threadId,
      turnId,
      payload: { model: context.model },
    })

    eventBus.emit({
      type: 'session.state.changed',
      eventId: makeEventId(),
      threadId,
      payload: { state: 'running' },
    })

    // Send the prompt command
    await this.sendRequest(context, {
      type: 'prompt',
      message: input,
    })
  }

  /**
   * Interrupt the current turn.
   */
  async interruptTurn(threadId: string): Promise<void> {
    const context = this.sessions.get(threadId)
    if (!context) {
      throw new Error(`No session for threadId=${threadId}`)
    }

    await this.sendRequest(context, { type: 'abort' })
  }

  /**
   * Respond to an extension UI request (approval or user input).
   */
  async respondToRequest(
    threadId: string,
    requestId: string,
    decision: 'allow' | 'decline' | 'cancel',
    value?: string
  ): Promise<void> {
    const context = this.sessions.get(threadId)
    if (!context) {
      throw new Error(`No session for threadId=${threadId}`)
    }

    const pendingRequest = context.pendingUIRequests.get(requestId)
    if (!pendingRequest) {
      return
    }

    context.pendingUIRequests.delete(requestId)

    const response =
      decision === 'decline' || decision === 'cancel'
        ? { type: 'extension_ui_response', id: pendingRequest.jsonRpcId, cancelled: true }
        : {
            type: 'extension_ui_response',
            id: pendingRequest.jsonRpcId,
            value: value ?? 'allow',
          }

    await this.sendRequest(context, response)

    eventBus.emit({
      type: 'request.resolved',
      eventId: makeEventId(),
      threadId,
      requestId,
      payload: { requestType: 'command_execution_approval', decision },
    })
  }

  /**
   * Stop a session (kill the child process).
   */
  async stopSession(threadId: string): Promise<void> {
    const context = this.sessions.get(threadId)
    if (!context) return

    context.stopping = true
    context.pending.clear()
    context.pendingUIRequests.clear()

    if (!context.child.killed) {
      try {
        context.child.kill('SIGTERM')
        // Force kill after 2 seconds
        setTimeout(() => {
          if (!context.child.killed) {
            context.child.kill('SIGKILL')
          }
        }, 2000)
      } catch {
        // Ignore
      }
    }

    this.sessions.delete(threadId)
  }

  /**
   * Check if a session is alive.
   */
  isSessionAlive(threadId: string): boolean {
    const context = this.sessions.get(threadId)
    if (!context) return false
    const alive = !context.child.killed && context.child.exitCode === null
    if (!alive) {
      this.sessions.delete(threadId)
    }
    return alive
  }

  /**
   * Stop all sessions.
   */
  async stopAll(): Promise<void> {
    for (const context of this.sessions.values()) {
      context.stopping = true
      context.pending.clear()
      context.pendingUIRequests.clear()
      if (!context.child.killed) {
        try {
          context.child.kill('SIGTERM')
        } catch {
          // Ignore
        }
      }
    }
    this.sessions.clear()
  }

  /**
   * Get the number of active sessions.
   */
  getSessionCount(): number {
    return this.sessions.size
  }
}

// Singleton
export const piRuntime = new PiRuntime()

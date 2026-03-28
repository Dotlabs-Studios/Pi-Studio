/**
 * Shared types for Pi Studio.
 * These types are used by both main process and renderer.
 */

// ============================================================================
// Pi Event Types
// ============================================================================

export type PiEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages?: unknown[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message?: unknown }
  | { type: 'message_start'; message?: unknown }
  | {
      type: 'message_update'
      assistantMessageEvent?: { type?: string; delta?: string }
    }
  | { type: 'message_end' }
  | { type: 'tool_execution_start'; toolName?: string; toolCallId?: string; [key: string]: unknown }
  | { type: 'tool_execution_update'; toolName?: string; toolCallId?: string; [key: string]: unknown }
  | { type: 'tool_execution_end'; toolName?: string; toolCallId?: string; [key: string]: unknown }
  | {
      type: 'extension_ui_request'
      id: string
      method: string
      title?: string
      message?: string
      options?: string[]
    }
  | { type: 'extension_error'; error?: string }
  | { type: 'auto_retry_start'; attempt?: number; maxAttempts?: number }
  | { type: 'auto_retry_end' }
  | { type: 'auto_compaction_start' }
  | { type: 'auto_compaction_end' }
  | { type: 'response'; id?: string; success?: boolean; data?: unknown; error?: string }

// Canonical runtime events (mapped from Pi native events)
export type RuntimeEvent =
  | { type: 'session.started'; eventId: string; threadId: string; payload: { message: string } }
  | { type: 'session.state.changed'; eventId: string; threadId: string; payload: { state: string; reason?: string } }
  | { type: 'session.exited'; eventId: string; threadId: string; payload: { reason: string; recoverable: boolean } }
  | { type: 'turn.started'; eventId: string; threadId: string; turnId: string; payload: { model?: string } }
  | { type: 'turn.completed'; eventId: string; threadId: string; turnId: string; payload: { state: string; errorMessage?: string } }
  | {
      type: 'content.delta'
      eventId: string
      threadId: string
      turnId?: string
      itemId: string
      payload: { streamKind: string; delta: string }
    }
  | {
      type: 'item.started'
      eventId: string
      threadId: string
      turnId?: string
      itemId?: string
      payload: { itemType: string; status: string; title: string; detail?: string; data?: unknown }
    }
  | {
      type: 'item.updated'
      eventId: string
      threadId: string
      turnId?: string
      itemId?: string
      payload: { itemType: string; title?: string; data?: unknown }
    }
  | {
      type: 'item.completed'
      eventId: string
      threadId: string
      turnId?: string
      itemId?: string
      payload: { itemType: string; status: string; title?: string; detail?: string; data?: unknown }
    }
  | {
      type: 'request.opened'
      eventId: string
      threadId: string
      requestId: string
      payload: { requestType: string; detail: string; args: unknown }
    }
  | {
      type: 'request.resolved'
      eventId: string
      threadId: string
      requestId: string
      payload: { requestType: string; decision: string }
    }
  | {
      type: 'runtime.error'
      eventId: string
      threadId: string
      turnId?: string
      payload: { message: string; class: string; detail?: unknown }
    }
  | {
      type: 'runtime.warning'
      eventId: string
      threadId: string
      payload: { message: string; detail?: unknown }
    }
  | {
      type: 'turn.usage'
      eventId: string
      threadId: string
      turnId?: string
      payload: {
        inputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheWriteTokens: number
        totalTokens: number
        cost: number
      }
    }

// ============================================================================
// Session Types
// ============================================================================

export interface Conversation {
  id: string
  label: string
  entries: SessionEntry[]
}

export interface SessionEntry {
  id: string
  parentId: string | null
  role: 'user' | 'assistant' | 'tool_result' | 'system'
  content: string
  timestamp: number
  conversationId: string
  label?: string
  metadata?: Record<string, unknown>
  children?: string[]
}

export interface Session {
  id: string
  filePath: string
  cwd: string
  provider: string
  model: string
  createdAt: string
  updatedAt: string
  entries: SessionEntry[]
  currentBranch: string[]
}

export interface SessionSummary {
  id: string
  filePath: string
  cwd: string
  title: string
  provider: string
  model: string
  createdAt: string
  updatedAt: string
  entryCount: number
}

// ============================================================================
// Provider Types
// ============================================================================

export interface Model {
  id: string
  name: string
  provider: string
  maxTokens?: number
  supportsThinking?: boolean
}

export interface Provider {
  name: string
  displayName: string
  authType: 'api-key' | 'oauth' | 'subscription'
  models: Model[]
  requiresAuth: boolean
  setupDocs?: string
  /** True if this is a user-defined provider (persisted in settings). */
  isCustom?: boolean
  /** For custom providers: base URL for the API endpoint. */
  baseUrl?: string
  /** For custom providers: environment variable name for the API key. */
  envVar?: string
}

// ============================================================================
// Skill Types
// ============================================================================

export interface Skill {
  name: string
  path: string
  description?: string
  source: 'local' | 'npm' | 'git'
  enabled: boolean
  content: string
}

// ============================================================================
// Config Types
// ============================================================================

export interface PiSettings {
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: 'low' | 'medium' | 'high'
  compaction?: {
    enabled: boolean
    reserveTokens: number
    keepRecentTokens: number
  }
  retry?: {
    enabled: boolean
    maxRetries: number
    baseDelayMs: number
  }
  packages?: string[]
  extensions?: string[]
  skills?: string[]
  prompts?: string[]
  themes?: string[]
  /** User-defined custom providers (persisted). */
  customProviders?: any[]
  /** Custom models per provider: { "provider-name": Model[] }. */
  customModels?: Record<string, any[]>
}

export interface ProjectConfig {
  cwd: string
  settings?: PiSettings
  systemPrompt?: string
  agentsMd?: string
  appendSystemPrompt?: string
  skills: Skill[]
}

export interface UserConfig {
  homeDir: string
  settings: PiSettings
  systemPrompt?: string
  agentsMd?: string
  skills: Skill[]
}

export interface ResolvedConfig {
  project: ProjectConfig | null
  user: UserConfig
  settings: PiSettings
}

// ============================================================================
// Package Types
// ============================================================================

export type PackageSource =
  | { type: 'npm'; name: string; version?: string }
  | { type: 'git'; url: string; ref?: string }
  | { type: 'local'; path: string }

export interface PiPackage {
  name: string
  version?: string
  source: PackageSource
  path: string
  resources: {
    extensions?: string[]
    skills?: string[]
    prompts?: string[]
    themes?: string[]
  }
  enabled: boolean
}

// ============================================================================
// IPC Channel Types
// ============================================================================

export interface IPCChannels {
  // Project
  'project:open': () => Promise<string | null>
  'project:select': (cwd: string) => Promise<void>
  'project:recent': () => Promise<string[]>
  'project:create': (path: string) => Promise<string>

  // Pi Runtime
  'pi:start-session': (options: StartSessionOptions) => Promise<SessionInfo>
  'pi:stop-session': (threadId: string) => Promise<void>
  'pi:send-turn': (threadId: string, input: string) => Promise<void>
  'pi:interrupt': (threadId: string) => Promise<void>
  'pi:respond-request': (threadId: string, requestId: string, decision: string, value?: string) => Promise<void>
  'pi:is-session-alive': (threadId: string) => Promise<boolean>

  // Config
  'config:scan': (cwd: string) => Promise<ResolvedConfig>
  'config:get-settings': () => Promise<PiSettings>
  'config:save-settings': (settings: PiSettings) => Promise<void>

  // Provider
  'provider:list': () => Promise<Provider[]>
  'provider:get-api-key': (provider: string) => Promise<string | null>
  'provider:set-api-key': (provider: string, key: string) => Promise<void>
  'provider:remove-api-key': (provider: string) => Promise<void>

  // Skill
  'skill:list': () => Promise<Skill[]>
  'skill:toggle': (name: string, enabled: boolean) => Promise<void>
  'skill:install': (source: PackageSource) => Promise<Skill>

  // Session
  'session:list': () => Promise<SessionSummary[]>
  'session:load': (path: string) => Promise<Session | null>
  'session:delete': (path: string) => Promise<void>

  // Pi binary
  'pi:check-installed': () => Promise<boolean>
  'pi:get-version': () => Promise<string | null>

  // Events (main -> renderer)
  'runtime:event': (event: RuntimeEvent) => void
  'config:changed': (config: ResolvedConfig) => void
}

export interface StartSessionOptions {
  threadId: string
  cwd: string
  provider?: string
  model?: string
}

export interface SessionInfo {
  threadId: string
  status: 'connecting' | 'ready' | 'running'
}

// ============================================================================
// Chat UI Types
// ============================================================================

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinking?: string
  timestamp: number
  isStreaming?: boolean
  toolCalls?: ToolCallInfo[]
  status?: 'pending' | 'inProgress' | 'completed' | 'error'
  errorMessage?: string
}

export interface ToolCallInfo {
  id: string
  name: string
  args?: unknown
  status: 'inProgress' | 'completed' | 'error'
  result?: unknown
  error?: string
}

// ============================================================================
// Approval Request
// ============================================================================

export interface ApprovalRequest {
  id: string
  threadId: string
  turnId?: string
  title: string
  message?: string
  options?: string[]
  method: string
  args?: unknown
}

// ============================================================================
// App State Types
// ============================================================================

export interface AppState {
  currentProject: string | null
  sessionStatus: 'idle' | 'connecting' | 'ready' | 'running'
  sidebarTab: 'sessions' | 'skills' | 'config' | 'files'
  sidebarOpen: boolean
}

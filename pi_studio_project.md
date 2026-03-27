# Pi Studio - Project Plan

> Documento di progetto per un'applicazione desktop dedicata a pi coding agent.

## Overview

**Pi Studio** è un'applicazione desktop per la gestione completa di pi coding agent. Offre un'interfaccia grafica per sessioni, skill management, configuration management e provider management.

**Stack tecnologico:**
- **UI**: Tauri (Rust) + Vanilla TypeScript
- **Backend**: Node.js embedded o Rust nativo
- **Communication**: Pi RPC mode (JSONL over stdio)

---

## Architettura Generale

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Pi Studio                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                          UI Layer (TypeScript)                         │ │
│  │                                                                          │ │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │ │
│  │   │  Session     │  │   Skill      │  │   Config     │                │ │
│  │   │  Manager     │  │   Manager    │  │   Manager    │                │ │
│  │   └──────────────┘  └──────────────┘  └──────────────┘                │ │
│  │                                                                          │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │   │                      Chat / Terminal View                      │   │ │
│  │   └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                        │
│                                      ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                      Core Layer (TypeScript)                           │ │
│  │                                                                          │ │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │ │
│  │   │   Pi         │  │   Config     │  │   Skill      │                │ │
│  │   │   Runtime    │  │   Scanner    │  │   Indexer    │                │ │
│  │   └──────────────┘  └──────────────┘  └──────────────┘                │ │
│  │                                                                          │ │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │ │
│  │   │   Provider   │  │   Package    │  │   Event      │                │ │
│  │   │   Manager    │  │   Manager    │  │   Bus        │                │ │
│  │   └──────────────┘  └──────────────┘  └──────────────┘                │ │
│  │                                                                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                        │
│  ┌──────────────────────────────────┼─────────────────────────────────────┐ │
│  │              Platform Layer      │                                     │ │
│  │                                  ▼                                     │ │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │ │
│  │   │   Tauri      │  │   File       │  │   Process    │                │ │
│  │   │   Commands   │  │   System     │  │   Manager    │                │ │
│  │   └──────────────┘  └──────────────┘  └──────────────┘                │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                        │
│                                      ▼                                        │
│                         ┌──────────────────────┐                            │
│                         │   pi CLI (RPC mode)  │                            │
│                         │   Child Process      │                            │
│                         └──────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File di Riferimento da T3 Code

### Pi Adapter (CORE - Obbligatorio)

| File | Uso | Cosa Copiare |
|------|-----|--------------|
| `apps/server/src/provider/Layers/PiAdapter.ts` | Runtime Pi + event mapping | **TUTTO** - È il riferimento principale |

**Elementi chiave da estrarre:**
- JSONL reader (split on `\n` only, non usare readline)
- Process spawn/management
- Event mapping (`mapPiNativeToRuntime`)
- RPC protocol handling
- Request/response queue

### Contracts / Types

| File | Uso | Cosa Copiare |
|------|-----|--------------|
| `packages/contracts/src/providerRuntime.ts` | Provider event types | Tipi eventi (adattati) |
| `packages/contracts/src/model.ts` | Model types | `PiThinkingLevel`, `PiModelOptions` |
| `packages/contracts/src/settings.ts` | Settings schema | Struttura settings (non Effect) |

### Provider Models UI

| File | Uso | Cosa Copiare |
|------|-----|--------------|
| `apps/web/src/providerModels.ts` | Model selection logic | Logica selezione modelli |
| `apps/web/src/modelSelection.ts` | Provider state | Stato provider selector |

### WebSocket Transport (Opzionale)

| File | Uso | Cosa Copiare |
|------|-----|--------------|
| `apps/web/src/wsTransport.ts` | WebSocket client | Se vuoi architecture server分离 |
| `apps/server/src/wsServer.ts` | WebSocket server | Se vuoi server mode |

### Settings Management

| File | Uso | Cosa Copiare |
|------|-----|--------------|
| `apps/server/src/serverSettings.ts` | Settings persistence | Logica salvataggio settings |

---

## Componenti Principali

### 1. Pi Runtime (`src/core/pi-runtime.ts`)

**Responsabilità:** Gestione del processo figlio pi CLI

```typescript
interface PiRuntime {
  // Lifecycle
  startSession(options: SessionOptions): Promise<Session>;
  stopSession(threadId: string): Promise<void>;
  
  // Communication
  sendTurn(threadId: string, input: string): Promise<void>;
  interruptTurn(threadId: string): Promise<void>;
  
  // UI Interaction
  respondToRequest(threadId: string, requestId: string, decision: Decision): Promise<void>;
  
  // Events
  onEvent(handler: (event: PiEvent) => void): void;
}
```

**Riferimento:** `PiAdapter.ts` - sezioni:
- `startSession()`
- `sendTurn()`
- `mapPiNativeToRuntime()`
- `attachJsonlReader()`
- `sendRequest()` con timeout

**Event Types da mappare:**
```typescript
type PiEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: unknown[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: unknown }
  | { type: 'message_start'; message: unknown }
  | { type: 'message_update'; assistantMessageEvent: { type: 'text_delta'; delta: string } }
  | { type: 'message_end' }
  | { type: 'tool_execution_start'; toolName: string; toolCallId: string }
  | { type: 'tool_execution_update'; toolName: string; toolCallId: string }
  | { type: 'tool_execution_end'; toolName: string; toolCallId: string }
  | { type: 'extension_ui_request'; id: string; method: string; title?: string; message?: string; options?: string[] }
  | { type: 'extension_error'; error: string }
  | { type: 'auto_retry_start'; attempt: number; maxAttempts: number }
  | { type: 'auto_retry_end' }
  | { type: 'auto_compaction_start' }
  | { type: 'auto_compaction_end' }
  | { type: 'response'; id: string; success: boolean; data?: unknown; error?: string };
```

---

### 2. Config Scanner (`src/core/config-scanner.ts`)

**Responsabilità:** Scansiona e monitora le cartelle `.pi` nel filesystem

**Cartelle da cercare (in ordine di priorità):**

```typescript
const CONFIG_LOCATIONS = [
  // Project level (walking up from cwd)
  '.pi/settings.json',
  '.pi/SYSTEM.md',
  '.pi/APPEND_SYSTEM.md',
  '.pi/AGENTS.md',
  '.pi/skills/',
  '.pi/prompts/',
  '.pi/extensions/',
  '.pi/themes/',
  
  // User global level
  '~/.pi/agent/settings.json',
  '~/.pi/agent/SYSTEM.md',
  '~/.pi/agent/AGENTS.md',
  '~/.pi/agent/skills/',
  '~/.pi/agent/prompts/',
  '~/.pi/agent/extensions/',
  '~/.pi/agent/themes/',
];

// Also scan parent directories from cwd
// And .agents/ directories
```

**Interfaccia:**

```typescript
interface ConfigScanner {
  // Scan current working directory and parents
  scanProject(cwd: string): Promise<ProjectConfig>;
  
  // Scan user home directory
  scanUserConfig(): Promise<UserConfig>;
  
  // Watch for changes
  watch(cwd: string, callback: (change: ConfigChange) => void): Watcher;
  
  // Merge configs (project overrides user)
  mergeConfigs(project: ProjectConfig, user: UserConfig): ResolvedConfig;
}

interface ProjectConfig {
  cwd: string;
  settings?: PiSettings;
  systemPrompt?: string;
  agentsMd?: string;
  skills: Skill[];
  prompts: Prompt[];
}

interface UserConfig {
  homeDir: string;
  settings: PiSettings;
  systemPrompt?: string;
  skills: Skill[];
  packages: PiPackage[];
}
```

**File di riferimento per logica:**
- `apps/server/src/workspaceEntries.ts` - logica walking directory tree
- `apps/server/src/serverSettings.ts` - settings parsing

---

### 3. Provider Manager (`src/core/provider-manager.ts`)

**Responsabilità:** Gestione provider e API keys

**Provider supportati (da pi docs):**

```typescript
interface Provider {
  name: string;
  displayName: string;
  authType: 'api-key' | 'oauth' | 'subscription';
  models: Model[];
  requiresAuth: boolean;
}

const BUILT_IN_PROVIDERS: Provider[] = [
  // Anthropic
  { name: 'anthropic', displayName: 'Anthropic', authType: 'api-key', models: [...] },
  
  // OpenAI
  { name: 'openai', displayName: 'OpenAI', authType: 'api-key', models: [...] },
  
  // Google
  { name: 'google', displayName: 'Google', authType: 'api-key', models: [...] },
  
  // Azure
  { name: 'azure', displayName: 'Azure OpenAI', authType: 'api-key', models: [...] },
  
  // And more... (Groq, Cerebras, xAI, etc.)
];

interface ProviderManager {
  listProviders(): Provider[];
  getProvider(name: string): Provider | undefined;
  
  // Auth
  setApiKey(provider: string, key: string): Promise<void>;
  getApiKey(provider: string): string | undefined;
  removeApiKey(provider: string): void;
  
  // OAuth flow
  initiateOAuth(provider: string): Promise<OAuthFlow>;
  completeOAuth(flow: OAuthFlow, callback: string): Promise<void>;
  
  // Models
  listModels(provider: string): Model[];
  addCustomModel(provider: string, model: Model): void;
  removeCustomModel(provider: string, modelId: string): void;
  
  // Environment
  exportEnvForProcess(): Record<string, string>;
}
```

**File di riferimento:**
- `packages/contracts/src/model.ts` - `MODEL_SLUG_ALIASES_BY_PROVIDER`
- `apps/web/src/providerModels.ts` - UI logic per provider selection
- `C:\Users\AcidJ\AppData\Roaming\npm\node_modules\@mariozechner\pi-coding-agent\docs\providers.md` - Provider docs

---

### 4. Skill Manager (`src/core/skill-manager.ts`)

**Responsabilità:** Indexing, installation e management delle skills

**Skill Locations (da pi docs):**

```typescript
const SKILL_LOCATIONS = [
  '~/.pi/agent/skills/',
  '~/.agents/skills/',
  '.pi/skills/',
  '.agents/skills/',  // from cwd up through parent directories
  // Also from pi packages
];
```

**Interfaccia:**

```typescript
interface Skill {
  name: string;
  path: string;
  description?: string;
  source: 'local' | 'npm' | 'git';
  enabled: boolean;
  content: string;  // SKILL.md content
}

interface SkillManager {
  // Indexing
  indexSkills(cwd: string): Promise<Skill[]>;
  refreshIndex(): Promise<void>;
  
  // Search
  searchSkills(query: string): Skill[];
  getSkill(name: string): Skill | undefined;
  
  // Installation
  installFromNpm(packageName: string): Promise<Skill>;
  installFromGit(url: string): Promise<Skill>;
  installFromLocal(path: string): Promise<Skill>;
  
  // Management
  enableSkill(name: string): void;
  disableSkill(name: string): void;
  deleteSkill(name: string): Promise<void>;
  
  // Execution context
  getActiveSkills(): Skill[];
  getSkillsForPrompt(): string[];  // Returns skill contents for system prompt
}
```

**SKILL.md format (da documentare):**

```markdown
# Skill Name

Use this skill when the user asks about X.

## Steps
1. Do this
2. Then that
```

**File di riferimento:**
- `C:\Users\AcidJ\AppData\Roaming\npm\node_modules\@mariozechner\pi-coding-agent\docs\skills.md` - Skills documentation

---

### 5. Package Manager (`src/core/package-manager.ts`)

**Responsabilità:** Installazione e gestione di pi packages (extensions, skills, prompts, themes)

**Sources supportati:**

```typescript
type PackageSource = 
  | { type: 'npm'; name: string; version?: string }
  | { type: 'git'; url: string; ref?: string }
  | { type: 'local'; path: string };

interface PiPackage {
  name: string;
  version?: string;
  source: PackageSource;
  path: string;
  resources: {
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    themes?: string[];
  };
  enabled: boolean;
}

interface PackageManager {
  // Discovery
  listInstalledPackages(): PiPackage[];
  getPackage(name: string): PiPackage | undefined;
  
  // Installation
  install(source: PackageSource): Promise<PiPackage>;
  update(name?: string): Promise<void>;  // Update all or specific
  uninstall(name: string): Promise<void>;
  
  // Management
  enablePackage(name: string): void;
  disablePackage(name: string): void;
  
  // Config
  syncWithPiConfig(): Promise<void>;  // Read pi's own package config
}
```

**File di riferimento:**
- `C:\Users\AcidJ\AppData\Roaming\npm\node_modules\@mariozechner\pi-coding-agent\docs\packages.md` - Packages documentation
- `C:\Users\AcidJ\AppData\Roaming\npm\node_modules\@mariozechner\pi-coding-agent\docs\extensions.md` - Extensions documentation

---

### 6. Session Manager (`src/core/session-manager.ts`)

**Responsabilità:** Gestione sessioni con struttura ad albero (branching)

**Formato sessione (JSONL con tree structure):**

```typescript
interface Session {
  id: string;
  filePath: string;
  cwd: string;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  entries: SessionEntry[];
  currentBranch: string[];  // Array of entry IDs
}

interface SessionEntry {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'tool_result' | 'system' | 'custom';
  content: unknown;  // Message content, tool results, etc.
  timestamp: number;
  label?: string;  // Bookmark labels
  metadata?: Record<string, unknown>;
}
```

**Interfaccia:**

```typescript
interface SessionManager {
  // Session lifecycle
  createSession(cwd: string, options?: SessionOptions): Promise<Session>;
  loadSession(path: string): Promise<Session>;
  saveSession(session: Session): Promise<void>;
  deleteSession(path: string): Promise<void>;
  
  // History
  listSessions(cwd?: string): Promise<SessionSummary[]>;
  searchSessions(query: string): Promise<Session[]>;
  
  // Branching
  getCurrentBranch(session: Session): SessionEntry[];
  fork(session: Session, fromEntryId: string): Promise<Session>;
  navigateTo(session: Session, entryId: string): void;
  
  // Tree navigation
  getTree(session: Session): SessionTree;
  labelEntry(session: Session, entryId: string, label: string): void;
}
```

**File di riferimento:**
- `C:\Users\AcidJ\AppData\Roaming\npm\node_modules\@mariozechner\pi-coding-agent\docs\session.md` - Session internals

---

### 7. Settings Store (`src/core/settings-store.ts`)

**Responsabilità:** Persistenza e sync delle settings

**Settings locations:**

```typescript
interface Settings {
  // Global (all projects)
  global: {
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinkingLevel?: PiThinkingLevel;
    theme?: string;
    enabledModels?: string[];
    compaction?: {
      enabled: boolean;
      reserveTokens: number;
      keepRecentTokens: number;
    };
    retry?: {
      enabled: boolean;
      maxRetries: number;
      baseDelayMs: number;
    };
    packages?: string[];
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    themes?: string[];
  };
  
  // Project (overrides global)
  project: {
    // Same structure as global
  };
  
  // API Keys (separate for security)
  apiKeys: {
    [provider: string]: string;  // encrypted
  };
}
```

**File di riferimento:**
- `packages/contracts/src/settings.ts` - Schema definitions
- `apps/server/src/serverSettings.ts` - Persistence logic

---

### 8. Pi Installer (`src/core/pi-installer.ts`)

**Responsabilità:** Installazione e update di pi CLI

**Interfaccia:**

```typescript
interface PiInstaller {
  // Version info
  getInstalledVersion(): Promise<string | undefined>;
  getLatestVersion(): Promise<string>;
  checkForUpdates(): Promise<UpdateInfo | null>;
  
  // Installation
  install(): Promise<void>;
  update(): Promise<void>;
  
  // Binary management
  getBinaryPath(): string;
  setBinaryPath(path: string): void;
  
  // Status
  isInstalled(): Promise<boolean>;
  validateInstallation(): Promise<boolean>;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  downloadSize?: number;
}
```

---

## UI Components

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Header: Project selector | Provider | Model | Settings          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐   │
│  │              │  │                                              │   │
│  │  Sidebar    │  │              Main Content                     │   │
│  │              │  │                                              │   │
│  │  - Sessions │  │  ┌──────────────────────────────────────────┐ │   │
│  │  - Skills   │  │  │                                          │ │   │
│  │  - Config   │  │  │         Chat / Terminal View             │ │   │
│  │  - Files    │  │  │                                          │ │   │
│  │              │  │  └──────────────────────────────────────────┘ │   │
│  │              │  │                                              │   │
│  │              │  │  ┌──────────────────────────────────────────┐ │   │
│  │              │  │  │ Composer (input)                        │ │   │
│  │              │  │  └──────────────────────────────────────────┘ │   │
│  └──────────────┘  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  Footer: Tokens | Cost | Context usage | Version                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component List

| Component | Description |
|-----------|-------------|
| `Header` | Provider/model selector, settings button |
| `Sidebar` | Collapsible panel with tabs (sessions, skills, config, files) |
| `SessionList` | List of sessions with search and filters |
| `SkillPanel` | Skill browser, installer, enable/disable |
| `ConfigPanel` | .pi folder editor, settings editor |
| `FileTree` | Project file browser |
| `ChatView` | Message display with diffs, tool calls, etc. |
| `Composer` | Input area with @ mentions, multi-line, images |
| `Terminal` | Integrated terminal (optional, via PTY) |
| `ProviderManager` | API key input, OAuth flows |
| `ExtensionDialog` | Dialogs for extension UI requests |
| `SettingsModal` | Full settings editor |

---

## Event Bus Architecture

```typescript
// Central event bus for loose coupling
type AppEvent =
  | { type: 'session:started'; session: Session }
  | { type: 'session:ended'; sessionId: string }
  | { type: 'turn:started'; turnId: string }
  | { type: 'turn:ended'; turnId: string }
  | { type: 'message:received'; message: Message }
  | { type: 'tool:call'; toolName: string; args: unknown }
  | { type: 'tool:result'; toolName: string; result: unknown }
  | { type: 'request:approval'; request: ApprovalRequest }
  | { type: 'config:changed'; config: ResolvedConfig }
  | { type: 'provider:auth_changed'; provider: string }
  | { type: 'skill:installed'; skill: Skill };

class EventBus {
  emit<T extends AppEvent>(event: T): void;
  on<T extends AppEvent['type']>(
    type: T,
    handler: (event: Extract<AppEvent, { type: T }>) => void
  ): () => void;
}
```

---

## Piano di Sviluppo

### Fase 1: Core Foundation (Week 1-2)

**Obiettivo:** Avere Pi Runtime funzionante con chat base

```
Day 1-2: Project Setup
├── Tauri project initialization
├── Basic HTML/CSS structure
├── TypeScript configuration
└── Logging setup

Day 3-5: Pi Runtime Core
├── Copy/adapt PiAdapter.ts → pi-runtime.ts
├── JSONL reader implementation
├── Process spawn/management
├── Basic event handling
└── Test with manual commands

Day 6-7: Basic UI
├── Chat view component
├── Composer component
├── Message rendering
└── Connect to Pi Runtime
```

**Deliverable:** App che può avviare pi e ricevere streaming messages

### Fase 2: Session Management (Week 3)

**Obiettivo:** Sessioni persistenti con branching

```
Day 1-2: Session Storage
├── JSONL file format
├── Session CRUD operations
├── Session list UI
└── Session switcher

Day 3-4: Tree Navigation
├── Branch structure
├── Fork functionality
├── Navigate to entry
└── Label/bookmark system

Day 5: Compaction
├── Auto-compaction detection
├── Manual /compact
└── History preservation
```

**Deliverable:** Sessioni complete come in pi CLI

### Fase 3: Config Scanner (Week 4)

**Obiettivo:** Leggere e monitorare cartelle .pi

```
Day 1-2: File Scanning
├── Walk directory tree
├── Parse settings.json
├── Read SYSTEM.md, AGENTS.md
└── Merge configs

Day 3-4: Config UI
├── Config editor panel
├── Project selector
├── Config sync indicator
└── File watcher

Day 5: Integration
├── Pass config to Pi Runtime
├── Reload on changes
└── Environment variables
```

**Deliverable:** Config viewer/editor integrato

### Fase 4: Skill Manager (Week 5)

**Obiettivo:** Skill browser e installer

```
Day 1-2: Skill Indexing
├── Scan skill directories
├── Parse SKILL.md
├── Build skill registry
└── Search functionality

Day 3-4: Skill UI
├── Skill list panel
├── Enable/disable toggle
├── Skill details view
└── Skill content preview

Day 5: Installation
├── Install from npm
├── Install from git
├── Package detection
└── Update mechanism
```

**Deliverable:** Skill management UI completa

### Fase 5: Provider Manager (Week 6)

**Obiettivo:** Gestione API keys e provider

```
Day 1-2: Provider Core
├── Provider definitions
├── API key storage (secure)
├── Environment export
└── Model registry

Day 3-4: Auth UI
├── API key input form
├── Provider selector
├── OAuth flow (if needed)
└── Connection test

Day 5: Integration
├── Provider selection in header
├── Model picker
└── Settings sync
```

**Deliverable:** Provider management completo

### Fase 6: Polish & Distro (Week 7)

**Obiettivo:** Production-ready

```
Day 1-2: UI Polish
├── Theme system
├── Keyboard shortcuts
├── Notifications
└── Error handling

Day 3-4: System Integration
├── System tray
├── Global shortcuts
├── File associations
└── Auto-start option

Day 5: Distribution
├── Windows build
├── macOS build
├── Linux build
└── Release process
```

---

## Dipendenze Esterne

### Runtime Dependencies

```json
{
  "dependencies": {
    // None - vanilla TypeScript
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@tauri-apps/api": "^2.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

### Per Build (Rust/Tauri)

```toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
notify = "6"  # File watching
keyring = "3"  # Secure storage for API keys
```

---

## Security Considerations

### API Key Storage

```typescript
// Use OS keychain
// Never store in plain text
// Encrypt with user password (optional)

async function storeApiKey(provider: string, key: string): Promise<void> {
  // Tauri command to store in keychain
  await invoke('store_secure', { service: provider, key });
}

async function getApiKey(provider: string): Promise<string | null> {
  return await invoke('get_secure', { service: provider });
}
```

### Extension Security

```typescript
// Warn user about extension permissions
// Extensions have full system access
// Show extension source before install
```

---

## Milestones

| Milestone | Description | Target |
|-----------|-------------|--------|
| M1 | Basic Pi Runtime + Chat | Week 2 |
| M2 | Session Management | Week 3 |
| M3 | Config Scanner | Week 4 |
| M4 | Skill Manager | Week 5 |
| M5 | Provider Manager | Week 6 |
| M6 | First Release | Week 7 |

---

## Riferimenti Esterni

- [Pi Documentation](https://pi.dev)
- [Pi GitHub](https://github.com/badlogic/pi-mono)
- [Tauri Docs](https://v2.tauri.app/)
- [Pi Provider Docs](./docs/providers.md) (copiato da installazione)
- [Pi Extensions Docs](./docs/extensions.md)
- [Pi Skills Docs](./docs/skills.md)
- [Pi Packages Docs](./docs/packages.md)
- [Pi Session Docs](./docs/session.md)

---

## TODO

- [ ] Initialize Tauri project
- [ ] Implement Pi Runtime (da PiAdapter.ts)
- [ ] Basic Chat UI
- [ ] Session Manager
- [ ] Config Scanner
- [ ] Skill Manager
- [ ] Provider Manager
- [ ] Pi Installer
- [ ] Extension UI support
- [ ] Polish and release

---

*Document generated for Pi Studio project planning.*

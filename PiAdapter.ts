/**
 * PiAdapterLive - Live implementation for the pi provider adapter.
 *
 * Wraps pi CLI in RPC mode behind the PiAdapter service contract and
 * emits canonical `ProviderRuntimeEvent` events consumed upstream by
 * `ProviderService` / `ProviderRuntimeIngestion`.
 *
 * Uses a custom JSONL reader (split on `\n` only) because Node's `readline`
 * is NOT protocol-compliant with pi's RPC mode — it also splits on
 * U+2028 / U+2029 which are valid inside JSON strings.
 *
 * @module PiAdapterLive
 */
import { randomUUID } from "node:crypto";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import {
  ApprovalRequestId,
  EventId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  ProviderApprovalDecision,
} from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { PiAdapter, type PiAdapterShape } from "../Services/PiAdapter.ts";
import { readWindowsRegistryEnvironment } from "@t3tools/shared/shell";

const PROVIDER = "piAgent" as const;
const PI_STDIO_TIMEOUT_MS = 30_000;

interface PendingRequest {
  method: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingUIRequest {
  requestId: ApprovalRequestId;
  jsonRpcId: string;
  method: string;
}

interface PiSessionContext {
  session: ProviderSession;
  child: ChildProcessWithoutNullStreams;
  pending: Map<string, PendingRequest>;
  pendingUIRequests: Map<ApprovalRequestId, PendingUIRequest>;
  nextRequestId: number;
  stopping: boolean;
  /** Canonical turnId assigned when sendTurn is called. */
  activeTurnId: TurnId | undefined;
  /** Stable itemId for the current streaming assistant text block. */
  activeAssistantItemId: string | undefined;
  /** Full assistant text accumulated from message_update deltas (fallback). */
  accumulatedAssistantText: string;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return String(fallback);
}

/**
 * Extract assistant text content from an `AgentMessage` produced by pi.
 */
function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as Record<string, unknown>;
  if (msg.role !== "assistant") return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: unknown) => {
      if (!block || typeof block !== "object") return false;
      return (block as Record<string, unknown>).type === "text";
    })
    .map((block: unknown) => {
      const b = block as Record<string, unknown>;
      return typeof b.text === "string" ? b.text : "";
    })
    .join("");
}

export interface PiAdapterLiveOptions {
  readonly binaryPath?: string;
}

function makePiAdapter(options?: PiAdapterLiveOptions) {
  return Effect.gen(function* () {
    const binaryPath = options?.binaryPath ?? "pi";

    const sessions = new Map<ThreadId, PiSessionContext>();
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    const emitRuntimeEvent = (event: ProviderRuntimeEvent): void => {
      Effect.runFork(Queue.offer(runtimeEventQueue, event));
    };

    const mkBase = (context: PiSessionContext): Omit<ProviderRuntimeEvent, "type" | "payload"> => ({
      eventId: EventId.makeUnsafe(randomUUID()),
      provider: PROVIDER,
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    });

    const sendRequest = (
      context: PiSessionContext,
      command: unknown,
      timeoutMs = PI_STDIO_TIMEOUT_MS,
    ): Effect.Effect<unknown, Error> => {
      return Effect.tryPromise<unknown>(() => {
        const id = String(context.nextRequestId);
        context.nextRequestId += 1;

        return new Promise<unknown>((resolve, reject) => {
          const timeout = setTimeout(() => {
            context.pending.delete(id);
            console.log(`[pi-adapter] sendRequest TIMEOUT id=${id} command=${(command as Record<string, unknown>)?.type}`);
            reject(new Error(`Timed out waiting for command`));
          }, timeoutMs);

          context.pending.set(id, {
            method: "rpc",
            timeout,
            resolve,
            reject,
          });

          const fullCommand = { ...(command as Record<string, unknown>), id };
          const encoded = JSON.stringify(fullCommand);
          if (context.child.stdin.writable) {
            console.log(`[pi-adapter] sendRequest id=${id} writing to stdin: ${encoded}`);
            context.child.stdin.write(`${encoded}\n`);
          } else {
            clearTimeout(timeout);
            context.pending.delete(id);
            console.log(`[pi-adapter] sendRequest id=${id} stdin NOT writable, childKilled=${context.child.killed} exitCode=${context.child.exitCode}`);
            reject(new Error("stdin not writable"));
          }
        });
      });
    };

    // ---------------------------------------------------------------------------
    // Pi native event → canonical ProviderRuntimeEvent mapping
    // ---------------------------------------------------------------------------

    const mapPiNativeToRuntime = (
      context: PiSessionContext,
      event: { type?: string; [key: string]: unknown },
    ): ReadonlyArray<ProviderRuntimeEvent> => {
      switch (event.type) {
        // ---- Agent lifecycle --------------------------------------------------
        case "agent_start":
          return [
            {
              ...mkBase(context),
              type: "session.state.changed",
              payload: { state: "running" as const, reason: "Pi agent started" },
            },
          ];

        case "agent_end": {
          const turnId = context.activeTurnId;
          const assistantItemId = context.activeAssistantItemId;
          const fallbackText = context.accumulatedAssistantText;
          context.activeTurnId = undefined;
          context.activeAssistantItemId = undefined;
          context.accumulatedAssistantText = "";

          const events: ProviderRuntimeEvent[] = [];

          // Extract assistant text and error info from agent_end messages
          const messages = event.messages;
          let finalText = fallbackText;
          let errorMessage: string | undefined;

          if (Array.isArray(messages)) {
            for (const msg of messages) {
              const text = extractAssistantText(msg);
              if (text.length > finalText.length) {
                finalText = text;
              }
              // Detect stopReason=error on the assistant message
              const rec = msg as Record<string, unknown> | undefined;
              if (rec?.role === "assistant" && rec.stopReason === "error") {
                errorMessage =
                  typeof rec.errorMessage === "string" ? rec.errorMessage : "Provider error";
              }
            }
          }

          // If we have text but never emitted deltas, emit it now.
          if (turnId && finalText.length > 0) {
            const itemId = assistantItemId ?? randomUUID();
            events.push({
              eventId: EventId.makeUnsafe(randomUUID()),
              provider: PROVIDER,
              threadId: context.session.threadId,
              createdAt: new Date().toISOString(),
              turnId,
              itemId: RuntimeItemId.makeUnsafe(itemId),
              type: "content.delta",
              payload: { streamKind: "assistant_text" as const, delta: finalText },
            });
            events.push({
              eventId: EventId.makeUnsafe(randomUUID()),
              provider: PROVIDER,
              threadId: context.session.threadId,
              createdAt: new Date().toISOString(),
              turnId,
              itemId: RuntimeItemId.makeUnsafe(itemId),
              type: "item.completed",
              payload: {
                itemType: "assistant_message" as const,
                status: "completed" as const,
                title: "Assistant message",
                detail: finalText.length > 0 ? finalText : undefined,
              },
            });
          }

          // Emit runtime.error when the provider returned an error
          if (errorMessage) {
            events.push({
              ...mkBase(context),
              ...(turnId ? { turnId } : {}),
              type: "runtime.error",
              payload: { message: errorMessage, class: "provider_error" as const },
            });
          }

          // Turn completed — use "failed" state when there was an error
          if (turnId) {
            events.push({
              ...mkBase(context),
              turnId,
              type: "turn.completed",
              payload: {
                state: errorMessage ? ("failed" as const) : ("completed" as const),
                ...(errorMessage ? { errorMessage } : {}),
              },
            });
          }

          events.push({
            ...mkBase(context),
            type: "session.state.changed",
            payload: { state: "ready" as const, reason: "Pi agent finished" },
          });

          return events;
        }

        // ---- Turn lifecycle ---------------------------------------------------
        case "turn_start":
          // pi emits its own turn_start; we've already emitted canonical
          // turn.started from sendTurn.  No-op to avoid double-emitting.
          return [];

        case "turn_end":
          // pi's turn_end contains the assistant message; we capture it
          // as a fallback for agent_end.
          {
            const turnMessage = (event as Record<string, unknown>).message;
            if (turnMessage) {
              const text = extractAssistantText(turnMessage);
              if (text.length > context.accumulatedAssistantText.length) {
                context.accumulatedAssistantText = text;
              }
            }
          }
          return [];

        // ---- Message lifecycle ------------------------------------------------
        case "message_start":
          return [];

        case "message_update": {
          const assistantEvent = event.assistantMessageEvent as {
            type?: string;
            delta?: string;
          };
          if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
            if (!context.activeAssistantItemId) {
              context.activeAssistantItemId = randomUUID();
            }
            context.accumulatedAssistantText += assistantEvent.delta;
            return [
              {
                ...mkBase(context),
                type: "content.delta",
                itemId: RuntimeItemId.makeUnsafe(context.activeAssistantItemId),
                payload: {
                  streamKind: "assistant_text" as const,
                  delta: assistantEvent.delta,
                },
              },
            ];
          }
          return [];
        }

        case "message_end":
          return [];

        // ---- Tool execution --------------------------------------------------
        case "tool_execution_start": {
          const rec = event as Record<string, unknown>;
          const toolName = typeof rec.toolName === "string" ? rec.toolName : undefined;
          const toolCallId = typeof rec.toolCallId === "string" ? rec.toolCallId : undefined;
          return [
            {
              ...mkBase(context),
              type: "item.started",
              ...(toolCallId ? { itemId: RuntimeItemId.makeUnsafe(toolCallId) } : {}),
              payload: {
                itemType: "dynamic_tool_call" as const,
                status: "inProgress" as const,
                title: toolName ?? "Tool",
                detail: `${toolName ?? "Tool"} started`,
                data: event,
              },
            },
          ];
        }

        case "tool_execution_update": {
          const rec = event as Record<string, unknown>;
          const toolName = typeof rec.toolName === "string" ? rec.toolName : undefined;
          const toolCallId = typeof rec.toolCallId === "string" ? rec.toolCallId : undefined;
          return [
            {
              ...mkBase(context),
              type: "item.updated",
              ...(toolCallId ? { itemId: RuntimeItemId.makeUnsafe(toolCallId) } : {}),
              payload: {
                itemType: "dynamic_tool_call" as const,
                title: toolName ?? "Tool",
                data: event,
              },
            },
          ];
        }

        case "tool_execution_end": {
          const rec = event as Record<string, unknown>;
          const toolName = typeof rec.toolName === "string" ? rec.toolName : undefined;
          const toolCallId = typeof rec.toolCallId === "string" ? rec.toolCallId : undefined;
          return [
            {
              ...mkBase(context),
              type: "item.completed",
              ...(toolCallId ? { itemId: RuntimeItemId.makeUnsafe(toolCallId) } : {}),
              payload: {
                itemType: "dynamic_tool_call" as const,
                status: "completed" as const,
                title: toolName ?? "Tool",
                detail: `${toolName ?? "Tool"} completed`,
                data: event,
              },
            },
          ];
        }

        // ---- Extension UI (approval / user-input) -----------------------------
        case "extension_ui_request": {
          const uiRequest = event as {
            id: string;
            method: string;
            title?: string;
            message?: string;
            options?: string[];
          };
          const requestId = ApprovalRequestId.makeUnsafe(randomUUID());

          context.pendingUIRequests.set(requestId, {
            requestId,
            jsonRpcId: uiRequest.id,
            method: uiRequest.method,
          });

          return [
            {
              ...mkBase(context),
              type: "request.opened",
              requestId: RuntimeRequestId.makeUnsafe(requestId),
              payload: {
                requestType: "command_execution_approval" as const,
                detail: uiRequest.title ?? uiRequest.message ?? uiRequest.method,
                args: uiRequest,
              },
            },
          ];
        }

        // ---- Errors -----------------------------------------------------------
        case "extension_error":
          return [
            {
              ...mkBase(context),
              type: "runtime.error",
              payload: {
                message: String(event.error ?? "Extension error"),
                class: "provider_error" as const,
                detail: event,
              },
            },
          ];

        case "auto_retry_start":
          return [
            {
              ...mkBase(context),
              type: "runtime.warning",
              payload: {
                message: `Auto-retry attempt ${event.attempt ?? 1}/${event.maxAttempts ?? "?"}`,
                detail: event,
              },
            },
          ];

        case "auto_retry_end":
          return [];

        case "auto_compaction_start":
          return [
            {
              ...mkBase(context),
              type: "runtime.warning",
              payload: { message: "Auto-compaction started" },
            },
          ];

        case "auto_compaction_end":
          return [
            {
              ...mkBase(context),
              type: "runtime.warning",
              payload: { message: "Auto-compaction completed" },
            },
          ];

        default:
          return [];
      }
    };

    // ---------------------------------------------------------------------------
    // JSONL reader — splits on `\n` only (NOT on U+2028 / U+2029)
    // ---------------------------------------------------------------------------

    const attachJsonlReader = (
      stream: NodeJS.ReadableStream,
      onLine: (line: string) => void,
    ): void => {
      const decoder = new StringDecoder("utf8");
      let buffer = "";

      const onData = (chunk: Buffer | string) => {
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          // Strip optional trailing \r
          if (line.endsWith("\r")) line = line.slice(0, -1);
          onLine(line);
        }
      };

      const onEnd = () => {
        buffer += decoder.end();
        if (buffer.length > 0) {
          const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
          onLine(line);
          buffer = "";
        }
      };

      stream.on("data", onData);
      stream.on("end", onEnd);
    };

    // ---------------------------------------------------------------------------
    // stdio / process handling
    // ---------------------------------------------------------------------------

    const handlePiOutput = (context: PiSessionContext, line: string): void => {
      if (line.length === 0) return;

      console.log(`[pi-adapter] stdout: ${line.substring(0, 500)}`);

      try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== "object") return;

        const event = parsed as { id?: string; type?: string; [key: string]: unknown };

        // Handle JSON-RPC responses
        if (event.type === "response" && event.id) {
          const key = String(event.id);
          const pending = context.pending.get(key);
          if (pending) {
            clearTimeout(pending.timeout);
            context.pending.delete(key);
            if (event.success === false && event.error) {
              pending.reject(new Error(String(event.error)));
            } else {
              pending.resolve(event.data);
            }
          }
          return;
        }

        // Map native pi events → canonical runtime events → queue
        const runtimeEvents = mapPiNativeToRuntime(context, event);
        for (const re of runtimeEvents) {
          emitRuntimeEvent(re);
        }
      } catch {
        // Ignore JSON parse errors on unrecognised output
      }
    };

    const attachProcessListeners = (context: PiSessionContext): void => {
      attachJsonlReader(context.child.stdout!, (line) => {
        handlePiOutput(context, line);
      });

      context.child.stderr?.on("data", (chunk: Buffer) => {
        const output = chunk.toString();
        console.error(`[pi stderr] ${output}`);
      });

      context.child.on("error", (error) => {
        emitRuntimeEvent({
          ...mkBase(context),
          type: "runtime.error",
          payload: {
            message: error.message,
            class: "transport_error" as const,
          },
        });
      });

      context.child.on("exit", (code, signal) => {
        if (context.stopping) return;

        console.log(`[pi-adapter] process exit code=${code} signal=${signal} threadId=${context.session.threadId} hadActiveTurn=${!!context.activeTurnId}`);

        const turnId = context.activeTurnId;
        context.activeTurnId = undefined;
        context.activeAssistantItemId = undefined;
        sessions.delete(context.session.threadId);

        const events: ProviderRuntimeEvent[] = [];

        if (turnId) {
          events.push({
            ...mkBase(context),
            turnId,
            type: "turn.completed",
            payload: {
              state: "failed" as const,
              errorMessage: `pi exited (code=${code}, signal=${signal})`,
            },
          });
        }

        events.push({
          ...mkBase(context),
          type: "session.exited",
          payload: {
            reason: `pi exited (code=${code}, signal=${signal})`,
            recoverable: false,
          },
        });

        for (const e of events) emitRuntimeEvent(e);
      });
    };

    // ---------------------------------------------------------------------------
    // Adapter API
    // ---------------------------------------------------------------------------

    const startSession = (
      input: ProviderSessionStartInput,
    ): Effect.Effect<ProviderSession, ProviderAdapterError> =>
      Effect.gen(function* () {
        const threadId = input.threadId;
        const now = new Date().toISOString();
        const resolvedCwd = input.cwd ?? process.cwd();
        const model = input.modelSelection?.model ?? undefined;

        const session: ProviderSession = {
          provider: PROVIDER,
          status: "connecting",
          runtimeMode: input.runtimeMode,
          model,
          cwd: resolvedCwd,
          threadId,
          createdAt: now,
          updatedAt: now,
        };

        const args = ["--mode", "rpc"];
        if (model) {
          if (model.indexOf("/") >= 0) {
            const slashIndex = model.indexOf("/");
            const provider = model.substring(0, slashIndex);
            const modelId = model.substring(slashIndex + 1);
            args.push("--provider", provider, "--model", modelId);
          } else {
            args.push("--model", model);
          }
        }

        const mergedEnv = { ...readWindowsRegistryEnvironment(), ...process.env };

        const child = spawn(binaryPath, args, {
          cwd: resolvedCwd,
          env: mergedEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });

        const context: PiSessionContext = {
          session,
          child,
          pending: new Map(),
          pendingUIRequests: new Map(),
          nextRequestId: 1,
          stopping: false,
          activeTurnId: undefined,
          activeAssistantItemId: undefined,
          accumulatedAssistantText: "",
        };

        sessions.set(threadId, context);
        attachProcessListeners(context);

        // Wait briefly for pi to initialise
        yield* Effect.sleep(500);

        // Emit canonical session lifecycle events
        emitRuntimeEvent({
          eventId: EventId.makeUnsafe(randomUUID()),
          provider: PROVIDER,
          threadId,
          createdAt: new Date().toISOString(),
          type: "session.started",
          payload: { message: "Connected to pi agent" },
        });

        const updatedSession: ProviderSession = {
          ...session,
          status: "ready",
          updatedAt: new Date().toISOString(),
        };

        emitRuntimeEvent({
          eventId: EventId.makeUnsafe(randomUUID()),
          provider: PROVIDER,
          threadId,
          createdAt: new Date().toISOString(),
          type: "session.state.changed",
          payload: { state: "ready" as const, reason: "Connected to pi agent" },
        });

        return updatedSession;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "startSession",
              detail: toMessage(cause, "Failed to start Pi session"),
              cause,
            }),
        ),
      );

    const sendTurn = (
      input: ProviderSendTurnInput,
    ): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> =>
      Effect.gen(function* () {
        const context = sessions.get(input.threadId);
        if (!context) {
          console.log(`[pi-adapter] sendTurn: no session for threadId=${input.threadId}`);
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId: input.threadId,
          });
        }

        console.log(`[pi-adapter] sendTurn: threadId=${input.threadId} childPid=${context.child.pid} childKilled=${context.child.killed} stdinWritable=${context.child.stdin.writable}`);

        const turnId = TurnId.makeUnsafe(randomUUID());
        context.activeTurnId = turnId;
        context.activeAssistantItemId = undefined;
        context.accumulatedAssistantText = "";

        // Emit turn.started before sending the prompt so that the ingestion
        // pipeline knows a turn is active when subsequent events arrive.
        emitRuntimeEvent({
          eventId: EventId.makeUnsafe(randomUUID()),
          provider: PROVIDER,
          threadId: input.threadId,
          createdAt: new Date().toISOString(),
          turnId,
          type: "turn.started",
          payload: { model: input.modelSelection?.model },
        });

        emitRuntimeEvent({
          eventId: EventId.makeUnsafe(randomUUID()),
          provider: PROVIDER,
          threadId: input.threadId,
          createdAt: new Date().toISOString(),
          turnId,
          type: "session.state.changed",
          payload: { state: "running" as const },
        });

        const promptCmd = {
          type: "prompt",
          message: input.input ?? "",
        };

        yield* Effect.flatMap(sendRequest(context, promptCmd), () => Effect.void);

        return {
          threadId: input.threadId,
          turnId,
        };
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "sendTurn",
              detail: toMessage(cause, "sendTurn failed"),
              cause,
            }),
        ),
      );

    const interruptTurn = (
      threadId: ThreadId,
      _turnId?: TurnId,
    ): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }

        yield* Effect.flatMap(sendRequest(context, { type: "abort" }), () => Effect.void);
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "interruptTurn",
              detail: toMessage(cause, "interruptTurn failed"),
              cause,
            }),
        ),
      );

    const respondToRequest = (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      decision: ProviderApprovalDecision,
    ): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }

        const pendingRequest = context.pendingUIRequests.get(requestId);
        if (!pendingRequest) {
          return;
        }

        context.pendingUIRequests.delete(requestId);

        const response =
          decision === "decline" || decision === "cancel"
            ? { type: "extension_ui_response", id: pendingRequest.jsonRpcId, cancelled: true }
            : { type: "extension_ui_response", id: pendingRequest.jsonRpcId, value: "allow" };

        yield* Effect.flatMap(sendRequest(context, response), () => Effect.void);

        emitRuntimeEvent({
          eventId: EventId.makeUnsafe(randomUUID()),
          provider: PROVIDER,
          threadId,
          createdAt: new Date().toISOString(),
          ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
          requestId: RuntimeRequestId.makeUnsafe(requestId),
          type: "request.resolved",
          payload: {
            requestType: "command_execution_approval" as const,
            decision,
          },
        });
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "respondToRequest",
              detail: toMessage(cause, "respondToRequest failed"),
              cause,
            }),
        ),
      );

    const respondToUserInput = (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      answers: ProviderUserInputAnswers,
    ): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }

        const pendingRequest = context.pendingUIRequests.get(requestId);
        if (!pendingRequest) {
          return;
        }

        context.pendingUIRequests.delete(requestId);

        const answerValues = Object.values(answers);
        const response = {
          type: "extension_ui_response",
          id: pendingRequest.jsonRpcId,
          value: String(answerValues[0] ?? ""),
        };

        yield* Effect.flatMap(sendRequest(context, response), () => Effect.void);

        emitRuntimeEvent({
          eventId: EventId.makeUnsafe(randomUUID()),
          provider: PROVIDER,
          threadId,
          createdAt: new Date().toISOString(),
          ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
          requestId: RuntimeRequestId.makeUnsafe(requestId),
          type: "user-input.resolved",
          payload: { answers },
        });
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "respondToUserInput",
              detail: toMessage(cause, "respondToUserInput failed"),
              cause,
            }),
        ),
      );

    const stopSession = (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        if (context) {
          context.stopping = true;
          context.pending.clear();
          context.pendingUIRequests.clear();
          if (!context.child.killed) {
            try {
              context.child.kill("SIGTERM");
              setTimeout(() => {
                if (!context.child.killed) {
                  context.child.kill("SIGKILL");
                }
              }, 2000);
            } catch {
              // Ignore
            }
          }
          sessions.delete(threadId);
        }
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "stopSession",
              detail: toMessage(cause, "stopSession failed"),
              cause,
            }),
        ),
      );

    const listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
      Effect.sync(() => Array.from(sessions.values()).map((c) => c.session));

    const hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        if (!context) {
          console.log(`[pi-adapter] hasSession(${threadId}): no context in map`);
          return false;
        }
        const alive = !context.child.killed && context.child.exitCode === null;
        if (!alive) {
          console.log(`[pi-adapter] hasSession(${threadId}): process dead (killed=${context.child.killed} exitCode=${context.child.exitCode})`);
          sessions.delete(threadId);
        } else {
          console.log(`[pi-adapter] hasSession(${threadId}): alive (pid=${context.child.pid})`);
        }
        return alive;
      });

    const stopAll = (): Effect.Effect<void> =>
      Effect.sync(() => {
        for (const context of sessions.values()) {
          context.stopping = true;
          if (!context.child.killed) {
            try {
              context.child.kill("SIGTERM");
            } catch {
              // Ignore
            }
          }
        }
        sessions.clear();
      });

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session" as const,
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread: () =>
        Effect.sync(() => ({
          threadId: "" as ThreadId,
          turns: [] as const,
        })),
      rollbackThread: () =>
        Effect.sync(() => ({
          threadId: "" as ThreadId,
          turns: [] as const,
        })),
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    } satisfies PiAdapterShape<ProviderAdapterError>;
  });
}

export const PiAdapterLive = Layer.effect(PiAdapter, makePiAdapter());

export function makePiAdapterLive(options?: PiAdapterLiveOptions) {
  return Layer.effect(PiAdapter, makePiAdapter(options));
}

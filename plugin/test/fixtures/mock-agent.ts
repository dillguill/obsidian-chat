/** In-process mock ACP agent for deterministic tests (T006).
 *
 *  Uses the SDK's agent-side app; no child process and no ports. Tests connect
 *  it directly to the shell client (or through the linked-stream helper).
 */
import {
  PROTOCOL_VERSION,
  agent,
  methods,
  type AgentApp,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";

export interface MockAgentOptions {
  sessionId?: string;
  /** Updates emitted for every prompt (in order). */
  updates?: SessionUpdate[];
  /** Ask for permission during the prompt; options are fixed. */
  requestPermission?: boolean;
  permissionOptionId?: string;
  stopReason?: "end_turn" | "cancelled" | "max_tokens" | "refusal";
  capabilities?: {
    loadSession?: boolean;
    resume?: boolean;
    mcpHttp?: boolean;
  };
  modes?: unknown;
  configOptions?: unknown;
  /** Resolve the prompt before emitting the last update (opencode anomaly). */
  resolveBeforeLastUpdate?: boolean;
  /** Keep the prompt pending until the client sends session/cancel. */
  blockUntilCancel?: boolean;
  /** Delay before resolving a prompt (ms), to test in-flight crashes. */
  promptDelayMs?: number;
  /** Observes the session/new (and resume/load) request params verbatim. */
  onSessionRequest?: (method: "new" | "load" | "resume", params: unknown) => void;
  /** Observes the permission response the client sent (verbatim). */
  onPermissionResponse?: (response: RequestPermissionResponse) => void;
  /** Observes declared-control requests (set_mode / set_config_option) verbatim. */
  onControlRequest?: (method: "set_mode" | "set_config_option", params: unknown) => void;
}

const TOOL_CALL: SessionUpdate = {
  sessionUpdate: "tool_call",
  toolCallId: "tc_1",
  title: "Read note",
  kind: "read",
  status: "in_progress",
  locations: [{ path: "/vault/Inbox/demo.md" }],
  rawInput: { path: "Inbox/demo.md" },
} as SessionUpdate;

export function defaultUpdates(text = "hello"): SessionUpdate[] {
  return [
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking…" } } as SessionUpdate,
    TOOL_CALL,
    { sessionUpdate: "tool_call_update", toolCallId: "tc_1", status: "completed" } as SessionUpdate,
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    } as SessionUpdate,
  ];
}

export function createMockAgent(options: MockAgentOptions = {}): AgentApp {
  const sessionId = options.sessionId ?? "session_mock_1";
  const capabilities = options.capabilities ?? {};
  let currentModes = options.modes ?? undefined;
  let currentConfig = options.configOptions ?? undefined;
  let lastUpdates: SessionUpdate[] = [];
  let cancelWaiter: (() => void) | null = null;

  return agent({ name: "mock-agent" } as never)
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: !!capabilities.loadSession,
        promptCapabilities: { image: true, audio: false, embeddedContext: false },
        mcpCapabilities: { http: !!capabilities.mcpHttp, sse: false, acp: false },
        sessionCapabilities: { resume: capabilities.resume ? {} : null, list: {} },
      },
      agentInfo: { name: "mock-agent", version: "0.0.1" },
    }))
    .onRequest(methods.agent.session.new, (ctx) => {
      options.onSessionRequest?.("new", ctx.params);
      lastUpdates = options.updates ?? defaultUpdates();
      return { sessionId, modes: currentModes as never, configOptions: currentConfig as never };
    })
    .onRequest(methods.agent.session.load, (ctx) => {
      options.onSessionRequest?.("load", ctx.params);
      lastUpdates = options.updates ?? defaultUpdates("replayed");
      return { modes: currentModes as never, configOptions: currentConfig as never };
    })
    .onRequest(methods.agent.session.resume, (ctx) => {
      options.onSessionRequest?.("resume", ctx.params);
      return { modes: currentModes as never, configOptions: currentConfig as never };
    })
    .onRequest(methods.agent.session.list, () => ({ sessions: [] }))
    .onRequest(methods.agent.session.close, () => ({}))
    .onRequest(methods.agent.session.setMode, (ctx) => {
      options.onControlRequest?.("set_mode", ctx.params);
      currentModes = { ...(currentModes as Record<string, unknown> | undefined), currentModeId: ctx.params.modeId };
      return {};
    })
    .onRequest(methods.agent.session.setConfigOption, (ctx) => {
      options.onControlRequest?.("set_config_option", ctx.params);
      const params = ctx.params as { configId: string; value: string | boolean };
      if (Array.isArray(currentConfig)) {
        currentConfig = (currentConfig as Array<{ id: string }>).map((option) =>
          option.id === params.configId ? { ...option, currentValue: params.value } : option,
        );
      }
      return { configOptions: (currentConfig ?? []) as never };
    })
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      if (options.promptDelayMs) await new Promise((resolve) => setTimeout(resolve, options.promptDelayMs));
      if (options.blockUntilCancel) {
        await new Promise<void>((resolve) => {
          cancelWaiter = resolve;
        });
        return { stopReason: "cancelled" as const };
      }
      const updates = lastUpdates;
      if (options.requestPermission) {
        const request: RequestPermissionRequest = {
          sessionId: ctx.params.sessionId,
          toolCall: {
            toolCallId: "tc_perm",
            title: "Write note",
            kind: "edit",
            status: "pending",
            content: [{ type: "diff", path: "Inbox/new.md", oldText: "", newText: "new\n" }],
            locations: [{ path: "/vault/Inbox/new.md" }],
          } as never,
          options: [
            { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject_once", name: "Reject", kind: "reject_once" },
          ],
        };
        const response = await ctx.client.request(methods.client.session.requestPermission, request);
        options.onPermissionResponse?.(response);
      }
      const emit = async (update: SessionUpdate) => {
        await ctx.client.notify(methods.client.session.update, { sessionId: ctx.params.sessionId, update } as never);
      };
      for (let i = 0; i < updates.length; i++) {
        if (options.resolveBeforeLastUpdate && i === updates.length - 1) {
          setTimeout(() => void emit(updates[i]), 10);
          break;
        }
        await emit(updates[i]);
      }
      // Give the notification writes a turn to flush before resolving: some
      // transports let the response overtake the last notification otherwise.
      if (!options.resolveBeforeLastUpdate) await new Promise((resolve) => setTimeout(resolve, 10));
      return { stopReason: options.stopReason ?? "end_turn" };
    })
    .onNotification(methods.agent.session.cancel, () => {
      cancelWaiter?.();
      cancelWaiter = null;
    });
}

/** Two linked ACP `Stream`s for connecting a client app directly to an agent
 *  app without a transport (used by tests). */
export function linkedStreams(): { clientStream: unknown; agentStream: unknown } {
  const toAgent = new TransformStream();
  const toClient = new TransformStream();
  return {
    clientStream: { writable: toAgent.writable, readable: toClient.readable },
    agentStream: { writable: toClient.writable, readable: toAgent.readable },
  };
}

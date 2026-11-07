/** The ACP shell client: one persistent ACP connection per attach, driven by
 *  the official SDK's typed client app (FR-001…FR-015, FR-018…FR-038).
 *
 *  The client is transport-agnostic (local stdio or remote WebSocket), never
 *  implements an agent, never calls a model, and never executes a tool call.
 *  The prompt's resolution is the only turn terminator; late updates are
 *  attributed and surfaced, never dropped.
 */
import {
  PROTOCOL_VERSION,
  RequestError,
  client,
  methods,
  type AvailableCommand,
  type ClientConnection,
  type ContentBlock,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionModeState,
  type SessionNotification,
  type SessionUpdate,
  type StopReason,
} from "@agentclientprotocol/sdk";
import type {
  AcpChatClient,
  AcpConnectionState,
  AcpDebugInfo,
  AttachMode,
  ChatEvent,
  PendingPermission,
  RenderUpdate,
} from "../acp/types.ts";
import { mapSessionUpdate } from "../acp/session-update.ts";
import { cancelledPermission, decidePermission, toPendingPermission } from "../acp/permissions.ts";
import { flattenSelectOptions } from "../acp/controls.ts";
import { backoffDelay, type ShellTransport, type TransportConnector } from "./transport.ts";
import { type ShellEnvironment } from "./types.ts";

export interface McpServerEntry {
  name: string;
  type: "http";
  url: string;
  headers: { name: string; value: string }[];
}

export interface ShellClientOptions {
  mode: AttachMode;
  connector: TransportConnector;
  cwd: string;
  label: string;
  environment?: ShellEnvironment;
  /** MCP server entry to advertise when the harness supports HTTP MCP. */
  mcpServer?: () => McpServerEntry | null;
  /** Continuity: restore an existing harness session instead of creating one. */
  restore?: { method: "resume" | "load"; sessionId: string };
  onLog?: (message: string) => void;
  onTransportLost?: (reason: string) => void;
}

interface ParkedPermission {
  request: PendingPermission;
  resolve: (response: RequestPermissionResponse) => void;
}

export class AcpShellClient implements AcpChatClient {
  private opts: ShellClientOptions;
  private conn: ClientConnection | null = null;
  private transport: ShellTransport | null = null;
  private sessionId: string | null = null;
  private modes: SessionModeState | null = null;
  private configOptions: SessionConfigOption[] | null = null;
  private commands: AvailableCommand[] | null = null;
  private capabilities = { loadSession: false, resume: false, mcpHttp: false };
  private state: AcpConnectionState = "idle";
  private retries = 0;
  private lastError: string | null = null;
  private eventListeners = new Set<(event: ChatEvent) => void>();
  private permissionListeners = new Set<(request: PendingPermission) => void>();
  private stateListeners = new Set<() => void>();
  private parked = new Map<string, ParkedPermission>();
  private permissionCounter = 0;
  private turnNumber = 0;
  private turnActive = false;
  private lastTurn = 0;
  private lastTurnEndedAt = 0;
  private closed = false;
  private lost:
    | { promise: Promise<never>; reject: (err: Error) => void }
    | null = null;

  constructor(options: ShellClientOptions) {
    this.opts = options;
  }

  onEvent(cb: (event: ChatEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }
  onPermissionRequest(cb: (request: PendingPermission) => void): () => void {
    this.permissionListeners.add(cb);
    return () => this.permissionListeners.delete(cb);
  }
  onStateChange(cb: () => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
  getModes(): SessionModeState | null {
    return this.modes;
  }
  getConfigOptions(): SessionConfigOption[] | null {
    return this.configOptions;
  }
  getCommands(): AvailableCommand[] | null {
    return this.commands;
  }
  getState(): AcpConnectionState {
    return this.state;
  }
  /** Cached capability snapshot for the session record header. */
  getCapabilitiesSnapshot(): { loadSession: boolean; resume: boolean; mcpHttp: boolean } {
    return { ...this.capabilities };
  }

  getDebugInfo(): AcpDebugInfo {
    return {
      state: this.state,
      mode: this.opts.mode,
      label: this.opts.label,
      sessionId: this.sessionId,
      retries: this.retries,
      lastError: this.lastError,
    };
  }

  private emit(event: ChatEvent): void {
    for (const cb of [...this.eventListeners]) {
      try {
        cb(event);
      } catch {
        // A listener bug must not break the protocol stream.
      }
    }
  }
  private emitState(): void {
    for (const cb of [...this.stateListeners]) {
      try {
        cb();
      } catch {
        // ignored
      }
    }
  }
  private setState(state: AcpConnectionState, error?: string): void {
    this.state = state;
    if (error !== undefined) this.lastError = error;
    this.emitState();
  }
  private log(message: string): void {
    this.opts.onLog?.(message);
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error("client is closed");
    if (this.conn) return;
    this.setState("connecting");
    const transport = await this.opts.connector.connect();
    this.transport = transport;
    const app = client({ name: "obsidian-chat" })
      .onRequest(methods.client.fs.readTextFile, async (ctx) => {
        const env = this.requireEnvironment();
        try {
          return {
            content: await env.readTextFile(ctx.params.path, ctx.params.line ?? undefined, ctx.params.limit ?? undefined),
          };
        } catch (err) {
          throw new RequestError(-32602, errorText(err));
        }
      })
      .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
        const env = this.requireEnvironment();
        try {
          await env.snapshotBeforeWrite?.(ctx.params.path);
          await env.writeTextFile(ctx.params.path, ctx.params.content);
          await env.afterWrite?.(ctx.params.path);
          return {};
        } catch (err) {
          throw new RequestError(-32602, errorText(err));
        }
      })
      .onRequest(methods.client.session.requestPermission, (ctx) => this.requestPermission(ctx.params))
      .onNotification(methods.client.session.update, (ctx) => this.handleUpdate(ctx.params));
    const conn = app.connect(transport.stream);
    this.conn = conn;
    let lostReject: ((err: Error) => void) | null = null;
    this.lost = {
      promise: new Promise<never>((_, reject) => {
        lostReject = reject;
      }),
      reject: (err) => lostReject?.(err),
    };
    transport.onClose((reason) => {
      this.lost?.reject(new Error(reason));
      this.transportLost(reason);
    });
    try {
      const init = await Promise.race([
        conn.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "obsidian-chat", version: "2.0.0" },
          clientCapabilities: {
            fs: this.opts.environment?.canServeVault()
              ? { readTextFile: true, writeTextFile: true }
              : { readTextFile: false, writeTextFile: false },
          },
        }),
        this.lost.promise,
      ]);
      if (init.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(`unsupported ACP protocol version ${String(init.protocolVersion)} (expected ${PROTOCOL_VERSION})`);
      }
      const caps = init.agentCapabilities ?? {};
      this.capabilities = {
        loadSession: !!caps.loadSession,
        resume: !!caps.sessionCapabilities?.resume,
        mcpHttp: !!caps.mcpCapabilities?.http,
      };
      await Promise.race([this.openSession(conn), this.lost.promise]);
      this.setState("connected", undefined);
      this.retries = 0;
    } catch (err) {
      this.lastError = errorText(err);
      // The transport may still be alive; close it so a retry starts cleanly.
      await this.closeTransport();
      this.conn = null;
      this.setState("unreachable", this.lastError);
      throw err;
    }
  }

  private mcpServers(): McpServerEntry[] {
    if (!this.capabilities.mcpHttp) return [];
    const entry = this.opts.mcpServer?.();
    return entry ? [entry] : [];
  }

  private async openSession(conn: ClientConnection): Promise<void> {
    const mcpServers = this.mcpServers();
    if (this.opts.restore?.method === "resume") {
      const resumed = await conn.agent.request(methods.agent.session.resume, {
        sessionId: this.opts.restore.sessionId,
        cwd: this.opts.cwd,
        mcpServers,
      } as never) as { modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null };
      this.sessionId = this.opts.restore.sessionId;
      this.applySessionState(resumed.modes ?? null, resumed.configOptions ?? null);
      return;
    }
    if (this.opts.restore?.method === "load") {
      const loaded = await conn.agent.request(methods.agent.session.load, {
        sessionId: this.opts.restore.sessionId,
        cwd: this.opts.cwd,
        mcpServers,
      } as never) as { modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null };
      this.sessionId = this.opts.restore.sessionId;
      this.applySessionState(loaded.modes ?? null, loaded.configOptions ?? null);
      return;
    }
    const created = (await conn.agent.request(methods.agent.session.new, { cwd: this.opts.cwd, mcpServers } as never)) as {
      sessionId: string;
      modes?: SessionModeState | null;
      configOptions?: SessionConfigOption[] | null;
    };
    this.sessionId = created.sessionId;
    this.applySessionState(created.modes ?? null, created.configOptions ?? null);
  }

  private applySessionState(modes: SessionModeState | null | undefined, configOptions: SessionConfigOption[] | null | undefined): void {
    this.modes = modes ?? null;
    this.configOptions = configOptions ?? null;
    this.emitState();
  }

  private requireEnvironment(): ShellEnvironment {
    if (!this.opts.environment) throw new Error("this client has no vault environment");
    return this.opts.environment;
  }

  /** Handles `session/update`; control-only kinds update state, everything else
   *  becomes a render update (including unknown kinds, raw). */
  private handleUpdate(params: SessionNotification): void {
    const update = params.update as SessionUpdate;
    const kind = (update as { sessionUpdate?: string }).sessionUpdate ?? "unknown";
    if (kind === "current_mode_update") {
      if (this.modes) {
        this.modes = { ...this.modes, currentModeId: (update as { currentModeId: string }).currentModeId };
        this.emitState();
      }
      return;
    }
    if (kind === "config_option_update") {
      this.configOptions = (update as { configOptions: SessionConfigOption[] }).configOptions;
      this.emitState();
      return;
    }
    if (kind === "available_commands_update") {
      this.commands = (update as { availableCommands: AvailableCommand[] }).availableCommands;
      this.emitState();
      return;
    }
    const mapped: RenderUpdate | null = mapSessionUpdate(update);
    if (!mapped) return;
    if (kind === "session_info_update") {
      this.emitState();
    }
    const late = !this.turnActive && this.lastTurn > 0;
    if (mapped.type === "tool_call" && late) mapped.toolCall.late = true;
    this.emit({
      sessionId: params.sessionId,
      update: mapped,
      turnNumber: this.turnActive ? this.turnNumber : this.lastTurn || undefined,
      late,
    });
  }

  async prompt(blocks: ContentBlock[]): Promise<StopReason | string> {
    const conn = this.conn;
    if (!conn || !this.sessionId) throw new Error("not connected");
    if (this.turnActive) throw new Error("a turn is already in flight");
    if (this.lastTurnEndedAt) {
      const wait = Math.max(0, 250 - (Date.now() - this.lastTurnEndedAt));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.turnActive = true;
    this.turnNumber += 1;
    const turn = this.turnNumber;
    let stopReason: StopReason | string | undefined;
    try {
      const response: PromptResponse = await Promise.race([
        conn.agent.request(methods.agent.session.prompt, {
          sessionId: this.sessionId,
          prompt: blocks,
        }),
        this.lost?.promise ?? new Promise<never>(() => undefined),
      ]);
      stopReason = response.stopReason;
      if (response.usage) {
        this.emit({
          sessionId: this.sessionId,
          update: { type: "usage", usage: response.usage as never },
          turnNumber: turn,
        });
      }
      return response.stopReason;
    } catch (err) {
      this.emit({ sessionId: this.sessionId, turnNumber: turn, error: { message: errorText(err), scope: "harness" } });
      throw err;
    } finally {
      this.turnActive = false;
      this.lastTurn = turn;
      this.lastTurnEndedAt = Date.now();
      this.emit({ sessionId: this.sessionId, turn: { number: turn, stopReason, interrupted: stopReason === undefined } });
    }
  }

  async cancel(): Promise<void> {
    this.cancelParkedPermissions();
    const conn = this.conn;
    if (!conn || !this.sessionId) return;
    try {
      await conn.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId });
    } catch (err) {
      this.log(`cancel failed: ${errorText(err)}`);
    }
  }

  async respondPermission(requestId: string, optionId: string | null): Promise<void> {
    const parked = this.parked.get(requestId);
    if (!parked) return;
    this.parked.delete(requestId);
    parked.resolve(decidePermission(parked.request.options, optionId));
  }

  private requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = `perm_${++this.permissionCounter}`;
    const request = toPendingPermission(requestId, params);
    const promise = new Promise<RequestPermissionResponse>((resolve) => {
      this.parked.set(requestId, { request, resolve });
    });
    for (const cb of [...this.permissionListeners]) {
      try {
        cb(request);
      } catch {
        // listener bug must not break the request
      }
    }
    return promise;
  }

  private cancelParkedPermissions(): void {
    for (const [id, parked] of [...this.parked.entries()]) {
      this.parked.delete(id);
      parked.resolve(cancelledPermission());
    }
  }

  async setMode(modeId: string): Promise<void> {
    const conn = this.conn;
    if (!conn || !this.sessionId) return;
    await conn.agent.request(methods.agent.session.setMode, { sessionId: this.sessionId, modeId });
    if (this.modes) {
      this.modes = { ...this.modes, currentModeId: modeId };
      this.emitState();
    }
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<void> {
    const conn = this.conn;
    if (!conn || !this.sessionId) return;
    const params =
      typeof value === "boolean"
        ? { sessionId: this.sessionId, configId, type: "boolean" as const, value }
        : { sessionId: this.sessionId, configId, value };
    const response = await conn.agent.request(methods.agent.session.setConfigOption, params as never);
    const options = (response as { configOptions?: SessionConfigOption[] }).configOptions;
    if (options) {
      this.configOptions = options;
      this.emitState();
    }
  }

  /** Selects a declared option value (used by generic controls). */
  selectConfigChoice(optionId: string, value: string | boolean): Promise<void> {
    return this.setConfigOption(optionId, value);
  }

  /** The first declared select option's choices, if any (generic UI helper). */
  choicesFor(optionId: string): { value: string; name: string }[] {
    const option = this.configOptions?.find((o) => o.id === optionId);
    return option ? flattenSelectOptions(option).map((c: { value: string; name: string }) => ({ value: c.value, name: c.name })) : [];
  }

  private transportLost(reason: string): void {
    if (this.closed) return;
    this.lastError = reason;
    this.cancelParkedPermissions();
    this.emit({
      sessionId: this.sessionId ?? "unknown",
      error: { message: `Harness connection lost — pending approvals were cancelled (${reason}).`, scope: "transport" },
    });
    this.setState("reconnecting", reason);
    this.opts.onTransportLost?.(reason);
  }

  private async closeTransport(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    if (transport) await transport.close().catch(() => undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cancelParkedPermissions();
    try {
      this.conn?.close();
    } catch {
      // already closed
    }
    this.conn = null;
    this.sessionId = null;
    await this.closeTransport();
    this.setState("closed");
  }

  /** Retry counter used by the owner's reconnect policy. */
  nextRetryDelay(): number {
    this.retries += 1;
    this.emitState();
    return backoffDelay(this.retries);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

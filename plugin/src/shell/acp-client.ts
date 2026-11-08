/** The ACP shell client: one persistent ACP connection per attach, driven by
 *  the official SDK's typed client app (FR-001…FR-015, FR-018…FR-038).
 *
 *  The client is transport-agnostic (local stdio or remote WebSocket), never
 *  implements an agent, never calls a model, and never executes a tool call.
 *  The prompt's resolution is the only turn terminator; late updates are
 *  attributed and surfaced, never dropped.
 *
 *  One connection can carry several ACP sessions (session/new) — the host uses
 *  that to serve several paired devices from the single harness child. The
 *  `sessionId` getter is the client's *primary* session (the local UI's chat);
 *  session-scoped methods (`promptIn`, `setModeIn`, …) are used by the relay.
 */
import { RENAME_METHOD } from "../session/title.ts";
import {
  PROTOCOL_VERSION,
  RequestError,
  client,
  methods,
  type AvailableCommand,
  type ClientConnection,
  type ContentBlock,
  type ListSessionsResponse,
  type LoadSessionResponse,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionInfo,
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

export interface RestoreRequest {
  method: "resume" | "load";
  sessionId: string;
  /** Replay only entries after this record sequence (session/load `_meta`). */
  sinceSeq?: number;
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
  restore?: RestoreRequest;
  /** Host-side client: initialize only, create sessions on demand. */
  autoSession?: boolean;
  /** Operational approval timeout (contract §6: 10 minutes). 0 disables it. */
  approvalTimeoutMs?: number;
  onLog?: (message: string) => void;
  onTransportLost?: (reason: string) => void;
}

interface ParkedPermission {
  request: PendingPermission;
  sessionId: string;
  resolve: (response: RequestPermissionResponse) => void;
  timer?: ReturnType<typeof setTimeout>;
}

import { DEFAULT_APPROVAL_TIMEOUT_MS } from "../session/limits.ts";
export { DEFAULT_APPROVAL_TIMEOUT_MS };

/** Per-session live state (turns, declared controls). */
interface SessionState {
  sessionId: string;
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[] | null;
  commands: AvailableCommand[] | null;
  turnNumber: number;
  turnActive: boolean;
  lastTurn: number;
  lastTurnEndedAt: number;
}

export interface RawUpdateMeta {
  late: boolean;
  turn?: number;
}

export class AcpShellClient implements AcpChatClient {
  private opts: ShellClientOptions;
  private conn: ClientConnection | null = null;
  private transport: ShellTransport | null = null;
  private primary: string | null = null;
  private sessions = new Map<string, SessionState>();
  private capabilities = { loadSession: false, resume: false, mcpHttp: false };
  private state: AcpConnectionState = "idle";
  private retries = 0;
  private lastError: string | null = null;
  private eventListeners = new Set<(event: ChatEvent) => void>();
  private permissionListeners = new Set<(request: PendingPermission) => void>();
  private stateListeners = new Set<() => void>();
  private rawUpdateListeners = new Set<(params: SessionNotification, meta: RawUpdateMeta) => void>();
  private loggedUnmapped = new Set<string>();
  private rawPermissionListeners = new Set<(request: RequestPermissionRequest, requestId: string) => boolean>();
  private parked = new Map<string, ParkedPermission>();
  private permissionCounter = 0;
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

  /** Raw ACP updates (unmapped) for the host relay and raw record. */
  onRawUpdate(cb: (params: SessionNotification, meta: RawUpdateMeta) => void): () => void {
    this.rawUpdateListeners.add(cb);
    return () => this.rawUpdateListeners.delete(cb);
  }

  /** Raw permission requests for the host relay. Returning true claims the
   *  request: the relay forwards it to the owning device and resolves it with
   *  `respondPermissionRaw`, and the mapped UI listener is not called. */
  onRawPermissionRequest(cb: (request: RequestPermissionRequest, requestId: string) => boolean): () => void {
    this.rawPermissionListeners.add(cb);
    return () => this.rawPermissionListeners.delete(cb);
  }

  getSessionId(): string | null {
    return this.primary;
  }
  getSessionModes(sessionId: string): SessionModeState | null {
    return this.sessions.get(sessionId)?.modes ?? null;
  }
  getSessionConfigOptions(sessionId: string): SessionConfigOption[] | null {
    return this.sessions.get(sessionId)?.configOptions ?? null;
  }
  getSessionCommands(sessionId: string): AvailableCommand[] | null {
    return this.sessions.get(sessionId)?.commands ?? null;
  }
  getModes(): SessionModeState | null {
    return this.primary ? this.getSessionModes(this.primary) : null;
  }
  getConfigOptions(): SessionConfigOption[] | null {
    return this.primary ? this.getSessionConfigOptions(this.primary) : null;
  }
  getCommands(): AvailableCommand[] | null {
    return this.primary ? this.getSessionCommands(this.primary) : null;
  }
  getState(): AcpConnectionState {
    return this.state;
  }
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
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
      sessionId: this.primary,
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

  private stateFor(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        modes: null,
        configOptions: null,
        commands: null,
        turnNumber: 0,
        turnActive: false,
        lastTurn: 0,
        lastTurnEndedAt: 0,
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private registerSession(
    sessionId: string,
    modes: SessionModeState | null | undefined,
    configOptions: SessionConfigOption[] | null | undefined,
  ): void {
    const state = this.stateFor(sessionId);
    if (modes !== undefined) state.modes = modes ?? null;
    if (configOptions !== undefined) state.configOptions = configOptions ?? null;
    this.emitState();
  }

  /** Makes an existing session the client's primary (UI) session. */
  setCurrentSession(sessionId: string | null): void {
    this.primary = sessionId;
    this.emitState();
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
      if (this.opts.autoSession !== false) {
        await Promise.race([this.openSession(conn), this.lost.promise]);
      }
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
    const restore = this.opts.restore;
    if (restore?.method === "resume") {
      const resumed = (await conn.agent.request(methods.agent.session.resume, {
        sessionId: restore.sessionId,
        cwd: this.opts.cwd,
        mcpServers: this.mcpServers(),
      } as never)) as { modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null };
      this.registerSession(restore.sessionId, resumed.modes ?? null, resumed.configOptions ?? null);
      this.primary = restore.sessionId;
      this.emitState();
      return;
    }
    if (restore?.method === "load") {
      const loaded = await this.loadSession(restore.sessionId, { sinceSeq: restore.sinceSeq });
      this.registerSession(restore.sessionId, loaded.modes ?? null, loaded.configOptions ?? null);
      return;
    }
    const created = await this.createSession();
    this.primary = created.sessionId;
    this.emitState();
  }

  /** Opens a new ACP session on this connection (the host calls this per
   *  device; the local client calls it once on connect). */
  async createSession(request?: {
    cwd?: string;
    mcpServers?: McpServerEntry[];
    meta?: Record<string, unknown>;
  }): Promise<NewSessionResponse> {
    const conn = this.requireConn();
    const params: Record<string, unknown> = {
      cwd: request?.cwd ?? this.opts.cwd,
      mcpServers: request?.mcpServers ?? this.mcpServers(),
    };
    if (request?.meta) params._meta = request.meta;
    const created = (await conn.agent.request(methods.agent.session.new, params as never)) as NewSessionResponse;
    this.registerSession(created.sessionId, created.modes ?? null, created.configOptions ?? null);
    if (!this.primary) this.primary = created.sessionId;
    this.emitState();
    return created;
  }

  /** Loads (and replays) an existing ACP session; replay updates arrive as
   *  `session/update` notifications before this resolves. */
  async loadSession(
    sessionId: string,
    options?: { cwd?: string; sinceSeq?: number; mcpServers?: McpServerEntry[] },
  ): Promise<LoadSessionResponse> {
    const conn = this.requireConn();
    const params: Record<string, unknown> = {
      sessionId,
      cwd: options?.cwd ?? this.opts.cwd,
      mcpServers: options?.mcpServers ?? this.mcpServers(),
    };
    if (typeof options?.sinceSeq === "number") {
      params._meta = { "obsidian-chat/sinceSeq": options.sinceSeq };
    }
    const loaded = (await conn.agent.request(methods.agent.session.load, params as never)) as LoadSessionResponse;
    this.registerSession(sessionId, loaded.modes ?? null, loaded.configOptions ?? null);
    this.primary = sessionId;
    this.emitState();
    return loaded;
  }

  /** Standard `session/list` (host advertises `sessionCapabilities.list`). */
  async listSessions(): Promise<SessionInfo[]> {
    const conn = this.requireConn();
    const response = (await conn.agent.request(methods.agent.session.list, { cwd: this.opts.cwd } as never)) as ListSessionsResponse;
    return response.sessions ?? [];
  }

  /** Reattaches to an existing harness session without changing the primary
   *  session (the host uses this to restore a stored conversation). */
  async attachSession(
    sessionId: string,
    options: { method: "resume" | "load"; cwd: string; mcpServers?: McpServerEntry[]; sinceSeq?: number },
  ): Promise<{ modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null }> {
    const conn = this.requireConn();
    const mcpServers = options.mcpServers ?? this.mcpServers();
    const params: Record<string, unknown> = { sessionId, cwd: options.cwd, mcpServers };
    if (options.method === "load" && typeof options.sinceSeq === "number") {
      params._meta = { "obsidian-chat/sinceSeq": options.sinceSeq };
    }
    const method = options.method === "resume" ? methods.agent.session.resume : methods.agent.session.load;
    const response = (await conn.agent.request(method, params as never)) as {
      modes?: SessionModeState | null;
      configOptions?: SessionConfigOption[] | null;
    };
    this.registerSession(sessionId, response.modes ?? null, response.configOptions ?? null);
    this.emitState();
    return response;
  }

  /** Closes a session while keeping the connection open. */
  async closeSession(sessionId: string): Promise<void> {
    const conn = this.conn;
    this.sessions.delete(sessionId);
    if (this.primary === sessionId) this.primary = null;
    this.cancelParkedPermissions(sessionId);
    this.emitState();
    if (!conn) return;
    try {
      await conn.agent.request(methods.agent.session.close, { sessionId } as never);
    } catch {
      // Harness may not support session/close; forgetting it locally is enough.
    }
  }

  private requireConn(): ClientConnection {
    if (!this.conn) throw new Error("not connected");
    return this.conn;
  }

  private requirePrimary(): string {
    if (!this.primary) throw new Error("no active session");
    return this.primary;
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
    const state = this.sessions.get(params.sessionId);
    const late = state ? !state.turnActive && state.lastTurn > 0 : false;
    const turn = state ? (state.turnActive ? state.turnNumber : state.lastTurn || undefined) : undefined;
    const meta = (params._meta ?? {}) as Record<string, unknown>;
    const raw = {
      sessionUpdate: kind,
      payload: params.update,
      seq: typeof meta["obsidian-chat/seq"] === "number" ? (meta["obsidian-chat/seq"] as number) : undefined,
      late: late || meta["obsidian-chat/replay"] === true ? late : undefined,
      replay: meta["obsidian-chat/replay"] === true || undefined,
    };
    for (const cb of [...this.rawUpdateListeners]) {
      try {
        cb(params, { late, turn });
      } catch {
        // relay bug must not break rendering
      }
    }
    if (kind === "current_mode_update") {
      if (state?.modes) {
        state.modes = { ...state.modes, currentModeId: (update as { currentModeId: string }).currentModeId };
        this.emitState();
      }
      this.emit({ sessionId: params.sessionId, turnNumber: turn, raw });
      return;
    }
    if (kind === "config_option_update") {
      if (state) {
        state.configOptions = (update as { configOptions: SessionConfigOption[] }).configOptions;
        this.emitState();
      }
      this.emit({ sessionId: params.sessionId, turnNumber: turn, raw });
      return;
    }
    if (kind === "available_commands_update") {
      if (state) {
        state.commands = (update as { availableCommands: AvailableCommand[] }).availableCommands;
        this.emitState();
      }
      this.emit({ sessionId: params.sessionId, turnNumber: turn, raw });
      return;
    }
    const mapped: RenderUpdate | null = mapSessionUpdate(update);
    if (!mapped) return;
    if (mapped.type === "raw" && !this.loggedUnmapped.has(kind)) {
      // One diagnostic line per unusual kind; helps distinguish "harness sends
      // newer update kinds" from a rendering bug without flooding the console.
      this.loggedUnmapped.add(kind);
      this.log(`unmapped ACP update kind (rendered raw): ${kind}`);
    }
    if (kind === "session_info_update") {
      this.emitState();
    }
    if (mapped.type === "tool_call" && late) mapped.toolCall.late = true;
    this.emit({
      sessionId: params.sessionId,
      update: mapped,
      raw,
      turnNumber: turn,
      late,
    });
  }

  async prompt(blocks: ContentBlock[], meta?: Record<string, unknown>): Promise<StopReason | string> {
    return this.promptIn(this.requirePrimary(), blocks, meta);
  }

  /** Sends a prompt to a specific session; resolves with the harness's stop
   *  reason (the only turn terminator). `_meta` carries standard ACP
   *  extensibility such as the chosen continuity action. */
  async promptIn(sessionId: string, blocks: ContentBlock[], meta?: Record<string, unknown>): Promise<StopReason | string> {
    const requestParams: Record<string, unknown> = { sessionId, prompt: blocks };
    if (meta) requestParams._meta = meta;
    const conn = this.requireConn();
    if (!this.sessions.has(sessionId)) throw new Error(`unknown session: ${sessionId}`);
    const state = this.stateFor(sessionId);
    if (state.turnActive) throw new Error("a turn is already in flight");
    if (state.lastTurnEndedAt) {
      const wait = Math.max(0, 250 - (Date.now() - state.lastTurnEndedAt));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    state.turnActive = true;
    state.turnNumber += 1;
    const turn = state.turnNumber;
    let stopReason: StopReason | string | undefined;
    try {
      const response: PromptResponse = await Promise.race([
        conn.agent.request(methods.agent.session.prompt, requestParams as never),
        this.lost?.promise ?? new Promise<never>(() => undefined),
      ]);
      stopReason = response.stopReason;
      if (response.usage) {
        this.emit({
          sessionId,
          update: { type: "usage", usage: response.usage as never },
          turnNumber: turn,
        });
      }
      return response.stopReason;
    } catch (err) {
      this.emit({ sessionId, turnNumber: turn, error: { message: errorText(err), scope: "harness" } });
      throw err;
    } finally {
      state.turnActive = false;
      state.lastTurn = turn;
      state.lastTurnEndedAt = Date.now();
      this.emit({ sessionId, turn: { number: turn, stopReason, interrupted: stopReason === undefined } });
    }
  }

  async cancel(): Promise<void> {
    if (!this.primary) return;
    await this.cancelIn(this.primary);
  }

  async cancelIn(sessionId: string): Promise<void> {
    this.cancelParkedPermissions(sessionId);
    const conn = this.conn;
    if (!conn) return;
    try {
      await conn.agent.notify(methods.agent.session.cancel, { sessionId } as never);
    } catch (err) {
      this.log(`cancel failed: ${errorText(err)}`);
    }
  }

  async respondPermission(requestId: string, optionId: string | null): Promise<void> {
    const parked = this.parked.get(requestId);
    if (!parked) return;
    this.parked.delete(requestId);
    this.clearPermissionTimer(parked);
    parked.resolve(decidePermission(parked.request.options, optionId));
  }

  /** Resolves a parked request with the remote device's ACP response verbatim. */
  respondPermissionRaw(requestId: string, response: RequestPermissionResponse): void {
    const parked = this.parked.get(requestId);
    if (!parked) return;
    this.parked.delete(requestId);
    this.clearPermissionTimer(parked);
    parked.resolve(response);
  }

  /** Number of approvals currently parked (tests/status surfaces). */
  get pendingPermissionCount(): number {
    return this.parked.size;
  }

  private clearPermissionTimer(parked: ParkedPermission): void {
    if (parked.timer) {
      clearTimeout(parked.timer);
      parked.timer = undefined;
    }
  }

  private timeoutPermission(requestId: string): void {
    const parked = this.parked.get(requestId);
    if (!parked) return;
    this.parked.delete(requestId);
    this.clearPermissionTimer(parked);
    parked.resolve(cancelledPermission());
    this.emit({
      sessionId: parked.sessionId,
      error: {
        message: "The approval request timed out after 10 minutes and was cancelled. The harness must ask again.",
        scope: "permission",
      },
    });
  }

  private requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = `perm_${++this.permissionCounter}`;
    const request = toPendingPermission(requestId, params);
    const promise = new Promise<RequestPermissionResponse>((resolve) => {
      const parked: ParkedPermission = { request, sessionId: params.sessionId, resolve };
      this.parked.set(requestId, parked);
      // Contract §6: an optional 10-minute operational timeout resolves the
      // request as cancelled (never approved); the harness must ask again.
      const timeout = this.opts.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
      if (timeout > 0 && Number.isFinite(timeout)) {
        parked.timer = setTimeout(() => this.timeoutPermission(requestId), timeout);
        parked.timer.unref?.();
      }
    });
    let claimed = false;
    for (const cb of [...this.rawPermissionListeners]) {
      try {
        if (cb(params, requestId)) claimed = true;
      } catch {
        // A relay bug must not drop the harness request: fall through to UI.
      }
    }
    if (!claimed) {
      for (const cb of [...this.permissionListeners]) {
        try {
          cb(request);
        } catch {
          // listener bug must not break the request
        }
      }
    }
    return promise;
  }

  /** Cancels parked requests (all, or one session's). */
  cancelParkedPermissions(sessionId?: string): void {
    for (const [id, parked] of [...this.parked.entries()]) {
      if (sessionId && parked.sessionId !== sessionId) continue;
      this.parked.delete(id);
      this.clearPermissionTimer(parked);
      parked.resolve(cancelledPermission());
    }
  }

  async setMode(modeId: string): Promise<void> {
    await this.setModeIn(this.requirePrimary(), modeId);
  }

  /** Extension `_obsidian-chat/session/rename` (host-implemented). */
  async renameSessionIn(sessionId: string, title: string): Promise<string> {
    const conn = this.requireConn();
    const response = await conn.agent.request<{ title?: string }>(RENAME_METHOD, { sessionId, title });
    return response?.title ?? title;
  }

  async setModeIn(sessionId: string, modeId: string): Promise<void> {
    const conn = this.requireConn();
    await conn.agent.request(methods.agent.session.setMode, { sessionId, modeId } as never);
    const state = this.sessions.get(sessionId);
    if (state?.modes) {
      state.modes = { ...state.modes, currentModeId: modeId };
      this.emitState();
    }
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<void> {
    await this.setConfigOptionIn(this.requirePrimary(), configId, value);
  }

  async setConfigOptionIn(sessionId: string, configId: string, value: string | boolean): Promise<void> {
    const conn = this.requireConn();
    const params =
      typeof value === "boolean"
        ? { sessionId, configId, type: "boolean" as const, value }
        : { sessionId, configId, value };
    const response = await conn.agent.request(methods.agent.session.setConfigOption, params as never);
    const options = (response as { configOptions?: SessionConfigOption[] }).configOptions;
    const state = this.sessions.get(sessionId);
    if (options && state) {
      state.configOptions = options;
      this.emitState();
    }
  }

  /** Selects a declared option value (used by generic controls). */
  selectConfigChoice(optionId: string, value: string | boolean): Promise<void> {
    return this.setConfigOption(optionId, value);
  }

  /** The first declared select option's choices, if any (generic UI helper). */
  choicesFor(optionId: string): { value: string; name: string }[] {
    const option = this.getConfigOptions()?.find((o) => o.id === optionId);
    return option ? flattenSelectOptions(option).map((c: { value: string; name: string }) => ({ value: c.value, name: c.name })) : [];
  }

  private transportLost(reason: string): void {
    if (this.closed) return;
    this.lastError = reason;
    const cancelled = this.parked.size;
    this.cancelParkedPermissions();
    const approvals =
      cancelled > 0
        ? `${cancelled} pending approval${cancelled === 1 ? "" : "s"} were cancelled`
        : "no approvals were pending";
    this.emit({
      sessionId: this.primary ?? "unknown",
      error: { message: `Harness connection lost — ${approvals} (${reason}).`, scope: "transport" },
    });
    this.setState("reconnecting", reason);
    this.opts.onTransportLost?.(reason);
  }

  private async closeTransport(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    if (transport) await transport.close().catch(() => undefined);
  }

  /** Reapplies the session's last selected modes/config values to the harness
   *  (FR-041/FR-065). Values are only replayed for controls the harness still
   *  declares; unknown ids are ignored rather than invented. */
  async reapplyControls(sessionId: string = this.requirePrimary()): Promise<void> {
    const snapshot = this.controlSnapshot(sessionId);
    if (snapshot) await this.reapplySnapshot(sessionId, snapshot);
  }

  private controlSnapshot(sessionId: string): {
    modeId?: string;
    config: Array<{ id: string; value: string | boolean }>;
  } | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    return {
      modeId: state.modes?.currentModeId,
      config: (state.configOptions ?? []).map((option) => ({ id: option.id, value: option.currentValue })),
    };
  }

  private async reapplySnapshot(
    sessionId: string,
    snapshot: { modeId?: string; config: Array<{ id: string; value: string | boolean }> },
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    try {
      if (snapshot.modeId) {
        const declared = state?.modes?.availableModes.some((mode) => mode.id === snapshot.modeId) ?? false;
        if (declared) await this.setModeIn(sessionId, snapshot.modeId);
      }
      const declaredOptions = new Set((state?.configOptions ?? []).map((option) => option.id));
      for (const entry of snapshot.config) {
        if (declaredOptions.has(entry.id)) await this.setConfigOptionIn(sessionId, entry.id, entry.value);
      }
    } catch (err) {
      this.log(`control reapply failed: ${errorText(err)}`);
    }
  }

  /** Reconnects and reattaches to the current session via `session/load` with
   *  `sinceSeq` (contract §5). A new session is never created silently. */
  async reconnect(options?: { sinceSeq?: number }): Promise<void> {
    if (this.closed) throw new Error("client is closed");
    const sessionId = this.primary;
    const snapshot = sessionId ? this.controlSnapshot(sessionId) : null;
    const conn = this.conn;
    this.conn = null;
    try {
      conn?.close();
    } catch {
      // already closed
    }
    await this.closeTransport();
    this.lost = null;
    if (sessionId) this.opts.restore = { method: "load", sessionId, sinceSeq: options?.sinceSeq };
    await this.connect();
    // A remote client connects without an automatic session; reattach now.
    if (sessionId && this.opts.autoSession === false) {
      await this.loadSession(sessionId, { sinceSeq: options?.sinceSeq });
    }
    if (sessionId && snapshot) await this.reapplySnapshot(sessionId, snapshot);
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
    this.primary = null;
    this.sessions.clear();
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

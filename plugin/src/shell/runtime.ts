/** Session-level shell runtime: the facade the chat view talks to.
 *
 *  Local mode = this install is the host: one listener, one harness child, the
 *  host-owned store, and the vault tools. The UI still attaches over the
 *  loopback WebSocket with a per-run local token (T060) — there is no second
 *  in-process client path.
 *
 *  Remote mode = this install is only a frontend: it attaches to a host over
 *  the VPN, spawns nothing, opens no listener, and keeps no conversation store.
 */
import { App, FileSystemAdapter, Platform } from "obsidian";
import type { AcpDebugInfo, ChatEvent, PendingPermission, RenderUpdate } from "../acp/types.ts";
import type { AvailableCommand, SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import type { SessionStore } from "../session/store.ts";
import type { RecordEntry, SessionHeader } from "../session/record.ts";
import { AcpShellClient } from "./acp-client.ts";
import { HostCore } from "./host-core.ts";
import { RemoteTransportConnector, SeqDedupe } from "./remote-transport.ts";
import { backoffDelay } from "./transport.ts";
import { fingerprint, redactLabel } from "./identity.ts";
import type { WriteSnapshot } from "../vault/acp-fs.ts";
import type { ShellAttachConfig } from "./types.ts";

export interface ShellRuntimeSettings {
  shell: ShellAttachConfig;
  sessionStoreFolder: string;
  blacklistFolders: string[];
  pairedDevices: Record<string, string>;
}

export interface ShellRuntimeOptions {
  app: App;
  settings: () => ShellRuntimeSettings;
  store: () => SessionStore;
  /** Called before spawning, to stop the legacy host/client and avoid a second child. */
  stopLegacy?: () => Promise<void>;
  log?: (message: string) => void;
}

export interface ShellHistory {
  header: SessionHeader;
  entries: RecordEntry[];
}

export interface ContinuityInfo {
  state: string;
  reason?: string;
  warning?: string;
  digestAvailable: boolean;
  attached: boolean;
  choices: string[];
}

export type ContinuityChoice = "digest" | "fresh" | "full_replay";

export interface SessionListEntry {
  sessionId: string;
  title: string;
  updatedAt: string;
  resume: string;
  degraded: boolean;
}

export class ShellRuntime {
  private app: App;
  private getSettings: () => ShellRuntimeSettings;
  private getStore: () => SessionStore;
  private stopLegacy?: () => Promise<void>;
  private log: (message: string) => void;
  private host: HostCore | null = null;
  private client: AcpShellClient | null = null;
  private eventListeners = new Set<(event: ChatEvent) => void>();
  private permissionListeners = new Set<(request: PendingPermission) => void>();
  private stateListeners = new Set<() => void>();
  private legacyStopped = false;
  private dedupe = new SeqDedupe();
  private lastSeq = new Map<string, number>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** Explicit continuity choice for the next prompt in a detached conversation. */
  private continuityChoice: ContinuityChoice | null = null;

  constructor(options: ShellRuntimeOptions) {
    this.app = options.app;
    this.getSettings = options.settings;
    this.getStore = options.store;
    this.stopLegacy = options.stopLegacy;
    this.log = options.log ?? (() => undefined);
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

  get clientDebugInfo(): AcpDebugInfo | null {
    return this.client?.getDebugInfo() ?? null;
  }

  get recordId(): string | null {
    return this.client?.getSessionId() ?? null;
  }

  get isConnected(): boolean {
    return !!this.client && this.client.getState() === "connected";
  }

  /** Declared controls for the composer — exactly the attached harness's
   *  current declarations, never a plugin-owned set (FR-039/FR-040). */
  get modes(): SessionModeState | null {
    return this.client?.getModes() ?? null;
  }

  get configOptions(): SessionConfigOption[] | null {
    return this.client?.getConfigOptions() ?? null;
  }

  get commands(): AvailableCommand[] | null {
    return this.client?.getCommands() ?? null;
  }

  get mode(): "local" | "remote" {
    return this.getSettings().shell.mode;
  }

  /** Host listener URL/state for the connection-details surface. */
  get hostInfo(): { port: number; wsUrl: string } | null {
    return this.host ? { port: this.host.boundPort, wsUrl: this.host.wsUrl() } : null;
  }

  /** Whether this install serves the native vault tools (local host only). */
  get vaultToolsAvailable(): boolean {
    if (this.mode === "remote") return true; // provided by the host, not this device
    return !!this.host;
  }

  get vaultToolsError(): string | null {
    return null;
  }

  /** The next host-side Undo the UI may offer, if any (host only). */
  pendingUndo(): WriteSnapshot | null {
    return this.host?.lastSnapshot() ?? null;
  }

  async undoLastWrite(): Promise<WriteSnapshot | null> {
    const restored = (await this.host?.undoLast()) ?? null;
    this.emitState();
    return restored;
  }

  private emit(event: ChatEvent): void {
    for (const cb of [...this.eventListeners]) {
      try {
        cb(event);
      } catch {
        // View errors must not break the session record.
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

  private emitPermission(request: PendingPermission): void {
    for (const cb of [...this.permissionListeners]) {
      try {
        cb(request);
      } catch {
        // ignored
      }
    }
  }

  private vaultRoot(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("this vault has no filesystem path");
    return adapter.getBasePath();
  }

  /** Starts the host listener and the single harness attachment (local mode). */
  async startHost(): Promise<void> {
    if (this.host) return;
    if (!Platform.isDesktopApp) throw new Error("host mode is desktop-only");
    const settings = this.getSettings();
    const host = new HostCore({
      app: this.app,
      settings: () => settings,
      store: this.getStore,
      stopLegacy: async () => {
        if (this.legacyStopped) return;
        this.legacyStopped = true;
        await this.stopLegacy?.();
      },
      log: this.log,
    });
    await host.start();
    this.host = host;
    this.emitState();
  }

  /** Attaches the UI client: loopback WebSocket on the host, remote otherwise. */
  async connect(): Promise<void> {
    if (this.client && this.client.getState() === "connected") return;
    const shell = this.getSettings().shell;
    let connector: RemoteTransportConnector;
    let mode: "relay" | "remote";
    let cwd: string;
    if (shell.mode === "local") {
      if (!Platform.isDesktopApp) throw new Error("local attach requires the desktop app");
      if (!shell.command.trim()) throw new Error("no harness command is configured");
      await this.startHost();
      const host = this.host;
      if (!host) throw new Error("the host listener did not start");
      connector = new RemoteTransportConnector({ url: host.wsUrl(), token: host.localToken, attempts: 3, baseMs: 100 });
      mode = "relay";
      cwd = this.vaultRoot();
    } else {
      const url = shell.remoteUrl?.trim();
      const token = shell.remoteToken?.trim();
      if (!url) throw new Error("no host address is configured for remote attach");
      if (!token) throw new Error("no device code is configured for remote attach");
      connector = new RemoteTransportConnector({ url, token, attempts: 3, baseMs: 250 });
      mode = "remote";
      cwd = "/";
    }
    const client = new AcpShellClient({
      mode,
      label: shell.mode === "local" ? `host ${this.host?.wsUrl() ?? "loopback"}` : `remote ${shell.remoteUrl ?? ""}`,
      cwd,
      // The host serves the vault; a remote/loopback shell never does.
      environment: undefined,
      mcpServer: () => null,
      connector,
      // A remote opens/selections a stored session explicitly (session/list +
      // session/load); a local host view starts a fresh conversation.
      autoSession: shell.mode === "local",
      onLog: this.log,
      onTransportLost: (reason) => {
        this.log(`attach lost: ${reason}`);
        this.scheduleReconnect(reason);
      },
    });
    client.onEvent((event) => {
      if (event.raw?.seq !== undefined) {
        const highest = this.lastSeq.get(event.sessionId) ?? 0;
        if (event.raw.seq > highest) this.lastSeq.set(event.sessionId, event.raw.seq);
        if (!this.dedupe.accept(event.sessionId, event.raw.seq)) return;
      }
      this.emit(event);
    });
    client.onPermissionRequest((request) => this.emitPermission(request));
    client.onStateChange(() => this.emitState());
    this.client = client;
    this.closed = false;
    this.reconnectAttempts = 0;
    try {
      await client.connect();
    } catch (err) {
      this.client = null;
      this.emitState();
      throw err;
    }
    this.emitState();
  }

  async send(text: string, options: { images?: Array<{ mimeType: string; data: string }> } = {}): Promise<void> {
    if (!this.client) await this.connect();
    const client = this.client;
    if (!client) throw new Error("not connected");
    const blocks: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }> = [];
    if (text.trim()) blocks.push({ type: "text", text });
    for (const image of options.images ?? []) {
      blocks.push({ type: "image", mimeType: image.mimeType, data: image.data });
    }
    if (!blocks.length) throw new Error("the message is empty");
    const meta = this.continuityChoice
      ? { "obsidian-chat/continuity": this.continuityChoice }
      : undefined;
    await client.prompt(blocks as never, meta);
    this.continuityChoice = null;
  }

  async cancel(): Promise<void> {
    await this.client?.cancel();
  }

  async respondPermission(requestId: string, optionId: string | null): Promise<void> {
    await this.client?.respondPermission(requestId, optionId);
  }

  async setMode(modeId: string): Promise<void> {
    await this.client?.setMode(modeId);
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<void> {
    await this.client?.setConfigOption(configId, value);
  }

  /** Local host transcript from the record; a remote keeps no local history. */
  async history(): Promise<ShellHistory | null> {
    if (this.mode !== "local") return null;
    const id = this.client?.getSessionId();
    if (!id) return null;
    const read = await this.getStore().read(id);
    return { header: read.header, entries: read.entries };
  }

  /** Standard `session/list` over the attach (host-scoped on the host side). */
  async listSessions(): Promise<SessionListEntry[]> {
    if (!this.client) return [];
    const sessions = await this.client.listSessions();
    return sessions.map((session) => {
      const meta = (session._meta ?? {}) as Record<string, unknown>;
      return {
        sessionId: session.sessionId,
        title: session.title?.trim() || "Untitled conversation",
        updatedAt: session.updatedAt ?? "",
        resume: String(meta["obsidian-chat/resume"] ?? "unknown"),
        degraded: meta["obsidian-chat/degraded"] === true,
      };
    });
  }

  /** Loads a stored conversation through standard `session/load`; the host
   *  replays the record as `session/update` notifications before resolving and
   *  returns the continuity state used for the explicit digest/fresh choice. */
  async loadSession(sessionId: string): Promise<ContinuityInfo | null> {
    if (!this.client) await this.connect();
    const client = this.client;
    if (!client) throw new Error("not connected");
    // An explicit open always renders the stored transcript: clear replay
    // dedupe state first (reconnect replay is protected by `sinceSeq`).
    this.dedupe.reset();
    const response = await client.loadSession(sessionId, { cwd: this.mode === "local" ? this.vaultRoot() : "/" });
    this.continuityChoice = null;
    this.emitState();
    const meta = (response as { _meta?: Record<string, unknown> })._meta;
    if (!meta) return null;
    return {
      state: String(meta["obsidian-chat/resume"] ?? "unknown"),
      reason: typeof meta["obsidian-chat/reason"] === "string" ? meta["obsidian-chat/reason"] : undefined,
      warning: typeof meta["obsidian-chat/warning"] === "string" ? meta["obsidian-chat/warning"] : undefined,
      digestAvailable: meta["obsidian-chat/digest"] === true,
      attached: meta["obsidian-chat/attached"] === true,
      choices: Array.isArray(meta["obsidian-chat/continuity"]) ? (meta["obsidian-chat/continuity"] as string[]) : [],
    };
  }

  /** Bounded reconnect after transport loss (contracts/host-transport.md §5:
   *  1 s → 15 s, 8 attempts). Reattachment uses session/load with `sinceSeq`, so
   *  no already-rendered notification is duplicated and no prompt is resent. */
  private scheduleReconnect(reason: string): void {
    if (this.closed || !this.client) return;
    if (this.reconnectAttempts >= 8) {
      this.emit({
        sessionId: this.client.getSessionId() ?? "unknown",
        error: {
          message: `Could not reconnect to the host after 8 attempts (${reason}). The turn is interrupted; history is preserved.`,
          scope: "transport",
        },
      });
      return;
    }
    const delay = backoffDelay(this.reconnectAttempts);
    this.reconnectAttempts += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attemptReconnect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async attemptReconnect(): Promise<void> {
    const client = this.client;
    if (!client || this.closed) return;
    const sessionId = client.getSessionId();
    const sinceSeq = sessionId ? this.lastSeq.get(sessionId) : undefined;
    try {
      await client.reconnect({ sinceSeq });
      this.reconnectAttempts = 0;
      this.emitState();
    } catch (err) {
      this.emit({
        sessionId: sessionId ?? "unknown",
        error: {
          message: `Reconnect attempt ${this.reconnectAttempts}/8 failed: ${String((err as Error).message ?? err)}`,
          scope: "transport",
        },
      });
      this.scheduleReconnect("retry");
    }
  }

  /** Revoking a paired device closes its live sockets immediately (host only). */
  revokeDevice(deviceId: string): void {
    this.host?.revokeDevice(deviceId);
  }

  /** The user's explicit continuity choice for a detached conversation. No
   *  prompt is seeded until the user chooses (FR-060). */
  setContinuityChoice(choice: ContinuityChoice | null): void {
    this.continuityChoice = choice;
  }

  get pendingContinuityChoice(): ContinuityChoice | null {
    return this.continuityChoice;
  }

  /** Creates a new conversation on the current attach without leaving the
   *  host/harness (the old session is closed first). */
  async newSession(): Promise<void> {
    if (!this.client) await this.connect();
    const client = this.client;
    if (!client) throw new Error("not connected");
    const previous = client.getSessionId();
    if (previous) await client.closeSession(previous).catch(() => undefined);
    await client.createSession({ cwd: this.mode === "local" ? this.vaultRoot() : "/" });
    this.emitState();
  }

  /** Explicit New Session: end the ACP session, keep the host/harness alive. */
  async reset(): Promise<void> {
    this.continuityChoice = null;
    this.dedupe.reset();
    this.lastSeq.clear();
    const client = this.client;
    this.client = null;
    if (client) await client.close().catch(() => undefined);
    this.emitState();
  }

  /** Restarts the harness child (host only) and reattaches the UI. */
  async restartHarness(): Promise<void> {
    if (this.mode !== "local") throw new Error("only the host can restart the harness");
    await this.reset();
    await this.host?.stop().catch(() => undefined);
    this.host = null;
    await this.connect();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.client;
    this.client = null;
    if (client) await client.close().catch(() => undefined);
    await this.host?.stop().catch(() => undefined);
    this.host = null;
    this.emitState();
  }
}

export { redactLabel, fingerprint };

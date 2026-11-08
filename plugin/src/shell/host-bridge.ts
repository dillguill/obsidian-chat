/** Host-side ACP relay bridge (FR-005/FR-008/FR-011/FR-013/FR-014/FR-051/FR-060…FR-065).
 *
 *  The host is an ACP agent toward paired devices and an ACP client toward its
 *  single harness child. This bridge maps each device session onto a harness
 *  session, records everything in the host-owned JSONL store, forwards harness
 *  updates to the owning device with `_meta { "obsidian-chat/seq" }`, routes
 *  permission requests only to that device, and implements the mandatory
 *  continuity ladder (resume → load → explicit digest/fresh/full replay).
 */
import { cleanTitle } from "../session/title.ts";
import {
  RequestError,
  methods,
  type AgentCapabilities,
  type AgentContext,
  type CloseSessionRequest,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionInfo,
  type SessionModeState,
  type SessionNotification,
  type SessionUpdate,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import { cancelledPermission } from "../acp/permissions.ts";
import { CONTEXT_META_KEY } from "../acp/types.ts";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { sanitizeForRecord } from "../session/record.ts";
import { buildDigest, buildFullReplay, digestBlock } from "../session/digest.ts";
import type { NewEntry, SessionStore, SessionSummary } from "../session/store.ts";
import { continuityMeta, decideContinuity, isResumableState, type CurrentHarness, type ResumeDecision, type StoredContinuity, type ResumeRegistry } from "../session/resume.ts";
import type { RecordEntry, SessionHeader } from "../session/record.ts";
import type { AcpShellClient, McpServerEntry } from "./acp-client.ts";
import type { RelayBridge } from "./host-relay.ts";

export interface HostBridgeOptions {
  store: () => SessionStore;
  /** Lazily connects/spawns the single harness child (desktop only). */
  ensureHarness: () => Promise<AcpShellClient>;
  /** The connected harness client, when there is one. */
  harness: () => AcpShellClient | null;
  /** Absolute host vault root (the only cwd a host session gets). */
  vaultRoot: () => string;
  /** Redacted label, deterministic fingerprint, and the raw command. */
  command: () => { label: string; fingerprint: string; command: string };
  /** Vault MCP entry for the harness session (null when unavailable). */
  mcpEntry: () => McpServerEntry | null;
  /** Host continuity registry (optional in unit tests). */
  registry?: ResumeRegistry;
  log?: (message: string) => void;
}

interface HostSession {
  hostId: string;
  deviceId: string;
  harnessId: string;
  cwd: string;
  turn: number;
}

const POLICY_ERROR = -32003;
/** Bounded live replay window; a device further behind gets a full replay from
 *  the record instead of an unbounded stream (contracts/host-transport.md §5). */
import { REPLAY_MAX_ENTRIES, SESSION_SIZE_WARN_BYTES } from "../session/limits.ts";
export { REPLAY_MAX_ENTRIES };
const CONTINUITY_CHOICES = ["digest", "fresh", "full_replay"] as const;
type ContinuityChoice = (typeof CONTINUITY_CHOICES)[number];

export class HostBridge implements RelayBridge {
  private opts: HostBridgeOptions;
  private devices = new Map<string, AgentContext>();
  private sessions = new Map<string, HostSession>();
  private byHarness = new Map<string, HostSession>();
  private chains = new Map<string, Promise<unknown>>();
  private harnessClient: AcpShellClient | null = null;
  private registry: ResumeRegistry | null;
  /** Harness replay during reattach is not re-recorded/forwarded. */
  private suppressed = new Set<string>();
  private log: (message: string) => void;

  constructor(options: HostBridgeOptions) {
    this.opts = options;
    this.registry = options.registry ?? null;
    this.log = options.log ?? (() => undefined);
  }

  /** Wires the harness client's raw update/permission streams (once). */
  attachHarness(client: AcpShellClient): void {
    if (this.harnessClient === client) return;
    this.harnessClient = client;
    client.onRawUpdate((params, meta) => this.forwardUpdate(params, meta));
    client.onRawPermissionRequest((request, requestId) => this.forwardPermission(request, requestId));
    void this.reconcileRegistry();
  }

  private async reconcileRegistry(): Promise<void> {
    if (!this.registry) return;
    await this.registry.load();
    const records = await this.opts.store().list().catch((): SessionSummary[] => []);
    this.registry.reconcile(records);
    // Rows are `dead`/`detached` until a load actually reattaches them.
    for (const row of this.registry.all()) {
      if (row.state === "live") this.registry.mark(row.sessionId, "detached");
    }
    await this.registry.flush();
  }

  capabilities(): AgentCapabilities {
    return {
      loadSession: true,
      sessionCapabilities: { list: {}, close: {} } as never,
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    };
  }

  bindDevice(deviceId: string, context: AgentContext): void {
    this.devices.set(deviceId, context);
    this.log(`device attached: ${deviceId}`);
  }

  unbindDevice(deviceId: string): void {
    this.devices.delete(deviceId);
    for (const session of [...this.sessions.values()]) {
      if (session.deviceId !== deviceId) continue;
      this.harnessClient?.cancelParkedPermissions(session.harnessId);
      this.registry?.mark(session.hostId, "detached");
    }
    void this.registry?.flush();
    this.log(`device detached: ${deviceId}`);
  }

  async initialize(deviceId: string, _request: InitializeRequest): Promise<InitializeResponse> {
    void deviceId;
    return {
      protocolVersion: 1,
      agentInfo: { name: "obsidian-chat", version: "2.0.0" },
      agentCapabilities: this.capabilities(),
    };
  }

  async newSession(deviceId: string, request: NewSessionRequest): Promise<NewSessionResponse> {
    const harness = await this.opts.ensureHarness();
    this.attachHarness(harness);
    const cwd = this.opts.vaultRoot();
    const capabilities = harness.getCapabilitiesSnapshot();
    const entry = capabilities.mcpHttp ? this.opts.mcpEntry() : null;
    const created = await harness.createSession({
      cwd,
      mcpServers: entry ? [entry] : [],
      meta: (request as { _meta?: Record<string, unknown> })._meta,
    });
    const command = this.opts.command();
    const store = this.opts.store();
    const hostId = await store.createSession({
      deviceId,
      commandLabel: command.label,
      commandFingerprint: command.fingerprint,
      cwd,
      protocolVersion: 1,
      capabilities,
      harnessSessionId: created.sessionId,
      title: "ACP session",
    });
    const session: HostSession = { hostId, deviceId, harnessId: created.sessionId, cwd, turn: 0 };
    this.sessions.set(hostId, session);
    this.byHarness.set(created.sessionId, session);
    this.registry?.upsert(this.rowFor(hostId, session, "live"));
    void this.registry?.flush();
    this.log(`session ${hostId} created for device ${deviceId}`);
    return { sessionId: hostId, modes: created.modes ?? null, configOptions: created.configOptions ?? null };
  }

  async loadSession(deviceId: string, request: LoadSessionRequest): Promise<LoadSessionResponse> {
    const live = this.sessions.get(request.sessionId);
    let read;
    if (live) {
      if (live.deviceId !== deviceId) throw new RequestError(POLICY_ERROR, "policy: session is not owned by this device");
      read = await this.opts.store().read(live.hostId);
    } else {
      read = await this.opts.store().read(request.sessionId);
      if (read.header.deviceId !== deviceId) throw new RequestError(POLICY_ERROR, "policy: session is not owned by this device");
    }
    const header = read.header;
    let decision = this.decideFor(header, read.entries);
    const since = this.sinceSeq(request);
    let attached = !!live;
    let modes: SessionModeState | null = live && this.harnessClient?.hasSession(live.harnessId) ? this.harnessClient.getSessionModes(live.harnessId) : null;
    let configOptions: SessionConfigOption[] | null = live && this.harnessClient?.hasSession(live.harnessId) ? this.harnessClient.getSessionConfigOptions(live.harnessId) : null;

    if (!live && isResumableState(decision.state)) {
      try {
        const restored = await this.reattach(header, decision.action === "resume" ? "resume" : "load");
        attached = true;
        modes = restored.modes ?? null;
        configOptions = restored.configOptions ?? null;
        decision = { ...decision, state: decision.action === "resume" ? "resume-capable" : "load-only" };
      } catch (err) {
        decision = {
          state: "digest-only",
          action: "digest",
          reason: "reattach_failed",
          warning: errorText(err),
          digestAvailable: decision.digestAvailable,
        };
        await this.appendResume(header.sessionId, {
          method: decision.action === "resume" ? "resume" : "load",
          result: "failed",
          reason: errorText(err),
          harnessSessionId: header.harnessSessionId,
          fingerprint: header.harness.commandFingerprint,
          cwd: header.harness.cwd,
        });
      }
    }

    const session: HostSession = live ?? {
      hostId: request.sessionId,
      deviceId,
      harnessId: header.harnessSessionId ?? "",
      cwd: header.harness.cwd || this.opts.vaultRoot(),
      turn: this.lastTurnOf(read.entries),
    };
    const context = this.devices.get(deviceId);
    if (context) {
      const pending = read.entries.filter((entry) => entry.seq > since);
      const bounded = pending.length > REPLAY_MAX_ENTRIES ? pending.slice(-REPLAY_MAX_ENTRIES) : pending;
      if (pending.length > REPLAY_MAX_ENTRIES) {
        await context.notify(methods.client.session.update, {
          sessionId: session.hostId,
          update: {
            sessionUpdate: "obsidian_chat_replay_truncated",
            skipped: pending.length - REPLAY_MAX_ENTRIES,
          } as unknown as SessionUpdate,
          _meta: { "obsidian-chat/replay": true },
        });
      }
      for (const entry of bounded) await this.replayEntry(context, session, entry);
    }
    return {
      modes,
      configOptions,
      _meta: {
        ...continuityMeta(decision),
        "obsidian-chat/continuity": CONTINUITY_CHOICES as unknown as string[],
        "obsidian-chat/attached": attached,
      },
    } as LoadSessionResponse;
  }

  async resumeSession(_deviceId: string, _request: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    throw new RequestError(-32601, "session/resume is not available to paired devices; use session/load");
  }

  async listSessions(deviceId: string): Promise<ListSessionsResponse> {
    const sessions = await this.opts.store().list();
    const info: SessionInfo[] = sessions
      // Opened-but-unused chats (no prompt) are not worth listing.
      .filter((summary) => summary.header.deviceId === deviceId && !summary.empty)
      .map((summary) => this.sessionInfo(summary));
    return { sessions: info };
  }

  async prompt(deviceId: string, request: PromptRequest): Promise<PromptResponse> {
    const live = this.sessions.get(request.sessionId);
    if (live) {
      if (live.deviceId !== deviceId) throw new RequestError(POLICY_ERROR, "policy: session is not owned by this device");
      return this.promptLive(live, request);
    }
    return this.promptWithContinuity(deviceId, request);
  }

  private async promptLive(session: HostSession, request: PromptRequest): Promise<PromptResponse> {
    const harness = await this.opts.ensureHarness();
    this.attachHarness(harness);
    return this.runPrompt(session, harness, request.prompt);
  }

  /** A detached conversation continues only via an explicit continuity choice:
   *  digest (default), fresh, or full replay. The host then creates a new
   *  harness session on the SAME conversation record. */
  private async promptWithContinuity(deviceId: string, request: PromptRequest): Promise<PromptResponse> {
    const read = await this.opts.store().read(request.sessionId);
    if (read.header.deviceId !== deviceId) throw new RequestError(POLICY_ERROR, "policy: session is not owned by this device");
    const header = read.header;
    const decision = this.decideFor(header, read.entries);
    const choice = this.choiceOf(request);
    if (!choice) {
      throw new RequestError(
        -32602,
        `continuity choice required (${decision.state}): choose ${CONTINUITY_CHOICES.join(", ")} before continuing this conversation`,
      );
    }
    if ((choice === "digest" || choice === "full_replay") && !decision.digestAvailable) {
      throw new RequestError(-32602, "this conversation has no transcript to seed from; choose fresh");
    }
    const harness = await this.opts.ensureHarness();
    this.attachHarness(harness);
    const cwd = header.harness.cwd || this.opts.vaultRoot();
    const capabilities = harness.getCapabilitiesSnapshot();
    const entry = capabilities.mcpHttp ? this.opts.mcpEntry() : null;
    const created = await harness.createSession({ cwd, mcpServers: entry ? [entry] : [] });
    const session: HostSession = {
      hostId: header.sessionId,
      deviceId,
      harnessId: created.sessionId,
      cwd,
      turn: this.lastTurnOf(read.entries),
    };
    this.sessions.set(session.hostId, session);
    this.byHarness.set(session.harnessId, session);
    this.registry?.upsert(this.rowFor(session.hostId, session, "live"));
    void this.registry?.flush();
    const seeded: ContentBlock[] = [...request.prompt];
    if (choice === "digest") {
      const digest = buildDigest({ header, entries: read.entries });
      seeded.unshift(digestBlock(digest.text));
      await this.appendResume(header.sessionId, {
        method: "digest",
        result: "chosen",
        harnessSessionId: created.sessionId,
        fingerprint: header.harness.commandFingerprint,
        cwd,
        digest: { turnsIncluded: digest.turnsIncluded, turnsOmitted: digest.turnsOmitted, chars: digest.chars, hash: digest.hash },
      });
    } else if (choice === "full_replay") {
      const replay = buildFullReplay({ header, entries: read.entries });
      seeded.unshift(digestBlock(replay.text));
      await this.appendResume(header.sessionId, {
        method: "full_replay",
        result: "chosen",
        harnessSessionId: created.sessionId,
        fingerprint: header.harness.commandFingerprint,
        cwd,
        digest: { turnsIncluded: replay.turnsIncluded, turnsOmitted: 0, chars: replay.chars, hash: replay.hash },
      });
    } else {
      await this.appendResume(header.sessionId, {
        method: "fresh",
        result: "chosen",
        harnessSessionId: created.sessionId,
        fingerprint: header.harness.commandFingerprint,
        cwd,
      });
    }
    return this.runPrompt(session, harness, seeded, request.prompt);
  }

  private async runPrompt(
    session: HostSession,
    harness: AcpShellClient,
    blocks: ContentBlock[],
    recordBlocks: ContentBlock[] = blocks,
  ): Promise<PromptResponse> {
    session.turn += 1;
    const turn = session.turn;
    await this.record(session.hostId, {
      kind: "prompt",
      turn,
      blocks: sanitizeForRecord(recordBlocks),
      textChars: JSON.stringify(recordBlocks).length,
    });
    try {
      const stopReason = await harness.promptIn(session.harnessId, blocks);
      await this.record(session.hostId, {
        kind: "turn",
        turn,
        stopReason,
        interrupted: stopReason === undefined || undefined,
      });
      return { stopReason: stopReason as PromptResponse["stopReason"] };
    } catch (err) {
      await this.record(session.hostId, {
        kind: "turn",
        turn,
        interrupted: true,
        errorCategory: errorText(err),
      });
      throw err;
    }
  }

  /** Extension `_obsidian-chat/session/rename`: a user-chosen name, stored as
   *  a `meta` entry (source "user") and echoed as `session_info_update`. */
  async renameSession(deviceId: string, request: { sessionId: string; title: string }): Promise<{ title: string }> {
    const title = cleanTitle(String(request?.title ?? ""));
    if (!title) throw new RequestError(-32602, "title must not be empty");
    const store = this.opts.store();
    const live = this.sessions.get(request.sessionId);
    const owner = live ? live.deviceId : (await store.read(request.sessionId)).header.deviceId;
    if (owner !== deviceId) throw new RequestError(POLICY_ERROR, "policy: session is not owned by this device");
    await store.setTitle(request.sessionId, title, "user");
    const context = this.devices.get(deviceId);
    await context
      ?.notify(methods.client.session.update, {
        sessionId: request.sessionId,
        update: { sessionUpdate: "session_info_update", title } as SessionUpdate,
      })
      .catch(() => undefined);
    return { title };
  }

  async cancel(deviceId: string, request: { sessionId: string }): Promise<void> {
    const session = this.sessionFor(deviceId, request.sessionId);
    await this.opts.harness()?.cancelIn(session.harnessId);
  }

  async closeSession(deviceId: string, request: CloseSessionRequest): Promise<void> {
    const session = this.sessionFor(deviceId, request.sessionId);
    this.sessions.delete(session.hostId);
    this.byHarness.delete(session.harnessId);
    this.registry?.mark(session.hostId, "detached");
    void this.registry?.flush();
    await this.opts.harness()?.closeSession(session.harnessId).catch(() => undefined);
  }

  async setMode(deviceId: string, request: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    const session = this.sessionFor(deviceId, request.sessionId);
    const harness = await this.opts.ensureHarness();
    await harness.setModeIn(session.harnessId, request.modeId);
    return {} as SetSessionModeResponse;
  }

  async setConfigOption(deviceId: string, request: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
    const session = this.sessionFor(deviceId, request.sessionId);
    const harness = await this.opts.ensureHarness();
    const value = (request as { value?: string | boolean }).value;
    if (value === undefined) throw new RequestError(-32602, "set_config_option requires a value");
    await harness.setConfigOptionIn(session.harnessId, request.configId, value);
    return { configOptions: harness.getSessionConfigOptions(session.harnessId) ?? [] } as SetSessionConfigOptionResponse;
  }

  private sessionFor(deviceId: string, hostId: string): HostSession {
    const session = this.sessions.get(hostId);
    if (!session || session.deviceId !== deviceId) throw new RequestError(POLICY_ERROR, "policy: session is not owned by this device");
    return session;
  }

  private decideFor(header: SessionHeader, entries: RecordEntry[]): ResumeDecision {
    const stored: StoredContinuity = {
      harnessSessionId: header.harnessSessionId,
      cwd: header.harness.cwd,
      commandFingerprint: header.harness.commandFingerprint,
      protocolVersion: header.harness.protocolVersion,
      agentName: header.harness.agentName,
      agentVersion: header.harness.agentVersion,
    };
    const hasContent = entries.some((entry) => entry.kind === "prompt");
    return decideContinuity(
      stored,
      this.currentHarness(),
      { readable: true, hasContent, imported: header.origin === "legacy_import" },
    );
  }

  private currentHarness(): CurrentHarness | null {
    const harness = this.opts.harness();
    const command = this.opts.command();
    if (!harness) {
      return {
        command: command.command,
        cwd: this.opts.vaultRoot(),
        protocolVersion: 1,
        resume: false,
        loadSession: false,
      };
    }
    const caps = harness.getCapabilitiesSnapshot();
    return {
      command: command.command,
      cwd: this.opts.vaultRoot(),
      protocolVersion: 1,
      resume: caps.resume,
      loadSession: caps.loadSession,
    };
  }

  private async reattach(header: SessionHeader, method: "resume" | "load") {
    const harness = await this.opts.ensureHarness();
    const harnessId = header.harnessSessionId;
    if (!harnessId) throw new Error("session has no harness session id");
    const capabilities = harness.getCapabilitiesSnapshot();
    const mcp = capabilities.mcpHttp ? this.opts.mcpEntry() : null;
    this.suppressed.add(harnessId);
    try {
      const restored = await harness.attachSession(harnessId, {
        method,
        cwd: header.harness.cwd || this.opts.vaultRoot(),
        mcpServers: mcp ? [mcp] : [],
      });
      const session: HostSession = {
        hostId: header.sessionId,
        deviceId: header.deviceId,
        harnessId,
        cwd: header.harness.cwd || this.opts.vaultRoot(),
        turn: 0,
      };
      this.sessions.set(session.hostId, session);
      this.byHarness.set(harnessId, session);
      this.registry?.upsert(this.rowFor(session.hostId, session, "live"));
      void this.registry?.flush();
      await this.appendResume(header.sessionId, {
        method,
        result: "success",
        harnessSessionId: harnessId,
        fingerprint: header.harness.commandFingerprint,
        cwd: header.harness.cwd,
      });
      return restored;
    } finally {
      this.suppressed.delete(harnessId);
    }
  }

  private choiceOf(request: PromptRequest): ContinuityChoice | null {
    const meta = (request as { _meta?: Record<string, unknown> })._meta;
    const value = meta?.["obsidian-chat/continuity"];
    return value === "digest" || value === "fresh" || value === "full_replay" ? value : null;
  }

  private lastTurnOf(entries: RecordEntry[]): number {
    let max = 0;
    for (const entry of entries) if (typeof entry.turn === "number") max = Math.max(max, entry.turn);
    return max;
  }

  private rowFor(sessionId: string, session: HostSession, state: "live" | "detached" | "dead") {
    const header = { commandFingerprint: this.opts.command().fingerprint };
    return {
      sessionId,
      harnessSessionId: session.harnessId,
      deviceId: session.deviceId,
      cwd: session.cwd,
      commandFingerprint: header.commandFingerprint,
      protocolVersion: 1,
      lastSeq: this.registry?.get(sessionId)?.lastSeq ?? 0,
      state,
      lastSeen: Date.now(),
    };
  }

  private async appendResume(hostId: string, entry: {
    method: "resume" | "load" | "digest" | "fresh" | "full_replay";
    result: "success" | "failed" | "chosen" | "skipped";
    reason?: string;
    harnessSessionId?: string | null;
    fingerprint?: string;
    cwd?: string;
    digest?: { turnsIncluded: number; turnsOmitted: number; chars: number; hash: string };
  }): Promise<void> {
    await this.record(hostId, { kind: "resume", ...entry });
  }

  private sessionInfo(summary: SessionSummary): SessionInfo {
    const header = summary.header;
    const decision = this.decideFor(header, header.lastSeq > 0 ? [{ kind: "prompt" } as RecordEntry] : []);
    return {
      sessionId: header.sessionId,
      cwd: header.harness.cwd || this.opts.vaultRoot(),
      title: header.title ?? null,
      updatedAt: new Date(header.updatedAt).toISOString(),
      _meta: {
        "obsidian-chat/resume": decision.state,
        "obsidian-chat/warning": decision.warning,
        "obsidian-chat/degraded": summary.degraded,
        "obsidian-chat/size": summary.bytes,
        "obsidian-chat/large": summary.bytes >= SESSION_SIZE_WARN_BYTES,
      },
    };
  }

  private sinceSeq(request: LoadSessionRequest): number {
    const meta = (request as { _meta?: Record<string, unknown> })._meta;
    const value = meta?.["obsidian-chat/sinceSeq"];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private forwardUpdate(params: SessionNotification, meta: { late: boolean; turn?: number }): void {
    if (this.suppressed.has(params.sessionId)) return;
    const session = this.byHarness.get(params.sessionId);
    if (!session) return;
    const kind = (params.update as { sessionUpdate?: string }).sessionUpdate ?? "unknown";
    const turn = meta.turn ?? session.turn;
    void this.enqueue(session.hostId, async () => {
      const entry = await this.opts.store().append(session.hostId, {
        kind: "update",
        turn,
        sessionUpdate: kind,
        payload: sanitizeForRecord(params.update),
        late: meta.late || undefined,
      });
      this.registry?.touch(session.hostId, entry.seq);
      const context = this.devices.get(session.deviceId);
      if (context) {
        await context.notify(methods.client.session.update, {
          sessionId: session.hostId,
          update: params.update,
          _meta: { "obsidian-chat/seq": entry.seq },
        });
      }
    }).catch((err) => this.reportStoreFailure(session, err));
  }

  private async reportStoreFailure(session: HostSession, err: unknown): Promise<void> {
    const message = `session record write failed: ${errorText(err)}`;
    this.log(`${session.hostId}: ${message}`);
    const context = this.devices.get(session.deviceId);
    if (!context) return;
    await context
      .notify(methods.client.session.update, {
        sessionId: session.hostId,
        update: { sessionUpdate: "obsidian_chat_store_error", message } as unknown as SessionUpdate,
      })
      .catch(() => undefined);
  }

  private forwardPermission(
    request: { sessionId: string; toolCall: unknown; options: unknown[] },
    requestId: string,
  ): boolean {
    const session = this.byHarness.get(request.sessionId);
    if (!session) return false;
    const harness = this.opts.harness();
    if (!harness) return false;
    const context = this.devices.get(session.deviceId);
    void (async () => {
      await this.record(session.hostId, {
        kind: "permission_request",
        turn: Math.max(1, session.turn),
        requestId,
        toolCall: request.toolCall,
        options: request.options,
      });
      if (!context) {
        await this.record(session.hostId, {
          kind: "permission_response",
          requestId,
          outcome: { outcome: "cancelled" },
          reason: "device disconnected",
        });
        harness.respondPermissionRaw(requestId, cancelledPermission());
        return;
      }
      try {
        const response = await context.request(methods.client.session.requestPermission, {
          sessionId: session.hostId,
          toolCall: request.toolCall,
          options: request.options,
        } as never);
        await this.record(session.hostId, {
          kind: "permission_response",
          requestId,
          outcome:
            response.outcome.outcome === "selected"
              ? { outcome: "selected", optionId: response.outcome.optionId }
              : { outcome: "cancelled" },
        });
        harness.respondPermissionRaw(requestId, response);
      } catch (err) {
        await this.record(session.hostId, {
          kind: "permission_response",
          requestId,
          outcome: { outcome: "cancelled" },
          reason: errorText(err),
        });
        harness.respondPermissionRaw(requestId, cancelledPermission());
      }
    })().catch((err) => this.log(`permission relay failed: ${errorText(err)}`));
    return true;
  }

  private async replayEntry(context: AgentContext, session: HostSession, entry: RecordEntry): Promise<void> {
    const meta = { "obsidian-chat/seq": entry.seq, "obsidian-chat/replay": true };
    if (entry.kind === "prompt") {
      const text = promptText(entry.blocks);
      if (!text) return;
      await context.notify(methods.client.session.update, {
        sessionId: session.hostId,
        update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } } as SessionUpdate,
        _meta: meta,
      });
      return;
    }
    if (entry.kind === "update") {
      const update = replayUpdate(entry.payload);
      if (!update) return;
      await context.notify(methods.client.session.update, {
        sessionId: session.hostId,
        update,
        _meta: meta,
      });
      return;
    }
    if (entry.kind === "meta" && entry.title) {
      await context.notify(methods.client.session.update, {
        sessionId: session.hostId,
        update: { sessionUpdate: "session_info_update", title: entry.title } as SessionUpdate,
        _meta: meta,
      });
      return;
    }
    if (entry.kind === "resume") {
      await context.notify(methods.client.session.update, {
        sessionId: session.hostId,
        update: { sessionUpdate: "obsidian_chat_continuity", ...entry } as unknown as SessionUpdate,
        _meta: meta,
      });
      return;
    }
    if (entry.kind === "error") {
      await context.notify(methods.client.session.update, {
        sessionId: session.hostId,
        update: { sessionUpdate: "error", ...entry } as unknown as SessionUpdate,
        _meta: meta,
      });
    }
  }

  private record(hostId: string, entry: NewEntry): Promise<unknown> {
    return this.enqueue(hostId, () => this.opts.store().append(hostId, entry));
  }

  private enqueue(hostId: string, run: () => Promise<unknown>): Promise<unknown> {
    const prev = this.chains.get(hostId) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.chains.set(hostId, next.catch(() => undefined));
    return next;
  }
}

function promptText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    const value = block as { type?: string; text?: string; _meta?: Record<string, unknown> };
    // Attached context blocks are not what the user typed; replay shows the prompt.
    if (value?._meta?.[CONTEXT_META_KEY] !== undefined) continue;
    if (value?.type === "text" && typeof value.text === "string") parts.push(value.text);
  }
  return parts.join("\n");
}

function replayUpdate(payload: unknown): SessionUpdate | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.sessionUpdate === "string") return payload as SessionUpdate;
  const type = raw.type;
  if (type === "message") {
    const role = raw.role === "user" ? "user_message_chunk" : "agent_message_chunk";
    return { sessionUpdate: role, content: { type: "text", text: String(raw.text ?? "") } } as SessionUpdate;
  }
  if (type === "thought") {
    return { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: String(raw.text ?? "") } } as SessionUpdate;
  }
  if (type === "tool_call") {
    const tool = (raw.toolCall ?? {}) as Record<string, unknown>;
    return {
      sessionUpdate: "tool_call",
      toolCallId: String(tool.toolCallId ?? ""),
      title: tool.title,
      kind: tool.kind,
      status: tool.status,
    } as unknown as SessionUpdate;
  }
  if (type === "raw") return (raw.payload as SessionUpdate) ?? null;
  return null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

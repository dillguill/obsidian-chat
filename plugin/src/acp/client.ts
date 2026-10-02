/** ACP bridge client (specs/001-acp-mcp-migration, contracts/plugin-bridge-acp.md).
 *
 *  The plugin is an ACP client only (Constitution Technology Constraints):
 *  it starts sessions, sends prompts, streams `session/update`, and cancels
 *  — it never knows which harness or model provider is behind the bridge
 *  (Principle II).
 *
 *  Transport: the bridge's own HTTP/SSE binding (`contracts/plugin-bridge-acp.md`),
 *  not the ACP SDK's still-experimental Streamable HTTP transport
 *  (research.md R2) — a webview client speaking this JSON directly is
 *  simpler than adapting the SDK's byte-stream transport primitives into
 *  `fetch`/SSE. Method names and payload shapes mirror real ACP
 *  (`session/new`, `session/prompt`, `session/update`, `session/cancel`,
 *  `session/request_permission`) using the SDK's own generated types.
 *
 *  Reconnect/replay follows the same proven pattern as the old
 *  `GatewaySession` (SSE `Last-Event-ID`), which the bridge's
 *  sequence-numbered replay buffer satisfies directly (FR-005).
 */
import { Platform, requestUrl } from "obsidian";
import type { IncomingMessage } from "http";
import type {
  AvailableCommand,
  ContentBlock,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate,
  ToolCallContent,
} from "@agentclientprotocol/sdk";
import type { StreamEvent } from "../chat/types";
import { pickTarget, sanitizeToolInput } from "../chat/tool-input";

export interface AcpBridgeConfig {
  baseUrl: string; // e.g. https://100.x.y.z:8765 (a Tailscale IP)
  token: string;
}

export interface PendingPermissionRequest {
  requestId: string;
  request: RequestPermissionRequest;
}

const MAX_RETRIES = 8;

/** Thrown for connectivity/availability failures so callers can render a
 *  distinct error state instead of hanging indefinitely (FR-012). */
export class AcpUnavailableError extends Error {}

export class AcpBridgeClient {
  private sessionId: string | null = null;
  private lastEventId = 0;
  private sseFail = 0;
  private closed = false;
  private listeners = new Set<(e: StreamEvent) => void>();
  private permissionListeners = new Set<(p: PendingPermissionRequest) => void>();
  /** Fired whenever modes/configOptions/availableCommands change — either
   *  from `connect()`'s initial response or a live `session/update`
   *  (specs/002-acp-only-chat-ux, User Story 3/5). The plugin re-reads
   *  current state via the getters below rather than the callback carrying
   *  a payload, since all three can change independently. */
  private stateListeners = new Set<() => void>();
  private modes: SessionModeState | undefined;
  private configOptions: SessionConfigOption[] | undefined;
  private commands: AvailableCommand[] | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Replay (FR-005) re-delivers every buffered event on reconnect, including
   *  already-surfaced permission requests (data-model.md Approval Request) —
   *  dedup so a still-pending one isn't re-shown as a duplicate modal. */
  private seenPermissionRequests = new Set<string>();
  /** Reachability of the bridge/harness for the status surface (W7.10). */
  private connection: "idle" | "connecting" | "connected" | "unreachable" = "idle";
  /** Last transport error, surfaced by `getDebugInfo()` (W7.10). */
  private lastError: string | null = null;
  /** Harness-supplied session title (W7.11) — `null` until one arrives
   *  (`session_info_update`; opencode does not emit it today). */
  private sessionTitle: string | null = null;

  constructor(private cfg: AcpBridgeConfig) {}

  onEvent(cb: (e: StreamEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Fired when the harness (via the bridge) asks for approval of a proposed
   *  vault write — the plugin-side counterpart of ACP's
   *  `session/request_permission` (data-model.md Approval Request). */
  onPermissionRequest(cb: (p: PendingPermissionRequest) => void): () => void {
    this.permissionListeners.add(cb);
    return () => this.permissionListeners.delete(cb);
  }

  private emit(e: StreamEvent) {
    for (const cb of this.listeners) cb(e);
  }

  /** Subscribe to mode/config-option/available-command changes. Returns an
   *  unsubscribe function, matching `onEvent`/`onPermissionRequest`. */
  onStateChange(cb: () => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  private emitStateChange() {
    for (const cb of this.stateListeners) cb();
  }

  /** Identifies the current session so callers can tell a reconnect (a dead
   *  session replaced by a new one on the same client instance, e.g. after a
   *  bridge restart) from a no-op connect() on an already-live session. */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Harness-declared agent modes (specs/002-acp-only-chat-ux R5) — `undefined`
   *  until the harness declares any, per FR-008 (no plugin-owned fallback). */
  getModes(): SessionModeState | undefined {
    return this.modes;
  }

  /** Harness-declared session config options (model/thinking-level/etc.,
   *  specs/002-acp-only-chat-ux R6) — `undefined` until the harness declares any. */
  getConfigOptions(): SessionConfigOption[] | undefined {
    return this.configOptions;
  }

  /** Harness-declared "/" commands (specs/002-acp-only-chat-ux R7). */
  getCommands(): AvailableCommand[] | undefined {
    return this.commands;
  }

  /** Bridge/harness reachability for the status banner (W7.10). */
  getConnectionState(): "idle" | "connecting" | "connected" | "unreachable" {
    return this.connection;
  }

  /** Harness-supplied session title, when one has arrived (W7.11). */
  getSessionTitle(): string | null {
    return this.sessionTitle;
  }

  /** Everything the connection-info modal renders (W7.10). */
  getDebugInfo(): {
    baseUrl: string;
    connected: boolean;
    sessionId: string | null;
    lastEventId: number;
    retries: number;
    lastError: string | null;
  } {
    return {
      baseUrl: this.base(),
      connected: this.connection === "connected",
      sessionId: this.sessionId,
      lastEventId: this.lastEventId,
      retries: this.sseFail,
      lastError: this.lastError,
    };
  }

  private setConnection(state: "idle" | "connecting" | "connected" | "unreachable", error?: string): void {
    const changed = this.connection !== state || (error !== undefined && error !== this.lastError);
    this.connection = state;
    if (error !== undefined) this.lastError = error;
    else if (state === "connected") this.lastError = null;
    if (changed) this.emitStateChange();
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "content-type": "application/json", authorization: `Bearer ${this.cfg.token}`, ...extra };
  }

  private base() {
    return this.cfg.baseUrl.replace(/\/$/, "");
  }

  /** Every call except the SSE event stream goes through Obsidian's
   *  `requestUrl()` rather than `fetch()` — it's exempt from CORS by platform
   *  design ("Similar to fetch(), request a URL... without any CORS
   *  restrictions", obsidian.d.ts), whereas plain `fetch()` from the plugin
   *  webview to a cross-origin bridge (local or remote) is subject to normal
   *  browser CORS/preflight rules. Only the event stream needs a real,
   *  live-incremental `fetch()` reader, since `requestUrl` just buffers a
   *  complete response — see `openEvents()`. */
  private async call(path: string, method: string, body?: unknown): Promise<{ status: number; json: () => any }> {
    let resp: Awaited<ReturnType<typeof requestUrl>>;
    try {
      resp = await requestUrl({
        url: `${this.base()}${path}`,
        method,
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        throw: false,
      });
    } catch (err) {
      const message = String((err as Error).message ?? err);
      this.setConnection("unreachable", `bridge unreachable: ${message}`);
      throw new AcpUnavailableError(`bridge unreachable: ${message}`);
    }
    if (this.connection !== "connected") this.setConnection("connected");
    return {
      status: resp.status,
      json: () => {
        try {
          return resp.json;
        } catch {
          return {};
        }
      },
    };
  }

  /** session/new — starts a session against whatever harness is configured
   *  on the host (FR-001). Retries while the harness is still
   *  starting up so a cold start (plugin loaded before the hosted
   *  bridge has finished spawning) doesn't leave configOptions
   *  empty — see chat-view.ts onOpen. */
  async connect(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    this.setConnection("connecting");
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
      try {
        const resp = await this.call("/sessions", "POST", {});
        if (resp.status === 503) {
          lastErr = new AcpUnavailableError("harness unavailable on the host");
          continue; // bridge is up but harness not ready yet
        }
        if (resp.status >= 400) throw new Error(`session/new failed: HTTP ${resp.status}`);
        const j = resp.json();
        if (!j.sessionId) throw new Error(`bad session/new response: ${JSON.stringify(j)}`);
        this.sessionId = j.sessionId;
        this.modes = j.modes ?? undefined;
        this.configOptions = j.configOptions ?? undefined;
        this.lastEventId = 0;
        this.sseFail = 0;
        this.closed = false;
        this.openEvents();
        this.setConnection("connected");
        return this.sessionId!;
      } catch (err) {
        if (err instanceof AcpUnavailableError) {
          lastErr = err;
          continue; // bridge not listening yet — retry
        }
        throw err; // real error, don't retry
      }
    }
    this.setConnection("unreachable", lastErr?.message ?? "harness unavailable on the host");
    throw lastErr ?? new AcpUnavailableError("harness unavailable on the host");
  }

  private scheduleReconnect() {
    if (this.closed || this.sessionId === null) return;
    if (this.sseFail >= MAX_RETRIES) {
      this.setConnection("unreachable", `gave up after ${this.sseFail} reconnects`);
      this.emit({ type: "error", message: `gave up after ${this.sseFail} reconnects — start a new session` });
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.sseFail - 1), 15000);
    this.retryTimer = setTimeout(() => this.openEvents(), delay);
  }

  /** GET /sessions/:id/events — SSE, replaying from `lastEventId` on
   *  reconnect so no `session/update` content is duplicated or lost
   *  (FR-005).
   *
   *  Desktop uses Node's `http`/`https` directly rather than the page's
   *  `fetch()`: Obsidian's desktop renderer runs plugin code with full Node
   *  integration, and this one endpoint's `fetch()` was failing ("Failed to
   *  fetch") independent of headers/method/CORS handling there — consistent
   *  with the desktop renderer's CSP blocking the connection at the
   *  page-networking layer, which `requestUrl()` and raw Node sockets both
   *  bypass. Mobile has no Node integration at all (`require('http')` is not
   *  available in Obsidian's mobile runtime), so it has no choice but
   *  `fetch()` there — and mobile's WebView doesn't share desktop's CSP
   *  restriction on this connection, so it works. */
  private openEvents() {
    if (this.closed || !this.sessionId) return;
    if (Platform.isMobileApp) this.openEventsFetch();
    else this.openEventsNode();
  }

  private openEventsNode() {
    if (this.closed || !this.sessionId) return;
    // Lazily required (not a top-level import): a top-level `require("http")`
    // would execute the instant this module loads, on every platform,
    // including mobile where the module doesn't exist.
    const http = require("http") as typeof import("http");
    const https = require("https") as typeof import("https");
    const url = new URL(`${this.base()}/sessions/${this.sessionId}/events`);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      url,
      {
        method: "GET",
        headers: this.headers({ "last-event-id": String(this.lastEventId) }),
      },
      (res) => {
        if (res.statusCode === 404) {
          this.emit({ type: "error", message: "session is dead (404) — start a new session" });
          this.sessionId = null;
          res.resume();
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          this.sseFail++;
          this.emit({ type: "error", message: `SSE HTTP ${res.statusCode}` });
          this.scheduleReconnect();
          return;
        }
        this.readNodeStream(res);
      },
    );
    req.on("error", (err: Error) => {
      this.sseFail++;
      this.emit({ type: "error", message: `bridge unreachable: ${String(err.message ?? err)}` }); // FR-012
      this.scheduleReconnect();
    });
    req.end();
  }

  private openEventsFetch() {
    if (this.closed || !this.sessionId) return;
    fetch(`${this.base()}/sessions/${this.sessionId}/events`, {
      headers: this.headers({ "last-event-id": String(this.lastEventId) }),
    })
      .then((resp) => {
        if (resp.status === 404) {
          this.emit({ type: "error", message: "session is dead (404) — start a new session" });
          this.sessionId = null;
          return;
        }
        if (!resp.ok || !resp.body) throw new Error(`SSE HTTP ${resp.status}`);
        this.readFetchStream(resp.body.getReader());
      })
      .catch((err) => {
        this.sseFail++;
        this.emit({ type: "error", message: `bridge unreachable: ${String((err as Error).message ?? err)}` }); // FR-012
        this.scheduleReconnect();
      });
  }

  private async readFetchStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) > -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          this.parseBlock(block);
        }
      }
    } catch {
      /* read error — falls through to reconnect below */
    }
    this.sseFail++;
    this.scheduleReconnect();
  }

  private readNodeStream(res: IncomingMessage) {
    const decoder = new TextDecoder();
    let buf = "";
    res.on("data", (chunk: Buffer) => {
      buf += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) > -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        this.parseBlock(block);
      }
    });
    const onEnd = () => {
      this.sseFail++;
      this.scheduleReconnect();
    };
    res.on("end", onEnd);
    res.on("error", onEnd);
  }

  private parseBlock(block: string) {
    let id = 0;
    let evName = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) id = Number(line.slice(4));
      else if (line.startsWith("event: ")) evName = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (id) this.lastEventId = id;
    this.dispatch(evName, data);
  }

  private dispatch(evName: string, data: string) {
    let parsed: any;
    try {
      parsed = data ? JSON.parse(data) : {};
    } catch {
      parsed = {};
    }
    if (evName === "session_update") {
      const update = parsed as SessionUpdate;
      // Mode/config-option/command updates aren't chat content — they update
      // local state and notify via onStateChange instead of the StreamEvent
      // stream (specs/002-acp-only-chat-ux R5/R6/R7). The bridge relays these
      // over the same generic session_update event as everything else; only
      // handling them was missing on this end.
      if (update.sessionUpdate === "current_mode_update") {
        if (this.modes) this.modes = { ...this.modes, currentModeId: (update as any).currentModeId };
        this.emitStateChange();
        return;
      }
      if (update.sessionUpdate === "config_option_update") {
        this.configOptions = (update as any).configOptions;
        this.emitStateChange();
        return;
      }
      if (update.sessionUpdate === "available_commands_update") {
        this.commands = (update as any).availableCommands;
        this.emitStateChange();
        return;
      }
      if (update.sessionUpdate === "session_info_update") {
        // Title/timestamps are session metadata, not chat content, but they do
        // get a StreamEvent so the view can refresh its session label (W7.11).
        const title = (update as any).title ?? null;
        if (title !== this.sessionTitle) {
          this.sessionTitle = title;
          this.emitStateChange();
        }
        this.emit({ type: "session_info", title, updatedAt: (update as any).updatedAt ?? null });
        return;
      }
      const event = mapSessionUpdate(update);
      if (event) this.emit(event);
      return;
    }
    if (evName === "permission_request") {
      const { requestId, ...request } = parsed;
      if (this.seenPermissionRequests.has(requestId)) return; // already surfaced — replay dedup
      this.seenPermissionRequests.add(requestId);
      for (const cb of this.permissionListeners) cb({ requestId, request: request as RequestPermissionRequest });
      return;
    }
    // unrecognized event kinds are ignored, matching the old gateway's behavior for log/ready/etc.
  }

  /** session/prompt — sends the latest user turn. ACP sessions are stateful
   *  on the harness side, so (unlike the old gateway) this does not resend
   *  the full conversation history — only the new content blocks for this
   *  turn (e.g. user text plus any `@mention`-attached note context). */
  async prompt(blocks: ContentBlock[]): Promise<void> {
    if (!this.sessionId) throw new Error("no session — connect() first");
    const resp = await this.call(`/sessions/${this.sessionId}/prompt`, "POST", { prompt: blocks });
    if (resp.status === 503) throw new AcpUnavailableError("harness unavailable on the host");
    if (resp.status >= 400) throw new Error(`session/prompt failed: HTTP ${resp.status}`);
    // The response body (PromptResponse.stopReason) resolves the turn; the
    // streamed content already arrived via session/update over SSE.
    this.emit({ type: "done" });
  }

  /** session/cancel */
  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    await this.call(`/sessions/${this.sessionId}/cancel`, "POST").catch(() => null);
  }

  /** Resolve a pending `session/request_permission` (Approval Request). */
  async respondPermission(requestId: string, optionId: string): Promise<void> {
    await this.call(`/approvals/${requestId}`, "POST", { optionId }).catch(() => null);
  }

  /** session/set_mode — switch the harness-declared agent mode
   *  (specs/002-acp-only-chat-ux R5). */
  async setMode(modeId: string): Promise<void> {
    if (!this.sessionId) return;
    const resp = await this.call(`/sessions/${this.sessionId}/mode`, "POST", { modeId }).catch(() => null);
    if (resp && resp.status < 400 && this.modes) {
      this.modes = { ...this.modes, currentModeId: modeId };
      this.emitStateChange();
    }
  }

  /** session/set_config_option — switch a harness-declared config option
   *  (e.g. thinking level, specs/002-acp-only-chat-ux R6). */
  async setConfigOption(optionId: string, value: string | boolean): Promise<void> {
    if (!this.sessionId) return;
    const resp = await this.call(`/sessions/${this.sessionId}/config-option`, "POST", { optionId, value }).catch(() => null);
    if (!resp || resp.status >= 400) return;
    const j = resp.json();
    if (j?.configOptions) {
      this.configOptions = j.configOptions;
      this.emitStateChange();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.sessionId) {
      await this.call(`/sessions/${this.sessionId}`, "DELETE").catch(() => null);
      this.sessionId = null;
    }
  }
}

/** Maps an ACP `SessionUpdate` onto the plugin's `StreamEvent` union
 *  (chat/types.ts). Returns `null` for update kinds with no chat-stream
 *  representation — the caller drops those rather than having them coerced
 *  into an existing event type, which previously fabricated a bogus empty
 *  "reasoning" burst for every unhandled kind. (`current_mode_update`,
 *  `config_option_update`, `available_commands_update` and
 *  `session_info_update` are handled in `dispatch()` — they update local state
 *  rather than producing chat content.) */
function mapSessionUpdate(update: SessionUpdate): StreamEvent | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return { type: "token", text: textOf((update as any).content) };
    case "agent_thought_chunk":
      return { type: "reasoning", text: textOf((update as any).content) };
    case "tool_call":
    case "tool_call_update": {
      const tc: any = update;
      const content = tc.content as ToolCallContent[] | undefined;
      const input = sanitizeToolInput(tc.rawInput);
      return {
        type: "tool_call",
        toolCallId: tc.toolCallId,
        // `title` carries the raw tool name (`vault_vault_read`) and is absent
        // from `completed` updates — the UI keeps the last-seen value. (P0 probe.)
        name: tc.title ?? tc.name ?? undefined,
        // Always "other" for MCP tools on opencode — a fallback only.
        kind: tc.kind ?? undefined,
        rawInput: input,
        // `locations` is always empty on opencode; rawInput is the real source.
        target: pickTarget(input, tc.locations),
        // Reads return a ~20 KB JSON blob as a Content variant, so only
        // diff-shaped payloads are parsed into lines (rows need just the stat).
        contentLines: hasDiffContent(content) ? toolCallContentLines(content, tc.status) : undefined,
        status: tc.status ?? "pending",
      };
    }
    case "plan":
    case "plan_update":
      // opencode does not emit plan updates today (P0 probe) — this stays
      // correct for harnesses that do.
      return { type: "plan", entries: (update as any).entries ?? [] };
    case "usage_update":
      return {
        type: "usage",
        used: (update as any).used ?? 0,
        size: (update as any).size ?? 0,
        cost: (update as any).cost ?? undefined,
      };
    default:
      return null;
  }
}

/** True when an ACP tool-content array contains a real diff — the only shape
 *  worth parsing into lines. Reads carry a large JSON blob as Content instead,
 *  and parsing that would retain ~20 KB per call for nothing. */
function hasDiffContent(content?: ToolCallContent[] | null): boolean {
  return !!content?.some((c) => (c as { type?: string })?.type === "diff");
}

function textOf(content: ContentBlock | undefined): string {
  if (!content) return "";
  if (content.type === "text") return content.text;
  return "";
}

/** Parses a `permission_request`'s `toolCall.content` (real ACP `ToolCallContent`
 *  variants — Diff/Content/Terminal, specs/002-acp-only-chat-ux R3) into
 *  displayable diff lines, instead of dumping raw JSON. Returns `undefined`
 *  when there's nothing displayable.
 *
 *  `status` gates the (expensive, O(n·m)) LCS diff: a `tool_call` streams
 *  several `tool_call_update`s for the same call as it progresses, each
 *  carrying the full current diff, so recomputing on every intermediate
 *  update would re-diff the same large text repeatedly. Only the terminal
 *  `completed`/`failed` update is worth the full diff; earlier ones get a
 *  cheap placeholder. */
export function toolCallContentLines(
  content: ToolCallContent[] | undefined | null,
  status?: string,
): string[] | undefined {
  if (!content?.length) return undefined;
  const out: string[] = [];
  for (const c of content) {
    if (c.type === "diff") {
      if (status === "completed" || status === "failed") {
        out.push(...textDiff(c.oldText ?? "", c.newText));
      } else {
        out.push("… editing …");
      }
    } else if (c.type === "content") {
      const text = textOf(c.content);
      if (text) out.push(...text.split("\n"));
    } else if (c.type === "terminal") {
      out.push(`[terminal output: ${c.terminalId}]`);
    }
  }
  return out.length ? out : undefined;
}

/** Minimal LCS-based line diff (added: +, removed: -, unchanged: two spaces). */
function textDiff(oldText: string, newText: string): string[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push("  " + a[i]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push("- " + a[i]); i++;
    } else {
      out.push("+ " + b[j]); j++;
    }
  }
  while (i < n) out.push("- " + a[i++]);
  while (j < m) out.push("+ " + b[j++]);
  return out.length > 60 ? [...out.slice(0, 30), `… ${out.length - 60} more lines`, ...out.slice(out.length - 30)] : out;
}

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
import type { ContentBlock, RequestPermissionRequest, SessionUpdate } from "@agentclientprotocol/sdk";
import type { StreamEvent } from "../chat/types";

export interface AcpBridgeConfig {
  baseUrl: string; // e.g. https://100.x.y.z:8765
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
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Replay (FR-005) re-delivers every buffered event on reconnect, including
   *  already-surfaced permission requests (data-model.md Approval Request) —
   *  dedup so a still-pending one isn't re-shown as a duplicate modal. */
  private seenPermissionRequests = new Set<string>();

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

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "content-type": "application/json", authorization: `Bearer ${this.cfg.token}`, ...extra };
  }

  private base() {
    return this.cfg.baseUrl.replace(/\/$/, "");
  }

  /** session/new — starts a session against whatever harness is configured
   *  on the host (FR-001). Idempotent for the lifetime of this client. */
  async connect(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    let resp: Response;
    try {
      resp = await fetch(`${this.base()}/sessions`, { method: "POST", headers: this.headers(), body: "{}" });
    } catch (err) {
      throw new AcpUnavailableError(`bridge unreachable: ${String((err as Error).message ?? err)}`);
    }
    if (resp.status === 503) throw new AcpUnavailableError("harness unavailable on the host");
    if (!resp.ok) throw new Error(`session/new failed: HTTP ${resp.status}`);
    const j = await resp.json();
    if (!j.sessionId) throw new Error(`bad session/new response: ${JSON.stringify(j)}`);
    this.sessionId = j.sessionId;
    this.lastEventId = 0;
    this.sseFail = 0;
    this.closed = false;
    this.openEvents();
    return this.sessionId!;
  }

  private scheduleReconnect() {
    if (this.closed || this.sessionId === null) return;
    if (this.sseFail >= MAX_RETRIES) {
      this.emit({ type: "error", message: `gave up after ${this.sseFail} reconnects — start a new session` });
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.sseFail - 1), 15000);
    this.retryTimer = setTimeout(() => this.openEvents(), delay);
  }

  /** GET /sessions/:id/events — SSE, replaying from `lastEventId` on
   *  reconnect so no `session/update` content is duplicated or lost
   *  (FR-005). */
  private openEvents() {
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
        this.readLoop(resp.body.getReader());
      })
      .catch((err) => {
        this.sseFail++;
        this.emit({ type: "error", message: `bridge unreachable: ${String((err as Error).message ?? err)}` }); // FR-012
        this.scheduleReconnect();
      });
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>) {
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
    if (evName === "session_update") return this.emit(mapSessionUpdate(parsed as SessionUpdate));
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
    let resp: Response;
    try {
      resp = await fetch(`${this.base()}/sessions/${this.sessionId}/prompt`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ prompt: blocks }),
      });
    } catch (err) {
      throw new AcpUnavailableError(`bridge unreachable: ${String((err as Error).message ?? err)}`);
    }
    if (resp.status === 503) throw new AcpUnavailableError("harness unavailable on the host");
    if (!resp.ok) throw new Error(`session/prompt failed: HTTP ${resp.status}`);
    // The response body (PromptResponse.stopReason) resolves the turn; the
    // streamed content already arrived via session/update over SSE.
    await resp.json().catch(() => ({}));
    this.emit({ type: "done" });
  }

  /** session/cancel */
  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(`${this.base()}/sessions/${this.sessionId}/cancel`, { method: "POST", headers: this.headers() }).catch(() => {});
  }

  /** Resolve a pending `session/request_permission` (Approval Request). */
  async respondPermission(requestId: string, optionId: string): Promise<void> {
    await fetch(`${this.base()}/approvals/${requestId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ optionId }),
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.sessionId) {
      await fetch(`${this.base()}/sessions/${this.sessionId}`, { method: "DELETE", headers: this.headers() }).catch(() => {});
      this.sessionId = null;
    }
  }
}

/** Maps an ACP `SessionUpdate` onto the plugin's existing `StreamEvent`
 *  union (chat/types.ts) so `ChatView.handleStreamEvent` needs no changes. */
function mapSessionUpdate(update: SessionUpdate): StreamEvent {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return { type: "token", text: textOf((update as any).content) };
    case "agent_thought_chunk":
      return { type: "reasoning", text: textOf((update as any).content) };
    case "tool_call":
    case "tool_call_update": {
      const tc: any = update;
      return { type: "tool_call", name: tc.title ?? tc.kind ?? "tool", args: JSON.stringify(tc.content ?? {}) };
    }
    case "plan":
    case "plan_update":
      return { type: "tool_call", name: "plan", args: JSON.stringify((update as any).entries ?? {}) };
    default:
      return { type: "reasoning", text: "" };
  }
}

function textOf(content: ContentBlock | undefined): string {
  if (!content) return "";
  if (content.type === "text") return content.text;
  return "";
}

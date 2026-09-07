/** Harness gateway client (PLAN §2.4).
 *  Reuses the Phase 0 G3/G4-proofed transport:
 *    - POST /sessions  -> spawn ephemeral worker, returns { sessionId }
 *    - GET  /sessions/:id/events -> SSE stream with last-event-id replay
 *    - POST /sessions/:id/input  -> forward a user turn
 *    - DELETE /sessions/:id      -> kill worker
 *  Reconnect strategy (from spike v6): exponential backoff,
 *  give up after 8 retries, stop on 404 (dead session). */
import type { ChatMessage, StreamEvent } from "./types";

export interface GatewayConfig {
  baseUrl: string; // e.g. https://100.x.y.z:8765
  token: string;
  model?: string;
}

const MAX_RETRIES = 8;

export class GatewaySession {
  private sessionId: string | null = null;
  private lastEventId = 0;
  private sseFail = 0;
  private closed = false;
  private listeners = new Set<(e: StreamEvent) => void>();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private cfg: GatewayConfig) {}

  /** Subscribe to streamed events (token/reasoning/tool_call/done/error). */
  onEvent(cb: (e: StreamEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: StreamEvent) {
    for (const cb of this.listeners) cb(e);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.cfg.token}`,
      ...extra,
    };
  }

  private base() {
    return this.cfg.baseUrl.replace(/\/$/, "");
  }

  /** Spawn a session and start listening. */
  async connect(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const resp = await fetch(`${this.base()}/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.cfg.model ?? "echo" }),
    });
    if (!resp.ok) throw new Error(`start session failed: HTTP ${resp.status}`);
    const j = await resp.json();
    if (!j.sessionId) throw new Error(`bad session response: ${JSON.stringify(j)}`);
    this.sessionId = j.sessionId;
    this.lastEventId = 0;
    this.sseFail = 0;
    this.closed = false;
    this.open();
    return this.sessionId!;
  }

  private scheduleReconnect() {
    if (this.closed || this.sessionId === null) return;
    if (this.sseFail >= MAX_RETRIES) {
      this.emit({ type: "error", message: `gave up after ${this.sseFail} reconnects — start a new session` });
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.sseFail - 1), 15000);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private open() {
    if (this.closed || !this.sessionId) return;
    const url = `${this.base()}/sessions/${this.sessionId}/events`;
    fetch(url, {
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
        this.emit({ type: "error", message: `stream error: ${err.message}` }); // informational
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
      /* read error */
    }
    // Stream closed: about to reconnect.
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
      parsed = { text: data };
    }
    switch (evName) {
      case "token":
        this.emit({ type: "token", text: parsed.text ?? "" });
        break;
      case "reasoning":
        this.emit({ type: "reasoning", text: parsed.text ?? "" });
        break;
      case "tool_call":
        this.emit({ type: "tool_call", name: parsed.name ?? "tool", args: parsed.args ?? "" });
        break;
      case "tool_result":
        this.emit({ type: "tool_call", name: parsed.name ?? "tool", args: parsed.result ?? "" });
        break;
      case "turn_end":
      case "done":
        this.emit({ type: "done", finishReason: parsed.finishReason ?? parsed.ok ? "stop" : "stop" });
        break;
      case "exit":
        this.emit({ type: "done", finishReason: "exit" });
        break;
      default:
        // log / stderr / ready -> ignore for the chat surface
        break;
    }
  }

  /** Send a user turn. */
  async send(text: string): Promise<void> {
    if (!this.sessionId) throw new Error("no session — connect() first");
    const resp = await fetch(`${this.base()}/sessions/${this.sessionId}/input`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ type: "user_message", text }),
    });
    if (!resp.ok) throw new Error(`send failed: HTTP ${resp.status}`);
  }

  /** Send a grounded completion (system + history + optional user turn) to the
   *  relay worker. The harness worker streams tokens back over the SSE stream. */
  async sendCompletion(messages: ChatMessage[], model: string): Promise<void> {
    if (!this.sessionId) throw new Error("no session — connect() first");
    const resp = await fetch(`${this.base()}/sessions/${this.sessionId}/input`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ type: "completion", messages, model }),
    });
    if (!resp.ok) throw new Error(`send completion failed: HTTP ${resp.status}`);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.reader) await this.reader.cancel().catch(() => {});
    if (this.sessionId) {
      await fetch(`${this.base()}/sessions/${this.sessionId}`, {
        method: "DELETE",
        headers: this.headers(),
      }).catch(() => {});
      this.sessionId = null;
    }
  }
}

/** Remote ACP transport: WebSocket client for a paired device (FR-009/FR-012).
 *
 *  Uses the ACP SDK's `createWebSocketStream` (one JSON-RPC message per text
 *  frame) and never spawns, listens, or touches the host filesystem. The
 *  per-device token travels as `?token=` because WebSocket constructors cannot
 *  set request headers; it is never logged.
 *
 *  Obsidian-free: the desktop/WebView `WebSocket` is preferred, with a lazy
 *  `ws` fallback for Node (tests) and older Electron versions.
 */
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import type { Stream } from "@agentclientprotocol/sdk";
import { backoffDelay, type ShellTransport, type TransportConnector } from "./transport.ts";

export interface RemoteTransportOptions {
  /** Connection timeout for the WebSocket handshake (ms). */
  timeoutMs?: number;
  /** Injectable constructor (tests / explicit ws). */
  WebSocketImpl?: WebSocketCtor;
}

interface WebSocketLike {
  readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
  on?(type: string, listener: (...args: unknown[]) => void): unknown;
  off?(type: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(type: string, listener: (...args: unknown[]) => void): unknown;
}

export type WebSocketCtor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocketLike;

import { RECONNECT_ATTEMPTS } from "../session/limits.ts";
export { RECONNECT_ATTEMPTS };

const DEFAULT_TIMEOUT_MS = 8_000;

function listen(socket: WebSocketLike, type: string, listener: (...args: unknown[]) => void): () => void {
  if (typeof socket.addEventListener === "function") {
    const wrapped = (event: unknown) => listener(event);
    socket.addEventListener(type, wrapped);
    return () => socket.removeEventListener?.(type, wrapped);
  }
  if (typeof socket.on === "function") {
    socket.on(type, listener);
    return () => {
      const off = socket.off ?? socket.removeListener;
      off?.call(socket, type, listener);
    };
  }
  return () => undefined;
}

/** True when the handshake was rejected with 401/403 (never retried). */
export function isAuthRejection(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error);
  return /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(text);
}

/** Adds the bearer token to a ws:// or wss:// URL (http/https normalized,
 *  bare host:port defaults to /acp). */
export function remoteUrlWithToken(rawUrl: string, token: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error("no host address is configured");
  const normalized = trimmed.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`invalid host address: ${trimmed}`);
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`host address must be ws:// or wss://, got ${url.protocol}`);
  }
  // The host serves ACP only at /acp; a bare "ws://host:port" means that.
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/acp";
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

/** Picks the platform WebSocket. Node (tests, Electron) uses the bundled `ws`
 *  so handshake failures carry the HTTP status; mobile uses the platform
 *  WebSocket. */
async function resolveWebSocket(explicit?: WebSocketCtor): Promise<WebSocketCtor> {
  if (explicit) return explicit;
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  if (isNode) {
    try {
      const ws = (await import("ws")) as { WebSocket?: WebSocketCtor; default?: WebSocketCtor };
      const ctor = ws.WebSocket ?? ws.default;
      if (ctor) return ctor;
    } catch {
      // fall through to the platform implementation
    }
  }
  const globalCtor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (typeof globalCtor === "function") return globalCtor;
  throw new Error("no WebSocket implementation is available");
}

export class RemoteTransport implements ShellTransport {
  readonly label: string;
  readonly stream: Stream;
  private socket: WebSocketLike;
  private callbacks = new Set<(reason: string) => void>();
  private closed = false;

  private constructor(label: string, socket: WebSocketLike, stream: Stream) {
    this.label = label;
    this.socket = socket;
    this.stream = stream;
    listen(socket, "close", (...args) => {
      if (this.closed) return;
      const code = typeof args[0] === "number" ? args[0] : undefined;
      const reason = typeof args[1] === "string" ? args[1] : undefined;
      this.notify(`host connection closed${code ? ` (${code})` : ""}${reason ? `: ${reason}` : ""}`);
    });
    listen(socket, "error", (event) => {
      if (this.closed) return;
      const message = (event as { message?: string })?.message;
      this.notify(message ? `host connection error: ${message}` : "host connection error");
    });
  }

  private notify(reason: string): void {
    for (const cb of [...this.callbacks]) cb(reason);
  }

  static async connect(rawUrl: string, token: string, options: RemoteTransportOptions = {}): Promise<RemoteTransport> {
    const url = remoteUrlWithToken(rawUrl, token);
    const Ctor = await resolveWebSocket(options.WebSocketImpl);
    let socket: WebSocketLike | null = null;
    // Capture the instance the SDK's transport constructs so we can attach
    // lifecycle listeners and close it deterministically.
    class Tracked extends Ctor {
      constructor(...args: ConstructorParameters<WebSocketCtor>) {
        super(...args);
        socket = this as unknown as WebSocketLike;
      }
    }
    const stream = createWebSocketStream(url, { WebSocket: Tracked as never });
    if (!socket) throw new Error("could not create the host WebSocket");
    await waitForOpen(socket, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let label = "remote";
    try {
      const parsed = new URL(url);
      label = `remote ${parsed.host}${parsed.pathname}`;
    } catch {
      // label stays generic
    }
    return new RemoteTransport(label, socket, stream);
  }

  onClose(cb: (reason: string) => void): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close(1000, "client closed");
    } catch {
      // already closed
    }
  }
}

function waitForOpen(socket: WebSocketLike, timeoutMs: number): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const cleanup = () => {
      offOpen();
      offError();
      offClose();
      clearTimeout(timer);
    };
    const offOpen = listen(socket, "open", () => finish());
    const offError = listen(socket, "error", (event) => {
      const message = (event as { message?: string; error?: { message?: string } })?.message ?? (event as { error?: { message?: string } })?.error?.message;
      finish(new Error(message ? `host connection failed: ${message}` : "host connection failed"));
    });
    const offClose = listen(socket, "close", (...args) => {
      const code = typeof args[0] === "number" ? args[0] : undefined;
      finish(new Error(`host connection closed before it opened${code ? ` (${code})` : ""}`));
    });
    const timer = setTimeout(() => finish(new Error("host connection timed out")), timeoutMs);
  });
}

/** Reconnects with bounded backoff; auth rejections are never retried. */
export class RemoteTransportConnector implements TransportConnector {
  private options: {
    url: string;
    token: string;
    attempts?: number;
    baseMs?: number;
    timeoutMs?: number;
    WebSocketImpl?: WebSocketCtor;
  };

  constructor(options: {
    url: string;
    token: string;
    attempts?: number;
    baseMs?: number;
    timeoutMs?: number;
    WebSocketImpl?: WebSocketCtor;
  }) {
    this.options = options;
  }

  async connect(): Promise<ShellTransport> {
    const attempts = Math.max(1, this.options.attempts ?? 3);
    const baseMs = this.options.baseMs ?? 250;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await RemoteTransport.connect(this.options.url, this.options.token, {
          timeoutMs: this.options.timeoutMs,
          WebSocketImpl: this.options.WebSocketImpl,
        });
      } catch (err) {
        lastError = err;
        if (isAuthRejection(err)) throw err;
        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt, baseMs, 2_000)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/** Deduper for ACP `_meta { "obsidian-chat/seq" }` notifications (FR-014/015).
 *  A replayed sequence is rendered once; live sequences are monotonic. */
export class SeqDedupe {
  private seen = new Map<string, Set<number>>();

  /** Returns false when this (session, seq) has already been rendered. */
  accept(sessionId: string, seq: number | undefined): boolean {
    if (typeof seq !== "number" || !Number.isFinite(seq)) return true;
    let set = this.seen.get(sessionId);
    if (!set) {
      set = new Set();
      this.seen.set(sessionId, set);
    }
    if (set.has(seq)) return false;
    set.add(seq);
    return true;
  }

  reset(sessionId?: string): void {
    if (sessionId) this.seen.delete(sessionId);
    else this.seen.clear();
  }
}

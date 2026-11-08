/** The host's single network listener (FR-006/FR-008).
 *
 *  Desktop-only module (loaded lazily by the plugin when host mode is enabled):
 *  one `http.createServer` carrying the paired-device ACP WebSocket endpoint at
 *  `/acp` and the loopback-only MCP endpoint at `/mcp`. No other port/server.
 */
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { WebSocket, WebSocketServer as WebSocketServerType } from "ws";
import { DeviceRegistry, tokenFromUrl } from "./device-auth.ts";
import type { VaultMcpServer } from "../vault/mcp-server.ts";

export interface HostServerOptions {
  port: number;
  /** Bind address; defaults to loopback. A wider bind needs explicit user consent. */
  host?: string;
  devices: () => Record<string, string>;
  localToken: string;
  /** Handles `/mcp`; returns true when it wrote a response. */
  mcpHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** Called for an authenticated `/acp` WebSocket; the relay attaches ACP. */
  onAcpConnection?: (socket: WebSocket, deviceId: string) => void;
  /** Heartbeat interval (contract §5: ping every 15 s, close after two missed
   *  pongs). Overridable for tests. */
  heartbeatMs?: number;
  /** Missed pongs tolerated before the socket is terminated (default 2). */
  missedPongLimit?: number;
  log?: (message: string) => void;
}

const MAX_MCP_BODY = 1024 * 1024;

/** Node built-ins and `ws` load lazily so the mobile bundle never evaluates
 *  them and `node --test` (ESM) can still supply them. */
async function loadNodeModule<T>(id: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ id)) as T;
  } catch {
    const req = (globalThis as { require?: (moduleId: string) => unknown }).require;
    if (typeof req === "function") return req(id) as T;
    throw new Error(`host mode requires the desktop app (could not load ${id})`);
  }
}

/** Loopback check for `/mcp` (contract `vault-mcp.md` §2). */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** MCP Streamable-HTTP transport in its stateless JSON-response form: one
 *  JSON-RPC message per POST, loopback + per-session bearer token required. */
export function createVaultMcpHandler(options: {
  server: VaultMcpServer;
  token: () => string | null;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const reply = (res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", "mcp-protocol-version": "2025-06-18", ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  return async (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      reply(res, 401, { error: "loopback only" });
      return;
    }
    if (req.method !== "POST") {
      reply(res, 405, { error: "method not allowed" }, { allow: "POST" });
      return;
    }
    if (!options.server.authorize(req.headers.authorization)) {
      reply(res, 401, { error: "unauthorized" });
      return;
    }
    const raw = await readBody(req).catch(() => null);
    if (raw === null) {
      reply(res, 413, { error: "request body too large or unreadable" });
      return;
    }
    let body: unknown;
    try {
      body = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      reply(res, 200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    const result = await options.server.handle(body);
    if (result === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    reply(res, 200, result);
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MCP_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export class HostServer {
  private options: HostServerOptions;
  private registry: DeviceRegistry;
  private server: Server | null = null;
  private wss: WebSocketServerType | null = null;
  private sockets = new Map<WebSocket, { deviceId: string; alive: boolean; missed: number }>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(options: HostServerOptions) {
    this.options = options;
    this.registry = new DeviceRegistry({ devices: options.devices, localToken: options.localToken });
  }

  get port(): number {
    return this.options.port;
  }

  /** The port actually bound (useful when the caller asked for 0). */
  get boundPort(): number {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : this.options.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const { createServer } = await loadNodeModule<typeof import("node:http")>("node:http");
    // Literal specifier: `ws` is bundled, and esbuild defers the bundled module
    // (plus its Node requires) until this desktop-gated call runs.
    const { WebSocketServer } = await import("ws");
    const server = createServer((req, res) => void this.routeHttp(req, res));
    const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
    server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head, wss));
    await this.bindListener(server, this.options.port, this.options.host ?? "127.0.0.1");
    this.server = server;
    this.wss = wss;
    this.startHeartbeat();
    this.options.log?.(`host listener on ${this.options.host ?? "127.0.0.1"}:${this.options.port}`);
  }

  /** Binds the listener, retrying briefly if the legacy host is still
   *  releasing the same port during the US1→US3 handoff. */
  private async bindListener(server: Server, port: number, host: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: NodeJS.ErrnoException) => {
            server.off("listening", onListening);
            reject(err);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(port, host);
        });
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EADDRINUSE" || attempt >= 2) throw err;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    const interval = this.options.heartbeatMs ?? 15_000;
    const limit = this.options.missedPongLimit ?? 2;
    this.heartbeat = setInterval(() => {
      for (const [ws, state] of [...this.sockets]) {
        if (!state.alive) {
          state.missed += 1;
          if (state.missed >= limit) {
            this.options.log?.(`closing unresponsive socket for device ${state.deviceId}`);
            this.sockets.delete(ws);
            try {
              ws.terminate();
            } catch {
              // already gone
            }
            continue;
          }
        }
        state.alive = false;
        try {
          ws.ping();
        } catch {
          // The close handler will clean up.
        }
      }
    }, interval);
    this.heartbeat.unref?.();
  }

  /** Test/teardown hook: runs one heartbeat pass immediately. */
  heartbeatOnce(): void {
    for (const [ws, state] of [...this.sockets]) {
      if (!state.alive) {
        state.missed += 1;
        if (state.missed >= (this.options.missedPongLimit ?? 2)) {
          this.sockets.delete(ws);
          try {
            ws.terminate();
          } catch {
            // already gone
          }
          continue;
        }
      }
      state.alive = false;
      try {
        ws.ping();
      } catch {
        // close handler cleans up
      }
    }
  }

  get localToken(): string {
    return this.options.localToken;
  }

  private async routeHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type, mcp-protocol-version, mcp-session-id");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://host").pathname;
    if (path === "/mcp") {
      await this.options.mcpHandler(req, res).catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }

  private handleUpgrade(
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
    wss: WebSocketServerType,
  ): void {
    const path = new URL(req.url ?? "/", "http://host").pathname;
    if (path !== "/acp") {
      socket.destroy();
      return;
    }
    const deviceId = this.registry.deviceForToken(tokenFromUrl(req.url));
    if (!deviceId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const handler = this.options.onAcpConnection;
      if (!handler) {
        ws.close(1011, "host relay is not enabled");
        return;
      }
      this.sockets.set(ws, { deviceId, alive: true, missed: 0 });
      ws.on("pong", () => {
        const state = this.sockets.get(ws);
        if (state) {
          state.alive = true;
          state.missed = 0;
        }
      });
      ws.on("close", () => this.sockets.delete(ws));
      handler(ws, deviceId);
    });
  }

  /** Closes only a revoked device's live sockets (FR-017). */
  closeDevice(deviceId: string): void {
    for (const [ws, state] of [...this.sockets]) {
      if (state.deviceId !== deviceId) continue;
      this.sockets.delete(ws);
      try {
        ws.close(1008, "device revoked");
      } catch {
        // already gone
      }
    }
  }

  async close(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const ws of [...this.sockets.keys()]) ws.close(1001, "host stopping");
    this.sockets.clear();
    this.wss?.close();
    this.wss = null;
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

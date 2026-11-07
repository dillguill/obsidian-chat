/** The host's single network listener (FR-006/FR-008).
 *
 *  Desktop-only module (loaded lazily by the plugin when host mode is enabled):
 *  one `http.createServer` carrying the paired-device ACP WebSocket endpoint at
 *  `/acp` and the loopback-only MCP endpoint at `/mcp`. No other port/server.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { DeviceRegistry, tokenFromUrl } from "./device-auth.ts";

export interface HostServerOptions {
  port: number;
  /** Bind address; defaults to loopback. A wider bind needs explicit user consent. */
  host?: string;
  devices: () => Record<string, string>;
  localToken: string;
  /** Handles `/mcp`; returns true when it wrote a response. */
  mcpHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** Called for an authenticated `/acp` WebSocket; the relay attaches ACP. */
  onAcpConnection: (socket: WebSocket, deviceId: string) => void;
  log?: (message: string) => void;
}

export class HostServer {
  private options: HostServerOptions;
  private registry: DeviceRegistry;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private sockets = new Set<WebSocket>();

  constructor(options: HostServerOptions) {
    this.options = options;
    this.registry = new DeviceRegistry({ devices: options.devices, localToken: options.localToken });
  }

  get port(): number {
    return this.options.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.routeHttp(req, res));
    const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
    server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head, wss));
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once("error", onError);
      server.listen(this.options.port, this.options.host ?? "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    });
    this.server = server;
    this.wss = wss;
    this.options.log?.(`host listener on ${this.options.host ?? "127.0.0.1"}:${this.options.port}`);
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
    wss: WebSocketServer,
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
      this.sockets.add(ws);
      ws.on("close", () => this.sockets.delete(ws));
      this.options.onAcpConnection(ws, deviceId);
    });
  }

  /** Closes a revoked device's live sockets (FR-017). */
  closeDevice(deviceId: string): void {
    // Sockets are tracked with their device id via a weak map in the relay;
    // callers may prefer to close all and let reconnects re-authenticate.
    void deviceId;
    for (const ws of [...this.sockets]) ws.close(1008, "device revoked");
    this.sockets.clear();
  }

  async close(): Promise<void> {
    for (const ws of [...this.sockets]) ws.close(1001, "host stopping");
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

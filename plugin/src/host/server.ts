/** Host mode: the always-on Obsidian desktop app *is* the server.
 *
 *  One HTTP listener, owned by the plugin, does what the separate
 *  `acp-bridge.mjs` + `mcp-rules-proxy.mjs` processes (and the Local REST API
 *  plugin) used to:
 *
 *  - spawns the configured ACP harness as a child process and speaks ACP to it
 *    over stdio (harness-agnostic: the command is a setting, never a branch);
 *  - fronts it over HTTP/SSE for every chat client — this device, other
 *    desktops, phones (contracts/plugin-bridge-acp.md, plus `turn_end`);
 *  - serves the vault's MCP tools at `/mcp`, loopback-only, which the harness
 *    attaches to through ACP's own `session/new` `mcpServers` field.
 *
 *  Desktop only. Node built-ins are required lazily so this module is inert
 *  when bundled into the mobile build. */
import type { App } from "obsidian";
import type { IncomingMessage, ServerResponse, Server } from "http";
import type { ChildProcess } from "child_process";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { JsonRpcPeer } from "./jsonrpc";
import { VaultMcpServer } from "./vault-mcp";

export interface HostOptions {
  app: App;
  /** Harness command line, e.g. `opencode acp`. */
  command: string;
  port: number;
  /** Working directory for the harness — the vault's folder on disk. */
  cwd: string;
  /** deviceName → bearer token. */
  devices: () => Record<string, string>;
  blacklist: () => string[];
  log: (msg: string) => void;
}

type SessionState = {
  deviceId: string;
  seq: number;
  buffer: { seq: number; event: string; data: unknown }[];
  /** Live SSE streams: write → end. */
  subscribers: Map<(chunk: string) => void, () => void>;
  /** Time of the last `session/update` — used to let a turn's trailing
   *  updates drain before `turn_end` is published. */
  lastUpdateAt: number;
};

/** Events kept per session for replay on reconnect. Updates are token-sized,
 *  so this has to cover a long answer, not a handful of messages. */
const REPLAY_LIMIT = 20_000;
const HEARTBEAT_MS = 15_000;
/** Some harnesses resolve `session/prompt` before their last `session/update`
 *  notifications are written. `turn_end` waits for this much quiet first. */
const TURN_END_QUIET_MS = 300;
const TURN_END_MAX_WAIT_MS = 3_000;
/** An approval nobody answers would otherwise park the turn forever. */
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const RESPAWN_MAX_DELAY_MS = 30_000;
const ACP_PROTOCOL_VERSION = 1;

/** Splits a command line on whitespace, honouring single/double quotes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export class AcpHost {
  /** Token for this device's own chat client (loopback). */
  readonly localToken = randomToken();
  /** Secret the harness presents to `/mcp`. */
  private readonly mcpToken = randomToken();
  private server: Server | null = null;
  private child: ChildProcess | null = null;
  private agent: JsonRpcPeer | null = null; // set once `initialize` succeeds
  private stopped = false;
  private respawnDelay = 1_000;
  private heartbeat: number | null = null;
  private sessions = new Map<string, SessionState>();
  private approvals = new Map<string, { sessionId: string; resolve: (r: RequestPermissionResponse) => void; timer: number }>();
  private mcp: VaultMcpServer;

  constructor(private opts: HostOptions) {
    this.mcp = new VaultMcpServer(opts.app, opts.blacklist);
  }

  get port(): number {
    return this.opts.port;
  }

  start(): void {
    const http = require("http") as typeof import("http");
    this.server = http.createServer((req, res) => void this.route(req, res));
    this.server.on("error", (err) => this.opts.log(`server error: ${err.message}`));
    this.server.listen(this.opts.port, "0.0.0.0", () => this.opts.log(`listening on :${this.opts.port}`));
    this.heartbeat = window.setInterval(() => {
      for (const s of this.sessions.values()) for (const write of s.subscribers.keys()) write(": ping\n\n");
    }, HEARTBEAT_MS);
    void this.spawnHarness();
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    for (const a of this.approvals.values()) window.clearTimeout(a.timer);
    this.approvals.clear();
    for (const s of this.sessions.values()) for (const end of s.subscribers.values()) end();
    this.sessions.clear();
    this.child?.kill();
    this.child = null;
    this.agent = null;
    this.server?.close();
    this.server = null;
  }

  // ---------- harness lifecycle ----------

  private async spawnHarness(): Promise<void> {
    if (this.stopped) return;
    const [cmd, ...args] = splitCommand(this.opts.command);
    if (!cmd) {
      this.opts.log("no harness command configured");
      return;
    }
    const { spawn } = require("child_process") as typeof import("child_process");
    const child = spawn(cmd, args, {
      cwd: this.opts.cwd,
      env: { ...process.env, PATH: harnessPath() },
      stdio: ["pipe", "pipe", "pipe"],
      // `.cmd` shims (npm-installed CLIs) only resolve through a shell on Windows.
      shell: process.platform === "win32",
    });
    this.child = child;
    child.stderr?.on("data", (c: Buffer) => this.opts.log(`harness: ${c.toString().trimEnd()}`));
    child.on("error", (err) => this.opts.log(`harness failed to start: ${err.message}`));

    const peer = new JsonRpcPeer(child.stdout!, child.stdin!, (msg) => this.opts.log(msg));
    peer.onNotification("session/update", (params: any) => {
      const { sessionId, update } = params;
      const s = this.sessions.get(sessionId);
      if (s) s.lastUpdateAt = Date.now();
      this.publish(sessionId, "session_update", update);
    });
    peer.onRequest("session/request_permission", (params: any) => this.parkApproval(params));
    try {
      // The handshake is the only place an agent states what it supports;
      // skipping it works with some harnesses by luck, not by contract.
      await peer.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "obsidian-chat", version: "1" },
      });
      this.agent = peer;
      this.respawnDelay = 1_000;
      this.opts.log(`harness ready: ${this.opts.command}`);
    } catch (err) {
      this.opts.log(`harness initialize failed: ${String((err as Error).message ?? err)}`);
    }

    await new Promise<void>((resolve) => child.on("exit", () => resolve()));
    peer.close(new Error("harness exited"));
    this.agent = null;
    // Sessions lived inside that process. Tell every open stream, close it,
    // and forget the session so a reconnect gets a clean 404.
    for (const [id, s] of this.sessions) {
      this.publish(id, "session_dead", { reason: "harness exited" });
      for (const end of s.subscribers.values()) end();
    }
    this.sessions.clear();
    if (this.stopped) return;
    this.opts.log(`harness exited — respawning in ${this.respawnDelay / 1000}s`);
    window.setTimeout(() => void this.spawnHarness(), this.respawnDelay);
    this.respawnDelay = Math.min(this.respawnDelay * 2, RESPAWN_MAX_DELAY_MS);
  }

  private parkApproval(params: any): Promise<RequestPermissionResponse> {
    const { sessionId, toolCall, options } = params;
    return new Promise((resolve) => {
      const requestId = randomToken();
      const timer = window.setTimeout(() => {
        this.approvals.delete(requestId);
        resolve({ outcome: { outcome: "cancelled" } });
      }, APPROVAL_TIMEOUT_MS);
      this.approvals.set(requestId, { sessionId, resolve, timer });
      this.publish(sessionId, "permission_request", { requestId, toolCall, options });
    });
  }

  // ---------- SSE ----------

  private publish(sessionId: string, event: string, data: unknown): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.seq += 1;
    s.buffer.push({ seq: s.seq, event, data });
    if (s.buffer.length > REPLAY_LIMIT) s.buffer.shift();
    const chunk = sseChunk(s.seq, event, data);
    for (const write of s.subscribers.keys()) write(chunk);
  }

  /** Runs one prompt turn and publishes `turn_end` on the same ordered stream
   *  as its updates, so a client never sees the end before the last token. */
  private async runPrompt(sessionId: string, prompt: unknown): Promise<void> {
    const agent = this.requireAgent();
    let end: Record<string, unknown>;
    try {
      const response: any = await agent.request("session/prompt", { sessionId, prompt });
      end = { stopReason: response?.stopReason ?? "end_turn" };
    } catch (err) {
      end = { error: String((err as Error).message ?? err) };
    }
    const started = Date.now();
    for (;;) {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      const quiet = Date.now() - s.lastUpdateAt;
      if (quiet >= TURN_END_QUIET_MS || Date.now() - started >= TURN_END_MAX_WAIT_MS) break;
      await new Promise((r) => window.setTimeout(r, TURN_END_QUIET_MS - quiet));
    }
    this.publish(sessionId, "turn_end", end);
  }

  // ---------- HTTP ----------

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // The mobile WebView is a real cross-origin client; the token, not the
    // origin, is the security boundary.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type, last-event-id, mcp-protocol-version, mcp-session-id");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://host");
    const parts = url.pathname.split("/").filter(Boolean);
    const token = bearer(req);

    try {
      if (parts[0] === "mcp") return await this.routeMcp(req, res, token);

      const deviceId = this.deviceFor(token);
      if (!deviceId) return sendJson(res, 401, { error: "unauthorized" });

      if (req.method === "POST" && parts.length === 1 && parts[0] === "sessions") {
        const agent = this.requireAgent();
        const response: any = await agent.request("session/new", {
          cwd: this.opts.cwd,
          mcpServers: [
            {
              type: "http",
              name: "vault",
              url: `http://127.0.0.1:${this.opts.port}/mcp`,
              headers: [{ name: "Authorization", value: `Bearer ${this.mcpToken}` }],
            },
          ],
        });
        this.sessions.set(response.sessionId, { deviceId, seq: 0, buffer: [], subscribers: new Map(), lastUpdateAt: 0 });
        return sendJson(res, 200, { sessionId: response.sessionId, modes: response.modes, configOptions: response.configOptions });
      }

      if (parts[0] === "approvals" && parts.length === 2 && req.method === "POST") {
        const pending = this.approvals.get(parts[1]);
        if (!pending) return sendJson(res, 404, { error: "unknown or already-resolved approval" });
        if (this.sessions.get(pending.sessionId)?.deviceId !== deviceId) return sendJson(res, 403, { error: "approval belongs to another device" });
        const { optionId } = await readJson(req);
        this.approvals.delete(parts[1]);
        window.clearTimeout(pending.timer);
        pending.resolve({ outcome: { outcome: "selected", optionId } });
        return sendJson(res, 200, { ok: true });
      }

      if (parts[0] !== "sessions" || parts.length < 2) return sendJson(res, 404, { error: "not found" });
      const sessionId = parts[1];
      const s = this.sessions.get(sessionId);
      if (!s) return sendJson(res, 404, { error: "unknown session" });
      if (s.deviceId !== deviceId) return sendJson(res, 403, { error: "session belongs to another device" });
      const action = parts[2];

      if (req.method === "GET" && action === "events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const since = Number(req.headers["last-event-id"] ?? url.searchParams.get("sinceSeq") ?? 0);
        for (const item of s.buffer) if (item.seq > since) res.write(sseChunk(item.seq, item.event, item.data));
        const write = (chunk: string) => void res.write(chunk);
        s.subscribers.set(write, () => res.end());
        req.on("close", () => s.subscribers.delete(write));
        return;
      }
      if (req.method === "POST" && action === "prompt") {
        const { prompt } = await readJson(req);
        this.requireAgent();
        void this.runPrompt(sessionId, prompt);
        return sendJson(res, 202, { accepted: true });
      }
      if (req.method === "POST" && action === "mode") {
        const { modeId } = await readJson(req);
        return sendJson(res, 200, await this.requireAgent().request("session/set_mode", { sessionId, modeId }));
      }
      if (req.method === "POST" && action === "config-option") {
        const { optionId, value } = await readJson(req);
        const params =
          typeof value === "boolean"
            ? { sessionId, configId: optionId, type: "boolean", value }
            : { sessionId, configId: optionId, value };
        return sendJson(res, 200, await this.requireAgent().request("session/set_config_option", params));
      }
      if (req.method === "POST" && action === "cancel") {
        await this.requireAgent().notify("session/cancel", { sessionId });
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "DELETE" && !action) {
        if (this.agent) await this.agent.request("session/close", { sessionId }).catch(() => {});
        this.sessions.delete(sessionId);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      if ((err as { code?: string }).code === "HARNESS_UNAVAILABLE") return sendJson(res, 503, { error: "harness unavailable" });
      this.opts.log(`request failed: ${String((err as Error).message ?? err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: String((err as Error).message ?? err) });
    }
  }

  private async routeMcp(req: IncomingMessage, res: ServerResponse, token: string | null): Promise<void> {
    const addr = req.socket.remoteAddress ?? "";
    const loopback = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
    if (!loopback || token !== this.mcpToken) return sendJson(res, 401, { error: "unauthorized" });
    if (req.method === "GET") {
      res.writeHead(405, { allow: "POST" });
      res.end();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    }
    const reply = await this.mcp.handle(body);
    if (reply === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    sendJson(res, 200, reply);
  }

  private deviceFor(token: string | null): string | null {
    if (!token) return null;
    if (token === this.localToken) return "this-device";
    for (const [device, t] of Object.entries(this.opts.devices())) if (t && t === token) return device;
    return null;
  }

  private requireAgent(): JsonRpcPeer {
    if (!this.agent) throw Object.assign(new Error("harness unavailable"), { code: "HARNESS_UNAVAILABLE" });
    return this.agent;
  }
}

export function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Obsidian launches without a login shell, so user-installed CLIs (Homebrew,
 *  npm globals, ~/.local/bin) are missing from PATH. Add the usual places. */
function harnessPath(): string {
  const { delimiter } = require("path") as typeof import("path");
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const extra =
    process.platform === "win32"
      ? [`${process.env.APPDATA ?? ""}\\npm`]
      : ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/.bun/bin`, `${home}/.opencode/bin`, `${home}/.nvm/shims`];
  return [...extra, process.env.PATH ?? ""].filter(Boolean).join(delimiter);
}

function sseChunk(seq: number, event: string, data: unknown): string {
  return `id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function bearer(req: IncomingMessage): string | null {
  const auth = req.headers["authorization"] ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

#!/usr/bin/env node
/**
 * ACP bridge (specs/001-acp-mcp-migration).
 *
 * Spawns the configured ACP harness as a local subprocess (contracts/
 * bridge-harness-spawn.md) and fronts it over HTTP/SSE for the plugin
 * (contracts/plugin-bridge-acp.md), with per-device auth and a
 * sequence-numbered replay buffer for reconnects (FR-004, FR-005).
 *
 * This is the ONLY place harness identity is a config value, never code
 * (Principle II/III, FR-002, FR-013): `spawnHarness` runs whatever command
 * is configured, with no per-harness branching.
 *
 * Uses the real `@agentclientprotocol/sdk` `client()` API on the harness-facing
 * leg (bridge-as-ACP-client talking to the spawned harness-as-ACP-agent),
 * since that's a real subprocess speaking real ACP over stdio. The
 * plugin-facing leg carries the same ACP method names/payloads as plain JSON
 * over our own HTTP/SSE binding (see contracts/plugin-bridge-acp.md) rather
 * than the SDK's still-experimental Streamable HTTP transport (research.md
 * R2) — a browser/webview client speaking that JSON directly is simpler than
 * adapting the SDK's byte-stream transport primitives into `fetch`/SSE.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { client, ndJsonStream, CLIENT_METHODS } from "@agentclientprotocol/sdk";

const CONFIG_PATH = new URL("../harness.config.json", import.meta.url);
const TOKENS_PATH = new URL("../tokens.json", import.meta.url);

function loadJson(url, label) {
  if (!existsSync(url)) {
    throw new Error(`${label} not found at ${url.pathname} — see harness/README.md`);
  }
  return JSON.parse(readFileSync(url, "utf8"));
}

const config = loadJson(CONFIG_PATH, "harness.config.json");
const tokens = loadJson(TOKENS_PATH, "tokens.json"); // { deviceId: token }

if (!Array.isArray(config.command) || config.command.length === 0) {
  throw new Error("harness.config.json: `command` must be a non-empty array — e.g. [\"opencode\", \"acp\"]");
}

// ---------- auth ----------

function deviceForToken(token) {
  for (const [deviceId, t] of Object.entries(tokens)) if (t === token) return deviceId;
  return null;
}

function authenticate(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const deviceId = token ? deviceForToken(token) : null;
  return deviceId; // null => unauthenticated (FR-004)
}

// ---------- per-session replay buffer + approval state (FR-005, FR-010) ----------

/** @type {Map<string, { deviceId: string, seq: number, buffer: {seq:number, event:string, data:any}[], subscribers: Set<(chunk:string)=>void> }>} */
const sessions = new Map();

function sessionState(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`unknown session ${sessionId}`);
  return s;
}

/** Push one SSE event to a session's replay buffer and any live subscribers. */
function publish(sessionId, event, data) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.seq += 1;
  const chunk = `id: ${s.seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  s.buffer.push({ seq: s.seq, event, data });
  if (s.buffer.length > 500) s.buffer.shift(); // bounded — see README for tuning
  for (const write of s.subscribers) write(chunk);
}

/** @type {Map<string, { sessionId: string, resolve: (optionId: string) => void }>} */
const pendingApprovals = new Map();

// ---------- harness subprocess + ACP client connection ----------

let harnessContext = null; // ClientContext, once connected
let harnessChild = null;

function spawnHarness() {
  const [cmd, ...args] = config.command;
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
  child.on("exit", (code) => {
    console.error(`[acp-bridge] harness process exited (code ${code}) — restart the bridge to respawn`);
    harnessContext = null;
  });
  return child;
}

async function connectHarness() {
  harnessChild = spawnHarness();

  const app = client({ name: "obsidian-chat-bridge" });

  app.onNotification(CLIENT_METHODS.session_update, (ctx) => {
    const { sessionId, update } = ctx.params;
    publish(sessionId, "session_update", update);
  });

  app.onRequest(CLIENT_METHODS.session_request_permission, (ctx) => {
    const { sessionId, toolCall, options } = ctx.params;
    return new Promise((resolve) => {
      const requestId = randomUUID();
      pendingApprovals.set(requestId, {
        sessionId,
        resolve: (optionId) => resolve({ outcome: { outcome: "selected", optionId } }),
      });
      // Approval requests are relayed to the plugin as a distinguished
      // session_update-shaped SSE event (data-model.md Approval Request);
      // they survive reconnect the same way ordinary updates do, via the
      // replay buffer, satisfying FR-010.
      publish(sessionId, "permission_request", { requestId, toolCall, options });
    });
  });

  const stream = ndJsonStream(Writable.toWeb(harnessChild.stdin), Readable.toWeb(harnessChild.stdout));
  const connection = app.connect(stream);
  harnessContext = connection.agent;
  await connection.closed.catch(() => {});
  harnessContext = null; // connection dropped — connectHarness() should be re-invoked by the caller
}

function requireHarness() {
  if (!harnessContext) {
    const err = new Error("harness unavailable");
    err.code = "HARNESS_UNAVAILABLE";
    throw err;
  }
  return harnessContext;
}

// ---------- HTTP/SSE surface (contracts/plugin-bridge-acp.md) ----------

function readJsonBody(req) {
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

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// `requestUrl()` only bypasses CORS on desktop — on mobile (Capacitor
// WebView, origin `capacitor://localhost`) it's still real `fetch()`
// underneath and CORS applies to every route, not just the SSE stream
// (confirmed against Obsidian's own dev forum, and against this repo's own
// prior working gateway.mjs, which set these same headers globally on every
// response for exactly this reason). A wildcard origin covers both
// `capacitor://localhost` (mobile) and `app://obsidian.md` (desktop) without
// needing to branch on platform.
const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, last-event-id");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, "http://internal");
  const parts = url.pathname.split("/").filter(Boolean);

  const deviceId = authenticate(req);
  if (!deviceId) return sendJson(res, 401, { error: "unauthorized" }); // FR-004

  try {
    // POST /sessions -> session/new
    if (req.method === "POST" && parts.length === 1 && parts[0] === "sessions") {
      const ctx = requireHarness();
      const cwd = config.cwd ?? process.cwd();
      const mcpServers = config.mcpVaultProxyUrl
        ? [{ type: "http", name: "vault", url: config.mcpVaultProxyUrl, headers: [] }]
        : [];
      const { sessionId, modes, configOptions } = await ctx.request("session/new", { cwd, mcpServers });
      sessions.set(sessionId, { deviceId, seq: 0, buffer: [], subscribers: new Set() });
      // `modes`/`configOptions` are passed through verbatim — whatever shape the
      // harness's own ACP response has (SessionModeState / SessionConfigOption[]).
      // The bridge doesn't interpret them, staying harness-agnostic (Principle III;
      // contracts/plugin-bridge-acp-extensions.md).
      return sendJson(res, 200, { sessionId, modes, configOptions });
    }

    // GET /sessions/:id/events -> SSE, replay from Last-Event-ID (FR-005)
    if (req.method === "GET" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "events") {
      const sessionId = parts[1];
      const s = sessions.get(sessionId);
      if (!s) return sendJson(res, 404, { error: "unknown session" });
      if (s.deviceId !== deviceId) return sendJson(res, 403, { error: "session belongs to another device" });

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const since = Number(req.headers["last-event-id"] ?? url.searchParams.get("sinceSeq") ?? 0);
      for (const item of s.buffer) {
        if (item.seq > since) {
          res.write(`id: ${item.seq}\nevent: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`);
        }
      }
      const write = (chunk) => res.write(chunk);
      s.subscribers.add(write);
      req.on("close", () => s.subscribers.delete(write));
      return;
    }

    // POST /sessions/:id/prompt -> session/prompt
    if (req.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "prompt") {
      const sessionId = parts[1];
      const s = sessionState(sessionId);
      if (s.deviceId !== deviceId) return sendJson(res, 403, { error: "session belongs to another device" });
      const { prompt } = await readJsonBody(req); // ContentBlock[] — see plugin/src/acp/client.ts
      const ctx = requireHarness();
      const response = await ctx.request("session/prompt", { sessionId, prompt });
      return sendJson(res, 200, response);
    }

    // POST /sessions/:id/mode -> session/set_mode
    if (req.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "mode") {
      const sessionId = parts[1];
      const s = sessionState(sessionId);
      if (s.deviceId !== deviceId) return sendJson(res, 403, { error: "session belongs to another device" });
      const { modeId } = await readJsonBody(req);
      const ctx = requireHarness();
      const response = await ctx.request("session/set_mode", { sessionId, modeId });
      return sendJson(res, 200, response);
    }

    // POST /sessions/:id/config-option -> session/set_config_option
    if (req.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "config-option") {
      const sessionId = parts[1];
      const s = sessionState(sessionId);
      if (s.deviceId !== deviceId) return sendJson(res, 403, { error: "session belongs to another device" });
      const { optionId, value } = await readJsonBody(req);
      const ctx = requireHarness();
      // Real field name is `configId`, not `optionId` (our own plugin-bridge
      // HTTP contract's naming) — confirmed against the SDK schema. A boolean
      // value also needs the `type: "boolean"` discriminant alongside it;
      // the select-value variant has no `type` field.
      const params =
        typeof value === "boolean"
          ? { sessionId, configId: optionId, type: "boolean", value }
          : { sessionId, configId: optionId, value };
      const response = await ctx.request("session/set_config_option", params);
      return sendJson(res, 200, response);
    }

    // POST /sessions/:id/cancel -> session/cancel (notification)
    if (req.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "cancel") {
      const sessionId = parts[1];
      const s = sessionState(sessionId);
      if (s.deviceId !== deviceId) return sendJson(res, 403, { error: "session belongs to another device" });
      const ctx = requireHarness();
      await ctx.notify("session/cancel", { sessionId });
      return sendJson(res, 200, { ok: true });
    }

    // POST /approvals/:requestId -> resolve a pending session/request_permission
    if (req.method === "POST" && parts.length === 2 && parts[0] === "approvals") {
      const requestId = parts[1];
      const pending = pendingApprovals.get(requestId);
      if (!pending) return sendJson(res, 404, { error: "unknown or already-resolved approval" });
      if (pending.sessionId && sessions.get(pending.sessionId)?.deviceId !== deviceId) {
        return sendJson(res, 403, { error: "approval belongs to another device" });
      }
      const { optionId } = await readJsonBody(req);
      pendingApprovals.delete(requestId);
      pending.resolve(optionId);
      return sendJson(res, 200, { ok: true });
    }

    // DELETE /sessions/:id -> session/close
    if (req.method === "DELETE" && parts.length === 2 && parts[0] === "sessions") {
      const sessionId = parts[1];
      const s = sessions.get(sessionId);
      if (s && s.deviceId === deviceId && harnessContext) {
        await harnessContext.request("session/close", { sessionId }).catch(() => {});
      }
      sessions.delete(sessionId);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (err) {
    if (err.code === "HARNESS_UNAVAILABLE") return sendJson(res, 503, { error: "harness unavailable" }); // FR-012
    console.error("[acp-bridge]", err);
    return sendJson(res, 500, { error: String(err.message ?? err) });
  }
});

async function main() {
  connectHarness().catch((err) => console.error("[acp-bridge] harness connection ended:", err));
  const port = config.bridgePort ?? 8765;
  server.listen(port, () => console.log(`[acp-bridge] listening on :${port}, spawning: ${config.command.join(" ")}`));
}

main();

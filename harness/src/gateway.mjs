#!/usr/bin/env node
/**
 * G3 Gateway prototype — PLAN.md §2.4 lifecycle, Phase 0 gate G3.
 *
 * Always-on launchd listener on the main machine. Responsibilities (auth + spawn ONLY):
 *   GET  /health                 -> status, no auth
 *   POST /sessions               -> bearer-token auth, spawn ephemeral worker, return { sessionId }
 *   GET  /sessions/:id/events    -> SSE stream from worker stdout (replay via last-event-id)
 *   POST /sessions/:id/input     -> forward a user turn to worker stdin
 *   DELETE /sessions/:id         -> kill worker (gateway stays up)
 *
 * Security posture for the spike:
 *   - binds ONLY to the Tailscale interface address (never 0.0.0.0 / LAN / WAN)
 *   - per-device bearer tokens, timing-safe compared, revocable by editing tokens.json
 *   - idle timeout kills workers; TTL caps session lifetime
 *
 * Dev-only escape hatch: --bind 127.0.0.1 for testing without Tailscale.
 */
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { spawn, execSync } from "node:child_process";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------- config ----------
const PORT = Number(process.env.PORT || 8765);
const IDLE_MS = Number(process.env.IDLE_TIMEOUT_MS || 15 * 60_000); // 15 min
const MAX_LIFE_MS = Number(process.env.SESSION_TTL_MS || 60 * 60_000); // 1 h
// Phase 1: relay worker forwards grounded completions to a provider using keys
// on this machine (env PROVIDER_BASE_URL / PROVIDER_API_KEY). Set WORKER_CMD to
// echo-worker.mjs to fall back to the G3 echo for transport testing.
const WORKER = process.env.WORKER_CMD || path.join(__dirname, "relay-worker.mjs");

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** CGNAT range check: 100.64.0.0/10 */
function isTailscaleIP(addr) {
  return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr);
}

function resolveBind() {
  const override = argVal("--bind");
  if (override) return override;
  try {
    const ip = execSync("tailscale ip -4", { encoding: "utf8", timeout: 3000 }).trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch {
    /* tailscale missing or not running — fall through */
  }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && isTailscaleIP(a.address)) return a.address;
    }
  }
  throw new Error(
    "No Tailscale IP found. Install/log in to Tailscale, or pass --bind <addr> for dev."
  );
}

// ---------- tokens ----------
const TOKENS_PATH = path.join(ROOT, "tokens.json");
if (!existsSync(TOKENS_PATH)) {
  const sample = { "device-1": randomUUID() + randomUUID() };
  writeFileSync(TOKENS_PATH, JSON.stringify(sample, null, 2) + "\n");
  console.error(
    `Created ${TOKENS_PATH} with a generated token for "device-1".\n` +
      `Use that token as Authorization: Bearer <secret>, then restart the gateway.`
  );
  process.exit(1);
}
const TOKENS = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));

function authorize(req) {
  const hdr = req.headers.authorization ?? "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return null;
  for (const [device, secret] of Object.entries(TOKENS)) {
    const a = createHash("sha256").update(String(secret)).digest();
    const b = createHash("sha256").update(String(token)).digest();
    if (timingSafeEqual(a, b)) return device;
  }
  return null;
}

// ---------- sessions ----------
/** @type {Map<string, Session>} */
const sessions = new Map();

class Session {
  constructor(id, device, child) {
    this.id = id;
    this.device = device;
    this.child = child;
    this.events = []; // bounded ring for last-event-id replay
    this.seq = 0;
    this.subscribers = new Set();
    this.lastActivity = Date.now();
    this.bornAt = Date.now();
  }
  push(event, data) {
    const ev = { id: ++this.seq, event, data };
    this.events.push(ev);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    for (const res of this.subscribers) writeEvent(res, ev);
    return ev;
  }
  touch() {
    this.lastActivity = Date.now();
  }
}

function attachStdoutParser(session) {
  let buf = "";
  session.child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) > -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        session.push(msg.event ?? "message", msg.data ?? {});
      } catch {
        session.push("log", { text: line });
      }
    }
  });
  session.child.stderr.on("data", (c) => session.push("stderr", { text: String(c) }));
  session.child.on("exit", (code, signal) => {
    session.push("exit", { code, signal });
    for (const res of session.subscribers) res.end();
    session.subscribers.clear();
    sessions.delete(session.id);
    log(`session ${session.id} ended (code=${code} signal=${signal})`);
  });
}

function writeEvent(res, ev) {
  res.write(`id: ${ev.id}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
}

// ---------- http ----------
const server = createServer(async (req, res) => {
  log(`${req.method} ${req.url} from ${req.socket.remoteAddress}`);
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  // CORS so the phone-browser test page (spikes/g3-phone/index.html) can call us.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization,content-type,last-event-id");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const m = url.pathname.match(/^\/sessions\/([\w-]+)(\/events|\/input)?$/);

  try {
    // Serve the G3 test page from THIS origin so iOS Safari needs only one
    // cert acceptance and there is no cross-origin fetch at all.
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const page = path.join(ROOT, "..", "spikes", "g3-phone", "index.html");
      if (existsSync(page)) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(readFileSync(page));
      }
    }

    if (url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        uptime: process.uptime(),
        sessions: sessions.size,
        bind: server.address()?.address,
        port: PORT,
      });
    }

    const device = authorize(req);
    if (!device) return json(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && url.pathname === "/sessions") {
      const body = await readJson(req).catch(() => ({}));
      const id = randomUUID();
      log(`spawn worker for session ${id} (device=${device}, model=${body.model ?? "echo"})`);
      const child = spawn(process.execPath, [WORKER, "--session", id], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
      const s = new Session(id, device, child);
      sessions.set(id, s);
      attachStdoutParser(s);
      s.push("ready", { sessionId: id, pid: child.pid });
      return json(res, 201, { sessionId: id, pid: child.pid });
    }

    if (m) {
      const s = sessions.get(m[1]);
      if (!s) return json(res, 404, { error: "no such session" });
      s.touch();

      if (req.method === "GET" && m[2] === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const last = Number(req.headers["last-event-id"] ?? 0);
        for (const ev of s.events) if (ev.id > last) writeEvent(res, ev);
        s.subscribers.add(res);
        req.on("close", () => s.subscribers.delete(res));
        return;
      }

      if (req.method === "POST" && m[2] === "/input") {
        const body = await readJson(req);
        s.child.stdin.write(JSON.stringify(body) + "\n");
        return json(res, 202, { ok: true });
      }

      if (req.method === "DELETE" && !m[2]) {
        s.child.kill("SIGTERM");
        return json(res, 200, { killed: s.id });
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    log(`error: ${err.stack ?? err}`);
    if (!res.headersSent) json(res, 500, { error: String(err.message ?? err) });
    else res.end();
  }
});

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj) + "\n");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// ---------- reaper: idle timeout + TTL ----------
setInterval(() => {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (now - s.bornAt > MAX_LIFE_MS) {
      log(`session ${s.id} hit TTL, killing`);
      s.child.kill("SIGTERM");
    } else if (now - s.lastActivity > IDLE_MS) {
      log(`session ${s.id} idle, killing`);
      s.child.kill("SIGTERM");
    }
  }
}, 30_000).unref();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// TLS modes:
//   --tls        self-signed HTTPS using certs/ (direct tailscale-IP access)
//   default      plain HTTP — the production shape: `tailscale serve` terminates
//                real TLS at <device>.<tailnet>.ts.net and proxies to this local port.
const CERT = path.join(ROOT, "certs", "cert.pem");
const KEY = path.join(ROOT, "certs", "key.pem");
const tls = process.argv.includes("--tls") && existsSync(CERT) && existsSync(KEY);

let bind;
try {
  bind = resolveBind();
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}
const listener = tls
  ? createHttpsServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, server.listeners("request")[0])
  : server;
listener.listen(PORT, bind, () => {
  log(`gateway listening on http${tls ? "s" : ""}://${bind}:${PORT}${isTailscaleIP(bind) ? " (Tailscale-only bind)" : " (DEV BIND — not tailscale)"}`);
  log(`worker cmd: ${WORKER}`);
});

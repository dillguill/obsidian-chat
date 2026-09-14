#!/usr/bin/env node
/**
 * MCP rules proxy (specs/001-acp-mcp-migration, contracts/harness-mcp-vault.md).
 *
 * The one named exception to Constitution Principle III beyond the ACP
 * bridge (v1.1.0). Sits between the configured harness's MCP client and the
 * vault's real MCP server (Obsidian's Local REST API plugin, built-in MCP at
 * `/mcp/` since v5.0) and enforces the existing folder-blacklist
 * access-control gate (`settings.blacklistFolders` /
 * `plugin/src/retrieval/index.ts`'s `isExcluded()`), since LRA's own MCP
 * server has no notion of it (FR-008).
 *
 * `.chat/rules.md` is intentionally NOT enforced here — in the existing
 * product it is advisory instruction text injected into the model's prompt
 * context (like AGENTS.md), not an access-control boundary (see
 * data-model.md's correction note). This proxy only gates on the blacklist.
 *
 * Every other MCP method/tool call is forwarded to LRA unmodified — this
 * proxy MUST NOT reimplement or duplicate any vault operation LRA already
 * provides (Constitution III).
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";

// LRA's HTTPS listener uses a self-signed cert it generates itself (see
// Obsidian Local REST API's own docs) — Node's built-in fetch() rejects
// that by default (DEPTH_ZERO_SELF_SIGNED_CERT). This process's only
// outbound HTTPS calls are to that one loopback LRA instance, so disabling
// verification process-wide (rather than per-request — Node's global fetch
// doesn't accept a dispatcher from the standalone `undici` package; the two
// Agent implementations aren't compatible) is scoped enough here.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const CONFIG_PATH = new URL("../harness.config.json", import.meta.url);

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`harness.config.json not found at ${CONFIG_PATH.pathname} — see harness/README.md`);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

const config = loadConfig();
const LRA_BASE = (config.lra?.baseUrl ?? "https://127.0.0.1:27124").replace(/\/$/, "");
const LRA_MCP_PATH = config.lra?.mcpPath ?? "/mcp/";
const LRA_API_KEY = process.env.LRA_API_KEY ?? config.lra?.apiKey ?? "";
const PORT = config.mcpProxyPort ?? 8766;

/** `settings.blacklistFolders`-shaped list — vault-relative folder prefixes, each with a trailing "/". */
function blacklist() {
  return config.rules?.blacklistFolders ?? [];
}

/** Mirrors `VaultIndex.isExcluded()` (plugin/src/retrieval/index.ts). */
function isExcluded(path) {
  const bl = blacklist();
  const normPath = String(path).replace(/\/+$/, "");
  return bl.some((p) => {
    const norm = String(p).replace(/\/+$/, "");
    return normPath === norm || normPath.startsWith(norm + "/");
  });
}

/**
 * Exact path-bearing argument field names, per LRA tool.
 *
 * Captured from a live `tools/list` against the Local REST API MCP endpoint
 * (v5.1.0, 2026-09-13 — 16 tools, schemes in the comment below), replacing the
 * earlier substring heuristic. All vault tools take `path`; move/copy add
 * `destination`. Tools absent from this table fall back to the generic walk,
 * so an LRA upgrade that adds a tool degrades to "best effort" rather than
 * silently skipping the blacklist check.
 */
const PATH_FIELDS = {
  vault_list: ["path"],
  vault_read: ["path"],
  vault_write: ["path"],
  vault_append: ["path"],
  vault_patch: ["path"],
  vault_delete: ["path"],
  vault_move: ["path", "destination"],
  vault_copy: ["path", "destination"],
  vault_get_document_map: ["path"],
  open_file: ["path"],
  // No path argument: active_file_get_path, search_query, search_simple,
  // tag_list, command_list, command_execute.
};

/**
 * Paths targeted by an MCP `tools/call` request.
 *
 * Uses {@link PATH_FIELDS} when the tool is known; otherwise walks the
 * arguments for anything path-shaped (the original best-effort behaviour).
 */
function extractTargetPaths(rpcBody) {
  const name = rpcBody?.params?.name;
  const args = rpcBody?.params?.arguments;
  if (!args || typeof args !== "object") return [];
  const fields = name ? PATH_FIELDS[name] : undefined;
  if (fields) {
    return fields.map((f) => args[f]).filter((v) => typeof v === "string" && v.length > 0);
  }
  const found = [];
  const walk = (v) => {
    if (typeof v === "string" && v.length && !v.startsWith("http") && v.includes(".")) found.push(v);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(args);
  return found;
}

function jsonRpcError(id, message) {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code: -32001, message } });
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    // Non-POST (e.g. an SSE GET for older sessionful MCP revisions) — pass through unmodified.
    return proxyRaw(req, res);
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let rpcBody;
  try {
    rpcBody = raw ? JSON.parse(raw) : null;
  } catch {
    rpcBody = null; // not JSON-RPC we can inspect — forward unmodified rather than guess
  }

  if (rpcBody?.method === "tools/call") {
    const targets = extractTargetPaths(rpcBody);
    const denied = targets.find((p) => isExcluded(p));
    if (denied) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(jsonRpcError(rpcBody.id, `"${denied}" is excluded from tool access by the vault's folder blacklist`));
    }
  }

  return proxyRaw(req, res, raw);
});

/** Forward the request to LRA's MCP endpoint unmodified, streaming the response back. */
async function proxyRaw(req, res, capturedBody) {
  const targetUrl = `${LRA_BASE}${LRA_MCP_PATH}`;
  const headers = { ...req.headers, host: undefined, authorization: `Bearer ${LRA_API_KEY}` };
  delete headers.host;
  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: capturedBody ?? (req.method === "GET" || req.method === "HEAD" ? undefined : req),
      duplex: "half",
    });
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `mcp-rules-proxy: upstream LRA unreachable: ${String(err.message ?? err)}` }));
  }
}

server.listen(PORT, () => console.log(`[mcp-rules-proxy] listening on :${PORT}, forwarding to ${LRA_BASE}${LRA_MCP_PATH}`));

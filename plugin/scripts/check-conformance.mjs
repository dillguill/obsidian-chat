#!/usr/bin/env node
/** Static conformance checks for the final ACP shell (T106/T112, FR-070).
 *
 *  Exits 1 on the first category with findings. After US9 the legacy path no
 *  longer exists, so the checks run over the whole runtime surface.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const srcRoot = join(root, "src");
const rel = (path) => relative(srcRoot, path).replaceAll("\\", "/");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

const allTs = walk(srcRoot);
const tests = allTs.filter((file) => file.endsWith(".test.ts"));
const sources = allTs.filter((file) => !file.endsWith(".test.ts"));
const problems = [];

/** The legacy path is deleted, not flagged off (Constitution IV / T110). */
const DELETED = [
  "host/server.ts",
  "host/jsonrpc.ts",
  "host/vault-mcp.ts",
  "acp/client.ts",
  "session/legacy-note.ts",
  "session/legacy-bridge.ts",
  "chat/tool-input.ts",
  "chat/types.ts",
  "ui/chat-view.ts",
  "ui/activity.ts",
  "ui/record-suggest.ts",
  "ui/session-suggest.ts",
  "ui/acp-model-suggest.ts",
  "ui/acp-picker-menu.ts",
  "chat/model-prefs.ts",
  "retrieval/index.ts",
];
for (const path of DELETED) {
  if (existsSync(join(srcRoot, path))) problems.push(`${path}: legacy module still exists`);
}

/** Strip comments so deleted names in documentation do not fail the gate. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** No SSE, custom envelope, or legacy client identifiers anywhere. */
const FORBIDDEN = [
  [/\bturn_end\b/, "turn_end identifier (deleted SSE envelope name)"],
  [/Last-Event-ID/i, "Last-Event-ID"],
  [/text\/event-stream/, "SSE content type"],
  [/\bEventSource\b/, "EventSource"],
  [/\bAcpBridgeClient\b/, "legacy AcpBridgeClient"],
  [/\btoolCallContentLines\b/, "legacy tool-content dictionary helper"],
];
for (const file of sources) {
  const text = stripComments(readFileSync(file, "utf8"));
  for (const [re, label] of FORBIDDEN) {
    if (re.test(text)) problems.push(`${rel(file)}: ${label}`);
  }
}

/** Provider/model names never appear in runtime code or active surfaces. */
const PROVIDERS = /\b(anthropic|openai|openrouter|deepseek|ollama)\b/i;
for (const file of sources) {
  if (PROVIDERS.test(stripComments(readFileSync(file, "utf8")))) {
    problems.push(`${rel(file)}: provider/model name in active source`);
  }
}
for (const file of [join(root, "manifest.json"), join(root, "preview.html")]) {
  try {
    if (PROVIDERS.test(readFileSync(file, "utf8"))) problems.push(`${relative(root, file)}: provider/model name in active surface`);
  } catch {
    // optional surface
  }
}
try {
  if (PROVIDERS.test(readFileSync(join(root, "..", "HANDOFF.md"), "utf8"))) {
    problems.push("HANDOFF.md: provider/model name in handoff instructions");
  }
} catch {
  // no handoff present
}

/** Only the import helper may parse the old Markdown format; nothing writes it. */
const TRANSCRIPT_MARKER = /from\s+["'][^"']*legacy-note["']|\brenderBody\s*\(|\bmetaToFrontmatter\s*\(|\bparseSessionNote\s*\(/;
for (const file of sources) {
  if (rel(file) === "session/migrate.ts") continue;
  if (TRANSCRIPT_MARKER.test(readFileSync(file, "utf8"))) {
    problems.push(`${rel(file)}: Markdown transcript writer/reader outside the import helper`);
  }
}

/** One listener (ACP + loopback MCP) and one harness child, no other servers. */
const serverSource = readFileSync(join(srcRoot, "shell/host-server.ts"), "utf8");
const listens = (serverSource.match(/\.listen\(/g) ?? []).length;
if (listens !== 1) problems.push(`shell/host-server.ts: expected exactly one listen(, found ${listens}`);
const serverCreators = sources.filter((file) => /from\s+["']node:http["'][\s\S]*createServer\(|[^.\w]createServer\(/.test(readFileSync(file, "utf8")));
if (serverCreators.length !== 1 || rel(serverCreators[0]) !== "shell/host-server.ts") {
  problems.push(`expected one host server in shell/host-server.ts, found ${serverCreators.map(rel).join(", ") || "none"}`);
}
const spawns = sources.filter((file) => /\bspawn\(/.test(readFileSync(file, "utf8")));
if (spawns.length !== 1 || rel(spawns[0]) !== "shell/local-transport.ts") {
  problems.push(`expected one harness spawn in shell/local-transport.ts, found ${spawns.map(rel).join(", ") || "none"}`);
}

/** Top-level Node-only imports are limited to the desktop-gated shell files. */
const NODE_OK = new Set(["shell/local-transport.ts", "shell/host-server.ts"]);
const NODE_IMPORT = /from\s+["']node:(?:child_process|fs|path|http|stream|net|tls)["']/;
for (const file of sources) {
  if (NODE_OK.has(rel(file))) continue;
  if (NODE_IMPORT.test(readFileSync(file, "utf8"))) problems.push(`${rel(file)}: top-level Node-only import`);
}

/** There is no note-folder/session-folder setting in runtime code. */
for (const file of sources) {
  const text = stripComments(readFileSync(file, "utf8"));
  if (/\bchatFolder\b/.test(text)) problems.push(`${rel(file)}: note-folder setting reference`);
  if (/\bsettings\.(?:gateway|host)\b/.test(text)) problems.push(`${rel(file)}: legacy gateway/host settings reference`);
}

/** The host-owned JSONL store must still exist (it is not legacy). */
if (!existsSync(join(srcRoot, "session/store.ts"))) problems.push("session/store.ts: the JSONL store is missing");

if (problems.length) {
  console.error("Conformance check failed:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`Conformance check passed (${sources.length} runtime files, ${tests.length} test files).`);

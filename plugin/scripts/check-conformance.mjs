#!/usr/bin/env node
/** Static conformance checks for the ACP shell (T009, FR-043…FR-070).
 *  Exits 1 on the first category with findings. Legacy modules are excluded
 *  until the US9 deletion phase; once they are deleted the exclusions vanish.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const srcRoot = join(root, "src");

const NEW_DIRS = ["acp", "vault", "session"].map((d) => join(srcRoot, d));
const SHELL = join(srcRoot, "shell");
const LEGACY = new Set([
  "ui/activity.ts",
  "ui/acp-model-suggest.ts",
  "ui/session-suggest.ts",
  "chat/tool-input.ts",
  "chat/types.ts",
  "acp/client.ts",
  "session/store.ts", // legacy note writer, deleted at US9
  "session/legacy-note.ts",
  "host/server.ts",
  "host/jsonrpc.ts",
  "host/vault-mcp.ts",
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const files = [...NEW_DIRS.flatMap(walk), ...walk(SHELL)];
const problems = [];
const rel = (p) => relative(srcRoot, p).replaceAll("\\", "/");

/** Strip comments so a deleted-name mention in documentation does not fail the
 *  gate; the check is about code identifiers. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

for (const file of files) {
  const name = rel(file);
  if (LEGACY.has(name)) continue;
  const text = stripComments(readFileSync(file, "utf8"));
  const checks = [
    [/\bturn_end\b/, "turn_end identifier (deleted SSE envelope name)"],
    [/Last-Event-ID/i, "Last-Event-ID"],
    [/text\/event-stream/, "SSE content type"],
    [/\bEventSource\b/, "EventSource"],
    [/\bAcpBridgeClient\b/, "legacy AcpBridgeClient"],
    [/\b(anthropic|openai|deepseek|ollama)\b/i, "provider name in shell code"],
  ];
  for (const [re, label] of checks) {
    if (re.test(text)) problems.push(`${name}: ${label}`);
  }
  // Only lazy desktop requires may reference Node process/file APIs.
  if (!["shell/local-transport.ts", "shell/host-server.ts", "shell/host-relay.ts", "shell/device-auth.ts"].includes(name)) {
    if (/from\s+["'](?:node:)?(?:child_process|fs|path)["']/.test(text)) {
      problems.push(`${name}: top-level Node-only import`);
    }
  }
}

// Exactly one listener; /mcp must be loopback-checked by the route owner.
const serverFiles = files.filter((f) => /host-server\.ts$/.test(f));
for (const file of serverFiles) {
  const text = readFileSync(file, "utf8");
  const listens = (text.match(/\.listen\(/g) ?? []).length;
  if (listens !== 1) problems.push(`shell/host-server.ts: expected exactly one listen(, found ${listens}`);
}

if (problems.length) {
  console.error("Conformance check failed:");
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log("Conformance check passed.");

#!/usr/bin/env node
/** Mobile-safety static check (SC-015 / T114).
 *
 *  The mobile bundle must load without evaluating Node built-ins, spawning a
 *  process, opening a listener, or showing host-only UI. This cannot replace a
 *  real device smoke test (T118), but it fails fast on the regressions that
 *  would break the webview build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const srcRoot = join(root, "src");
const rel = (path) => relative(srcRoot, path).replaceAll("\\", "/");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const files = walk(srcRoot);
const problems = [];
const NODE_OK = new Set(["shell/local-transport.ts", "shell/host-server.ts"]);
const NODE_IMPORT = /from\s+["']node:(?:child_process|fs|path|http|stream|net|tls|os|crypto)["']/;
const SPAWN_OK = new Set(["shell/local-transport.ts"]);
const LISTEN_OK = new Set(["shell/host-server.ts"]);

for (const file of files) {
  const name = rel(file);
  const text = readFileSync(file, "utf8");
  if (NODE_IMPORT.test(text) && !NODE_OK.has(name)) problems.push(`${name}: static Node import on a mobile-reachable path`);
  if (/\bspawn\(/.test(text) && !SPAWN_OK.has(name)) problems.push(`${name}: spawn outside the desktop-gated transport`);
  if ((/\.listen\(/.test(text) || /createServer\(/.test(text)) && !LISTEN_OK.has(name)) {
    problems.push(`${name}: listener outside the desktop-gated host server`);
  }
  // `require("fs")`/`require("http")` style accesses must be lazy + gated.
  if (/require\(["'](?:fs|http|path|child_process)["']\)/.test(text) && !NODE_OK.has(name)) {
    problems.push(`${name}: eager require of a Node built-in`);
  }
}

function read(name) {
  return readFileSync(join(srcRoot, name), "utf8");
}

// Host mode must be desktop-gated at every entry point.
for (const [name, marker] of [
  ["shell/runtime.ts", "Platform.isDesktopApp"],
  ["shell/host-core.ts", "Platform.isDesktopApp"],
  ["main.ts", "Platform.isMobile"],
]) {
  if (!read(name).includes(marker)) problems.push(`${name}: missing ${marker} gate`);
}
// A paired-device/host UI must not appear on mobile.
if (!/Platform\.isDesktopApp/.test(read("settings.ts"))) problems.push("settings.ts: paired-device UI is not desktop-gated");
// The plugin must not auto-start a host process at load (single lazy spawn path).
if (/this\.startHost\s*\(/.test(read("main.ts"))) problems.push("main.ts: host started eagerly at load");

if (problems.length) {
  console.error("Mobile check failed:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`Mobile check passed (${files.length} runtime files; host/process paths desktop-gated).`);

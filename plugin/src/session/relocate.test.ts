import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RELOCATION_MARKER, relocateRecords } from "./relocate.ts";
import { FullPathAdapter, MemoryAdapter } from "./test-adapter.ts";
import { appDataRoot, vaultFolderName } from "../shell/node-store.ts";

async function vaultWithRecords() {
  const vault = new FullPathAdapter();
  await vault.write(".chat/sessions/s_a.jsonl", '{"kind":"header"}\n{"kind":"prompt"}\n');
  await vault.write(".chat/sessions/s_b.jsonl", '{"kind":"header"}\n');
  await vault.write(".chat/sessions/registry.json", '{"v":1}');
  await vault.write(".chat/sessions/notes.txt", "ignored");
  vault.dirs.add(".chat/sessions");
  return vault;
}

test("records and the registry are copied, verified, and marked; originals stay", async () => {
  const vault = await vaultWithRecords();
  const host = new MemoryAdapter();
  const report = await relocateRecords({ from: vault, fromFolder: ".chat/sessions", to: host, toFolder: "sessions", now: () => 1 });
  assert.deepEqual(report.copied.sort(), ["registry.json", "s_a.jsonl", "s_b.jsonl"]);
  assert.deepEqual(report.failed, []);
  assert.equal(host.files.get("sessions/s_a.jsonl"), '{"kind":"header"}\n{"kind":"prompt"}\n');
  assert.ok(host.files.has(`sessions/${RELOCATION_MARKER}`));
  assert.ok(!host.files.has("sessions/notes.txt"));
  assert.ok(vault.files.has(".chat/sessions/s_a.jsonl"), "originals are not removed");
});

test("relocation is idempotent and never overwrites a newer host record", async () => {
  const vault = await vaultWithRecords();
  const host = new MemoryAdapter();
  await host.write("sessions/s_a.jsonl", "newer");
  const first = await relocateRecords({ from: vault, fromFolder: ".chat/sessions", to: host, toFolder: "sessions" });
  assert.deepEqual(first.skipped, ["s_a.jsonl"]);
  assert.equal(host.files.get("sessions/s_a.jsonl"), "newer");
  const second = await relocateRecords({ from: vault, fromFolder: ".chat/sessions", to: host, toFolder: "sessions" });
  assert.equal(second.alreadyDone, true);
});

test("a failed copy leaves no marker so the next start retries", async () => {
  const vault = await vaultWithRecords();
  const host = new MemoryAdapter();
  const original = host.write.bind(host);
  host.write = async (path: string, data: string) => {
    if (path.endsWith("s_b.jsonl")) throw new Error("disk full");
    return original(path, data);
  };
  const report = await relocateRecords({ from: vault, fromFolder: ".chat/sessions", to: host, toFolder: "sessions" });
  assert.deepEqual(report.failed.map((f) => f.name), ["s_b.jsonl"]);
  assert.ok(!host.files.has(`sessions/${RELOCATION_MARKER}`));
});

test("a vault without old records just gets a marker", async () => {
  const report = await relocateRecords({ from: new MemoryAdapter(), fromFolder: ".chat/sessions", to: new MemoryAdapter(), toFolder: "sessions" });
  assert.deepEqual(report.copied, []);
});

test("app-data roots and vault folder names", () => {
  assert.equal(appDataRoot({ platform: "darwin", home: "/Users/a" }), "/Users/a/Library/Application Support");
  assert.equal(appDataRoot({ platform: "linux", home: "/home/a" }), "/home/a/.local/share");
  assert.equal(appDataRoot({ platform: "linux", home: "/home/a", xdgDataHome: "/x" }), "/x");
  assert.equal(appDataRoot({ platform: "win32", home: "C:/U/a", appData: "C:/U/a/AppData/Roaming" }), "C:/U/a/AppData/Roaming");
  assert.equal(vaultFolderName("My Vault", "/p", () => "abcdef1234"), "My Vault-abcdef12");
  assert.equal(vaultFolderName("../x", "/p", () => "00000000ff"), "..x-00000000");
});

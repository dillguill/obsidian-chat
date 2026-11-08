import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AcpFileEnvironment, type AcpFsTarget } from "./acp-fs.ts";
import type { PathPolicyConfig } from "./path-policy.ts";

const policy: PathPolicyConfig = {
  vaultRoot: "/vault",
  harnessRoot: "/vault",
  blacklist: ["Private"],
  protectedPrefixes: [".chat/sessions"],
};

/** In-memory stand-in for VaultService; counts unsafe I/O attempts. */
class FakeTarget implements AcpFsTarget {
  notes = new Map<string, string>([["Inbox/A.md", "line1\nline2\nline3"], ["Private/secret.md", "nope"]]);
  folders = new Set<string>();
  reads = 0;
  writes = 0;
  deletes = 0;
  failSnapshot = false;

  policy(): PathPolicyConfig {
    return policy;
  }
  async readText(relPath: string, options: { line?: number; limit?: number } = {}): Promise<string> {
    this.reads++;
    if (this.failSnapshot && relPath === "Inbox/A.md") throw new Error("read failed");
    const text = this.notes.get(relPath);
    if (text === undefined) throw new Error(`not found: ${relPath}`);
    if (options.line === undefined) return text;
    const lines = text.split("\n");
    const start = Math.max(0, options.line - 1);
    const count = options.limit ?? lines.length - start;
    return lines.slice(start, start + count).join("\n");
  }
  async writeText(relPath: string, content: string): Promise<void> {
    this.writes++;
    const parts = relPath.split("/").slice(0, -1);
    let built = "";
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      this.folders.add(built);
    }
    this.notes.set(relPath, content);
  }
  fileFor(relPath: string): { path: string } | null {
    return this.notes.has(relPath) ? { path: relPath } : null;
  }
  async deleteText(relPath: string): Promise<void> {
    this.deletes++;
    this.notes.delete(relPath);
  }
}

test("reads an existing note and honours the line window", async () => {
  const env = new AcpFileEnvironment(new FakeTarget());
  assert.equal(await env.readTextFile("/vault/Inbox/A.md"), "line1\nline2\nline3");
  assert.equal(await env.readTextFile("/vault/Inbox/A.md", 2, 1), "line2");
});

test("writes create missing parents and refresh through the target", async () => {
  const target = new FakeTarget();
  const env = new AcpFileEnvironment(target);
  await env.writeTextFile("/vault/Projects/New/Note.md", "hello");
  assert.equal(target.notes.get("Projects/New/Note.md"), "hello");
  assert.deepEqual([...target.folders], ["Projects", "Projects/New"]);

  await env.writeTextFile("/vault/Inbox/A.md", "replaced");
  assert.equal(target.notes.get("Inbox/A.md"), "replaced");
});

test("every unsafe path is refused without touching the vault", async () => {
  const target = new FakeTarget();
  const env = new AcpFileEnvironment(target);
  const unsafe = [
    "/etc/passwd",
    "/vault/../etc/passwd",
    "/vault/Inbox/../../etc",
    "relative/note.md",
    "/vault/Private/secret.md",
    "/vault/.obsidian/app.json",
    "/vault/.chat/sessions/s_1.jsonl",
  ];
  for (const path of unsafe) {
    await assert.rejects(() => env.readTextFile(path), /path refused/, path);
    await assert.rejects(() => env.writeTextFile(path, "x"), /path refused/, path);
  }
  assert.equal(target.reads, 0);
  assert.equal(target.writes, 0);
});

test("snapshots capture pre-write content and undo restores it", async () => {
  const target = new FakeTarget();
  const env = new AcpFileEnvironment(target);
  await env.snapshotBeforeWrite("/vault/Inbox/A.md");
  await env.writeTextFile("/vault/Inbox/A.md", "changed");
  const snapshot = env.snapshotFor("/vault/Inbox/A.md");
  assert.deepEqual(snapshot, { relPath: "Inbox/A.md", content: "line1\nline2\nline3" });

  await env.undo("/vault/Inbox/A.md");
  assert.equal(target.notes.get("Inbox/A.md"), "line1\nline2\nline3");
  assert.equal(env.snapshotFor("/vault/Inbox/A.md"), null);
});

test("a snapshot of a new note undoes by removing the file", async () => {
  const target = new FakeTarget();
  const env = new AcpFileEnvironment(target);
  await env.snapshotBeforeWrite("/vault/New/Note.md");
  await env.writeTextFile("/vault/New/Note.md", "created");
  assert.equal(env.lastSnapshot()?.content, null);
  await env.undoLast();
  assert.equal(target.notes.has("New/Note.md"), false);
  assert.equal(target.deletes, 1);
});

test("a failed snapshot does not block the write and does not offer a wrong undo", async () => {
  const target = new FakeTarget();
  target.failSnapshot = true;
  const env = new AcpFileEnvironment(target);
  await env.snapshotBeforeWrite("/vault/Inbox/A.md");
  await env.writeTextFile("/vault/Inbox/A.md", "still written");
  assert.equal(target.notes.get("Inbox/A.md"), "still written");
  assert.equal(env.snapshotFor("/vault/Inbox/A.md"), null);
  assert.equal(env.lastSnapshot(), null);
  await assert.rejects(() => env.undoLast(), /no snapshot/);
});

test("only the first snapshot per path is kept", async () => {
  const target = new FakeTarget();
  const env = new AcpFileEnvironment(target);
  await env.snapshotBeforeWrite("/vault/Inbox/A.md");
  await env.writeTextFile("/vault/Inbox/A.md", "v2");
  await env.snapshotBeforeWrite("/vault/Inbox/A.md");
  await env.writeTextFile("/vault/Inbox/A.md", "v3");
  assert.equal(env.lastSnapshot()?.content, "line1\nline2\nline3");
});

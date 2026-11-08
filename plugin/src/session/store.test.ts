import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SessionStore } from "./store.ts";
import { FullPathAdapter, MemoryAdapter, makePartialTail } from "./test-adapter.ts";

function header(now = 1_700_000_000_000) {
  return {
    deviceId: "d_host",
    commandLabel: "opencode acp",
    commandFingerprint: "fp_test",
    cwd: "/vault",
    protocolVersion: 1,
    capabilities: { loadSession: false, resume: false, mcpHttp: true },
    now,
  } as const;
}

test("createSession writes one header and appends assign monotonic sequence", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter);
  const id = await store.createSession({ ...header() });
  const entry = await store.append(id, {
    kind: "prompt",
    turn: 1,
    blocks: [{ type: "text", text: "hello" }],
  });
  assert.equal(entry.seq, 1);
  await store.append(id, {
    kind: "update",
    turn: 1,
    sessionUpdate: "agent_message_chunk",
    payload: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
  });
  const turn = await store.append(id, { kind: "turn", turn: 1, stopReason: "end_turn" });
  assert.equal(turn.seq, 3);
  const read = await store.read(id);
  assert.equal(read.header.sessionId, id);
  assert.deepEqual(read.entries.map((e) => e.kind), ["prompt", "update", "turn"]);
  assert.equal(read.degradedTail, false);
  assert.equal(read.malformedLines, 0);
});

test("append only grows the file and never rewrites earlier lines", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter);
  const id = await store.createSession({ ...header() });
  const path = `.chat/sessions/${id}.jsonl`;
  let previous = adapter.files.get(path)!.length;
  for (let i = 1; i <= 1000; i++) {
    await store.append(id, {
      kind: "update",
      turn: 1,
      sessionUpdate: "agent_message_chunk",
      payload: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: String(i) } },
    });
    const size = adapter.files.get(path)!.length;
    assert.ok(size > previous);
    previous = size;
  }
  const read = await store.read(id);
  assert.equal(read.entries.length, 1000);
  assert.equal(read.entries[999].seq, 1000);
});

test("malformed interior lines are skipped, the session survives, and the rest projects", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter);
  const id = await store.createSession({ ...header() });
  await store.append(id, { kind: "prompt", turn: 1, blocks: [] });
  const path = `.chat/sessions/${id}.jsonl`;
  adapter.files.set(path, adapter.files.get(path)! + "{ not json }\n");
  await store.append(id, { kind: "turn", turn: 1, stopReason: "end_turn" });
  const read = await store.read(id);
  assert.equal(read.entries.length, 2);
  assert.equal(read.malformedLines, 1);
  assert.deepEqual(read.entries.map((e) => e.kind), ["prompt", "turn"]);
});

test("a partial trailing line is ignored and isolated before the next append", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter);
  const id = await store.createSession({ ...header() });
  await store.append(id, { kind: "prompt", turn: 1, blocks: [] });
  const path = `.chat/sessions/${id}.jsonl`;
  makePartialTail(adapter, path);
  const first = await store.read(id);
  assert.equal(first.degradedTail, true);
  assert.equal(first.entries.length, 1);
  await store.append(id, { kind: "turn", turn: 1, stopReason: "end_turn" });
  const second = await store.read(id);
  assert.equal(second.entries.length, 2);
  assert.deepEqual(second.entries.map((e) => e.kind), ["prompt", "turn"]);
});

test("list derives summaries from headers and skips unreadable records", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter);
  const a = await store.createSession({ ...header(1_700_000_000_000) });
  const b = await store.createSession({ ...header(1_700_000_100_000) });
  adapter.files.set(".chat/sessions/s_bad.jsonl", "garbage\n");
  const list = await store.list();
  assert.deepEqual(list.map((s) => s.sessionId).sort(), [a, b].sort());
  assert.equal(list[0].header.updatedAt >= list[1].header.updatedAt, true);
});

test("oversized payloads are truncated explicitly, not dropped", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter);
  const id = await store.createSession({ ...header() });
  const huge = "x".repeat(300 * 1024);
  const stored = await store.append(id, {
    kind: "update",
    turn: 1,
    sessionUpdate: "tool_call",
    payload: huge,
  });
  assert.ok(stored.truncated);
  assert.ok(adapter.files.get(`.chat/sessions/${id}.jsonl`)!.length > 0);
});

test("list tolerates Obsidian's full-path adapter entries", async () => {
  const adapter = new FullPathAdapter();
  const store = new SessionStore(adapter);
  const id = await store.createSession({ ...header() });
  const list = await store.list();
  assert.deepEqual(list.map((session) => session.sessionId), [id]);
  const read = await store.read(id);
  assert.equal(read.header.sessionId, id);
});

test("a rejected append surfaces to the caller instead of pretending success", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter, ".chat/sessions");
  const id = await store.createSession({ ...header() });
  const path = `.chat/sessions/${id}.jsonl`;
  const original = adapter.append.bind(adapter);
  adapter.append = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    store.append(id, { kind: "prompt", turn: 1, blocks: [{ type: "text", text: "lost?" }] }),
    /disk full/,
  );
  adapter.append = original;
  const read = await store.read(id);
  assert.deepEqual(read.entries, [], "the failed write left the record intact");
  assert.ok((adapter.files.get(path) ?? "").includes('"kind":"header"'));
});

test("an externally deleted record disappears from the conversation list", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter, ".chat/sessions");
  const keep = await store.createSession({ ...header() });
  const remove = await store.createSession({ ...header() });
  assert.equal((await store.list()).length, 2);
  await store.delete(remove);
  const list = await store.list();
  assert.deepEqual(list.map((session) => session.sessionId), [keep]);
});

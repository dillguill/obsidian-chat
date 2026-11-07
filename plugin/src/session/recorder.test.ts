import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SessionStore } from "./store.ts";
import { SessionRecorder } from "./recorder.ts";
import { MemoryAdapter } from "./test-adapter.ts";

function makeRecorder(): { store: SessionStore; sessionId: string; recorder: SessionRecorder; adapter: MemoryAdapter } {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter);
  const sessionId = "s_test";
  return { store, sessionId, adapter, recorder: new SessionRecorder(store, sessionId) };
}

async function setup(): Promise<{ store: SessionStore; sessionId: string; recorder: SessionRecorder }> {
  const { store, adapter } = makeRecorder();
  const sessionId = await store.createSession({
    sessionId: "s_test",
    deviceId: "__local__",
    commandLabel: "opencode acp",
    commandFingerprint: "fp",
    cwd: "/vault",
    protocolVersion: 1,
    capabilities: { loadSession: false, resume: false, mcpHttp: true },
    now: 1,
  });
  return { store, sessionId, recorder: new SessionRecorder(store, sessionId) };
}

test("recorder appends prompt, update, turn and error entries without a view", async () => {
  const { store, sessionId, recorder } = await setup();
  await recorder.recordPrompt([{ type: "text", text: "hello" }]);
  await recorder.recordEvent({
    sessionId: "harness-session",
    turnNumber: 1,
    update: { type: "message", role: "agent", text: "hi" },
  });
  await recorder.recordEvent({ sessionId: "harness-session", turn: { number: 1, stopReason: "end_turn" } });
  await recorder.recordEvent({ sessionId: "harness-session", error: { message: "oops", scope: "harness" } });
  const read = await store.read(sessionId);
  assert.deepEqual(read.entries.map((e) => e.kind), ["prompt", "update", "turn", "error"]);
  assert.equal(read.entries[0].seq, 1);
  assert.equal(read.entries[3].seq, 4);
});

test("recording continues even when no listener/view is attached", async () => {
  const { store, sessionId, recorder } = await setup();
  await recorder.recordPrompt([{ type: "text", text: "first" }]);
  await recorder.recordEvent({
    sessionId: "harness-session",
    turnNumber: 1,
    update: { type: "message", role: "agent", text: "still recorded" },
  });
  const read = await store.read(sessionId);
  assert.equal(read.entries.length, 2);
  assert.equal((read.entries[1] as { payload?: { text?: string } }).payload?.text, "still recorded");
});

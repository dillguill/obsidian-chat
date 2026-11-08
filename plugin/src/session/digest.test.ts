/** T089: digest is deterministic, bounded, labelled, and record-only. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { RecordEntry, SessionHeader, UpdateEntry } from "./record.ts";
import {
  ASSISTANT_CHARS,
  buildDigest,
  buildFullReplay,
  DIGEST_CHARS,
  DIGEST_FIRST_LINE,
  digestBlock,
  ERROR_LIMIT,
  FILE_LIMIT,
  FULL_REPLAY_CHARS,
  TOOL_LINES,
  USER_CHARS,
} from "./digest.ts";

const header: SessionHeader = {
  kind: "header",
  v: 1,
  sessionId: "s_fixture",
  deviceId: "__local__",
  title: "Fixture conversation",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  lastSeq: 0,
  harness: {
    commandLabel: "harness",
    commandFingerprint: "fp",
    cwd: "/vault",
    protocolVersion: 1,
    capabilities: { loadSession: true, resume: true, mcpHttp: false },
  },
  harnessSessionId: "h_1",
  resume: { state: "resume-capable" },
};

let seq = 0;
function base(): { seq: number; ts: number; v: 1 } {
  seq += 1;
  return { seq, ts: 1_700_000_000_000 + seq, v: 1 };
}

function prompt(turn: number, text: string): RecordEntry {
  return { ...base(), kind: "prompt", turn, blocks: [{ type: "text", text }] } as RecordEntry;
}
function update(turn: number, payload: unknown): UpdateEntry {
  return { ...base(), kind: "update", turn, sessionUpdate: (payload as { sessionUpdate?: string }).sessionUpdate ?? "unknown", payload } as UpdateEntry;
}
function turn(turnNumber: number): RecordEntry {
  return { ...base(), kind: "turn", turn: turnNumber, stopReason: "end_turn" } as RecordEntry;
}

function fixture(turns = 2, options: { toolLines?: number; files?: number; errors?: number } = {}): RecordEntry[] {
  const entries: RecordEntry[] = [];
  for (let t = 1; t <= turns; t += 1) {
    entries.push(prompt(t, `question ${t}`));
    for (let tool = 0; tool < (options.toolLines ?? 1); tool += 1) {
      entries.push(update(t, {
        sessionUpdate: "tool_call",
        toolCallId: `tc_${t}_${tool}`,
        title: `Read note ${tool}`,
        kind: "read",
        status: "completed",
        locations: [{ path: `Inbox/note-${t}-${tool}.md` }],
        content: [{ type: "diff", path: `Inbox/diff-${t}-${tool}.md`, newText: "+x\n" }],
      }));
    }
    entries.push(update(t, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `answer ${t}` } }));
    entries.push(turn(t));
  }
  for (let e = 0; e < (options.errors ?? 0); e += 1) {
    entries.push({ ...base(), kind: "error", scope: "harness", message: `failure ${e} token=supersecret` } as RecordEntry);
  }
  return entries;
}

test("the digest is byte-identical for the same record", () => {
  const first = buildDigest({ header, entries: fixture() });
  const second = buildDigest({ header, entries: fixture() });
  assert.equal(first.text, second.text);
  assert.equal(first.hash, second.hash);
  assert.equal(first.chars, first.text.length);
});

test("the digest keeps only the last six complete turns and reports omissions", () => {
  const entries = fixture(9);
  const digest = buildDigest({ header, entries });
  assert.equal(digest.turnsIncluded, 6);
  assert.equal(digest.turnsOmitted, 3);
  assert.ok(digest.text.includes("3 earlier omitted"));
});

test("incomplete turns are not counted as digest turns", () => {
  const entries = fixture(2);
  // A third turn with a prompt but no turn boundary is still in flight.
  entries.push(prompt(3, "in flight"));
  const digest = buildDigest({ header, entries });
  assert.equal(digest.turnsIncluded, 2);
  assert.ok(!digest.text.includes("in flight"));
});

test("the digest is labelled, bounded and never includes credentials or image bytes", () => {
  const entries = fixture(2, { errors: 8 });
  entries.push(
    update(2, {
      sessionUpdate: "tool_call",
      toolCallId: "tc_img",
      title: "Image",
      content: [{ type: "content", content: { type: "image", mimeType: "image/png", data: "SECRET_IMAGE_BYTES" } }],
    }),
  );
  const digest = buildDigest({ header, entries });
  assert.ok(digest.text.startsWith(DIGEST_FIRST_LINE));
  assert.ok(!digest.text.includes("SECRET_IMAGE_BYTES"));
  assert.ok(!digest.text.includes("supersecret"));
  assert.ok(!digest.text.includes("Bearer "));
  assert.ok(digest.text.length <= DIGEST_CHARS);
  assert.ok(digest.text.endsWith("[end digest]") || digest.text.endsWith("[end digest; truncated]"));
  assert.ok(digest.text.split("\n").filter((line) => line.startsWith("Tool:")).length <= TOOL_LINES);
  assert.ok(digest.text.split("\n").filter((line) => line.startsWith("Error:")).length <= ERROR_LIMIT);
});

test("field caps are applied to very long user/assistant text", () => {
  const entries: RecordEntry[] = [];
  entries.push(prompt(1, "u".repeat(USER_CHARS * 3)));
  entries.push(update(1, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a".repeat(ASSISTANT_CHARS * 3) } }));
  entries.push(turn(1));
  const digest = buildDigest({ header, entries });
  const userLine = digest.text.split("\n").find((line) => line.startsWith("User: "))!;
  const assistantLine = digest.text.split("\n").find((line) => line.startsWith("Assistant: "))!;
  assert.ok(userLine.length <= "User: ".length + USER_CHARS);
  assert.ok(assistantLine.length <= "Assistant: ".length + ASSISTANT_CHARS);
  assert.equal(digest.truncated, true);
});

test("files touched are deduped and capped", () => {
  const entries: RecordEntry[] = [];
  for (let index = 0; index < FILE_LIMIT + 10; index += 1) {
    entries.push(update(1, {
      sessionUpdate: "tool_call",
      toolCallId: `tc_${index}`,
      title: "Edit",
      kind: "edit",
      locations: [{ path: `Inbox/file-${index}.md` }],
    }));
  }
  entries.push(prompt(1, "go"));
  entries.push(turn(1));
  const digest = buildDigest({ header, entries });
  const fileLine = digest.text.split("\n").find((line) => line.startsWith("Files touched: "))!;
  assert.equal(fileLine.split(", ").length, FILE_LIMIT);
});

test("the hard cap is enforced with an explicit truncation marker", () => {
  const entries: RecordEntry[] = [];
  for (let t = 1; t <= 6; t += 1) {
    entries.push(prompt(t, "u".repeat(USER_CHARS)));
    entries.push(update(t, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a".repeat(ASSISTANT_CHARS) } }));
    entries.push(turn(t));
  }
  const digest = buildDigest({ header, entries });
  assert.ok(digest.text.length <= DIGEST_CHARS);
  assert.ok(digest.text.endsWith("[end digest; truncated]"));
});

test("the digest is one labelled content block, and full replay has its own label/cap", () => {
  const block = digestBlock(DIGEST_FIRST_LINE);
  assert.deepEqual(block, { type: "text", text: DIGEST_FIRST_LINE });
  const replay = buildFullReplay({ header, entries: fixture(2) });
  assert.ok(replay.text.includes("Full transcript replay"));
  assert.ok(replay.text.length <= FULL_REPLAY_CHARS);
});

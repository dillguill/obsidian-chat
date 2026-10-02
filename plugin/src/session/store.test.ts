/** Round-trip tests for session-note persistence (P0).
 *
 *  The note is the only durable record of a conversation, so `renderBody` →
 *  `parseSessionNote` must be lossless for everything the UI needs to rebuild
 *  a transcript. Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "../chat/types.ts";
import { renderBody, parseSessionNote, parseSessionMeta, metaToFrontmatter } from "./store.ts";

function roundTrip(messages: ChatMessage[]): ChatMessage[] {
  return parseSessionNote(renderBody("Chat session", messages));
}

test("round-trips a simple user/assistant exchange", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
  ];
  assert.deepEqual(roundTrip(messages), messages);
});

// ---------- legacy notes (written before the canonical block existed) ----------

/** A note exactly as the pre-P0 `renderBody` emitted it: prose only. */
function legacyNote(sections: string): string {
  return `# Chat session\n\n${sections}`;
}

test("parses a legacy note that has no canonical block", () => {
  const body = legacyNote(
    "## 👤 User (2026-09-15 10:00:00)\n\nhello\n\n" +
      "## 🤖 Assistant (2026-09-15 10:00:01)\n\nhi there\n",
  );
  assert.deepEqual(parseSessionNote(body), [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
  ]);
});

test("keeps markdown headings inside a legacy assistant reply", () => {
  const reply = "Here is the plan.\n\n## Summary\n\nDo the thing.\n\n### Details\n\nCarefully.";
  const body = legacyNote(`## 🤖 Assistant (2026-09-15 10:00:01)\n\n${reply}\n`);
  assert.deepEqual(parseSessionNote(body), [{ role: "assistant", content: reply }]);
});

test("does not mistake prose mentioning a role for a legacy role heading", () => {
  const reply = "Compare the two:\n\n## Assistant behaviour\n\nIt replies.";
  const body = legacyNote(`## 🤖 Assistant (2026-09-15 10:00:01)\n\n${reply}\n`);
  assert.deepEqual(parseSessionNote(body), [{ role: "assistant", content: reply }]);
});

// ---------- reasoning, activity, images ----------

const ACTIVITY = {
  id: "t1",
  rawName: "vault_vault_read",
  name: "read",
  verb: "Read",
  label: "Note.md",
  target: "Note.md",
  isPath: true,
  status: "completed" as const,
  startedAt: 1_700_000_000_000,
};

test("round-trips reasoning bursts and tool activity", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "read my note" },
    {
      role: "assistant",
      content: "Done.",
      reasoning: [{ text: "I should read it", durationSeconds: 3 }],
      activity: [ACTIVITY],
    },
  ];
  assert.deepEqual(roundTrip(messages), messages);
});

test("recovers reasoning and activity from a legacy note", () => {
  const messages: ChatMessage[] = [
    {
      role: "assistant",
      content: "Done.",
      reasoning: [{ text: "I should read it", durationSeconds: 3 }],
      activity: [ACTIVITY],
    },
  ];
  // Strip the canonical block to force the prose path.
  const legacy = renderBody("Chat session", messages).replace(/<!-- oc-transcript-b64: .* -->/, "");
  assert.deepEqual(parseSessionNote(legacy), messages);
});

test("a legacy turn with no tool calls does not inherit the next turn's activity", () => {
  const messages: ChatMessage[] = [
    { role: "assistant", content: "Just talking." },
    { role: "assistant", content: "Now working.", activity: [ACTIVITY] },
  ];
  const legacy = renderBody("Chat session", messages).replace(/<!-- oc-transcript-b64: .* -->/, "");
  assert.deepEqual(parseSessionNote(legacy), messages);
});

test("keeps image names but never writes image data into the note", () => {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: "what is this?",
      images: [{ dataUrl: "data:image/png;base64,AAAASECRETAAAA", mediaType: "image/png", name: "shot.png" }],
    },
  ];
  const body = renderBody("Chat session", messages);
  assert.ok(!body.includes("AAAASECRETAAAA"), "note must not embed image data");
  assert.deepEqual(parseSessionNote(body), [
    { role: "user", content: "what is this?", images: [{ dataUrl: "", mediaType: "image/png", name: "shot.png" }] },
  ]);
});

// ---------- frontmatter ----------

test("reads back the metadata it wrote, so created survives a re-save", () => {
  const meta = { created: 1_700_000_000_000, updated: 1_700_000_500_000, tokens: 42 };
  const body = metaToFrontmatter(meta) + "\n" + renderBody("Chat session", []);
  assert.deepEqual(parseSessionMeta(body), meta);
});

test("reports no metadata for a note without frontmatter", () => {
  assert.equal(parseSessionMeta(renderBody("Chat session", [])), null);
});

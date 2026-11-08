import test from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, effectiveTitle, isPlaceholderTitle, lastActivity } from "./title.ts";
import type { RecordEntry } from "./record.ts";

const entry = (seq: number, fields: Record<string, unknown>): RecordEntry => ({ seq, ts: 1000 + seq, v: 1, ...fields }) as unknown as RecordEntry;
const prompt = (seq: number, text: string, context?: string) =>
  entry(seq, {
    kind: "prompt",
    blocks: [
      ...(context ? [{ type: "text", text: `### Context: ${context}\n\nbody`, _meta: { "obsidian-chat/context": context } }] : []),
      { type: "text", text },
    ],
  });

test("first typed prompt names a placeholder-titled conversation, ignoring attached context", () => {
  const title = effectiveTitle({ title: "ACP session" }, [prompt(1, "Summarize   my week\nplease", "AGENTS.md"), prompt(2, "second")]);
  assert.equal(title, "Summarize my week please");
});

test("harness session_info title beats the first prompt; a user rename beats both", () => {
  const info = entry(3, { kind: "update", sessionUpdate: "session_info_update", payload: { sessionUpdate: "session_info_update", title: "Weekly review" } });
  assert.equal(effectiveTitle({ title: "ACP session" }, [prompt(1, "hi"), info]), "Weekly review");
  const rename = entry(4, { kind: "meta", title: "My name", source: "user" });
  const laterInfo = entry(5, { kind: "update", sessionUpdate: "session_info_update", payload: { title: "Harness again" } });
  assert.equal(effectiveTitle({ title: "ACP session" }, [prompt(1, "hi"), info, rename, laterInfo]), "My name");
});

test("a real header title is kept; an empty record has no title", () => {
  assert.equal(effectiveTitle({ title: "Imported chat" }, [prompt(1, "hi")]), "Imported chat");
  assert.equal(effectiveTitle({ title: "ACP session" }, []), null);
  assert.equal(isPlaceholderTitle("New chat"), true);
});

test("last activity uses the newest entry time; titles are cleaned", () => {
  assert.equal(lastActivity({ updatedAt: 5 }, [prompt(1, "a"), prompt(7, "b")]), 1007);
  assert.equal(cleanTitle("  a\n  b  "), "a b");
  assert.equal(cleanTitle("   "), null);
  assert.equal(cleanTitle("x".repeat(500))!.length, 120);
});

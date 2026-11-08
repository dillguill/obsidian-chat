/** T078: the renderer is generic — ACP fields verbatim, every content variant,
 *  unknown kinds raw, no tool-name dictionary. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ToolCallView } from "../acp/types.ts";
import { activityPresentation, mergeToolCall, promptDisplay, TOOL_KIND_ICONS, toolCardModel, toolDetail } from "./renderer.ts";

function call(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: "tc_1",
    title: "Read note",
    name: "read_note",
    kind: "read",
    status: "completed",
    content: [],
    locations: [],
    ...overrides,
  };
}

test("tool card keeps the harness title verbatim", () => {
  assert.equal(toolCardModel(call({ title: "Read note — Inbox/demo.md" })).title, "Read note — Inbox/demo.md");
});

test("missing title falls back to the programmatic name, then the kind", () => {
  const withoutTitle = call();
  delete withoutTitle.title;
  assert.equal(toolCardModel(withoutTitle).title, "read_note");
  delete withoutTitle.name;
  assert.equal(toolCardModel(withoutTitle).title, "read");
});

test("kind/status/late and duration are carried through", () => {
  const model = toolCardModel(call({ status: "completed", late: true }), Date.now() - 1500);
  assert.equal(model.kind, "read");
  assert.equal(model.status, "completed");
  assert.equal(model.late, true);
  assert.ok(model.durationText?.includes("s"));
});

test("every content variant is preserved, none dropped", () => {
  const content = [
    { type: "text" as const, text: "hello" },
    { type: "diff" as const, path: "Inbox/a.md", newText: "+a\n" },
    { type: "terminal" as const, terminalId: "term_1" },
    { type: "image" as const, mimeType: "image/png", data: "abc" },
    { type: "audio" as const, mimeType: "audio/wav", data: "abc" },
    { type: "resource_link" as const, uri: "file:///vault/a.md", name: "a.md" },
    { type: "resource" as const, uri: "file:///vault/b.md", text: "body" },
    { type: "unknown" as const, raw: { future: true } },
  ];
  const model = toolCardModel(call({ content }));
  assert.deepEqual(model.content.map((entry) => entry.type), content.map((entry) => entry.type));
});

test("locations and raw input/output are carried, with bounded raw display", () => {
  const huge = "x".repeat(40_000);
  const model = toolCardModel(call({
    locations: [{ path: "/vault/Inbox/a.md", line: 4 }],
    rawInput: { path: "Inbox/a.md" },
    rawOutput: { text: huge },
  }));
  assert.deepEqual(model.locations, [{ path: "/vault/Inbox/a.md", line: 4 }]);
  assert.equal(model.rawInput?.truncated, false);
  assert.equal(model.rawOutput?.truncated, true);
  assert.ok(model.rawOutput!.text.includes("truncated"));
});

test("icons come only from ACP's fixed ToolKind enum, not tool names", () => {
  assert.deepEqual(
    Object.keys(TOOL_KIND_ICONS).sort(),
    ["delete", "edit", "execute", "fetch", "move", "other", "read", "search", "think"],
  );
  assert.equal(TOOL_KIND_ICONS["read_note"], undefined, "no tool-name dictionary");
});

test("activity presentation is chronological unless explicitly grouped", () => {
  assert.equal(activityPresentation(undefined), "chronological");
  assert.equal(activityPresentation("chronological"), "chronological");
  assert.equal(activityPresentation("grouped"), "grouped");
  assert.equal(activityPresentation("anything-else"), "chronological");
});

test("a partial tool_call_update keeps the title, kind and input it omits", () => {
  const first = call({ title: "glob", kind: "search", status: "in_progress", rawInput: { pattern: "*/*" } });
  const update: ToolCallView = { toolCallId: "tc_1", status: "completed", content: [{ type: "text", text: "a\nb" }] };
  const merged = mergeToolCall(first, update);
  assert.equal(merged.title, "glob");
  assert.equal(merged.kind, "search");
  assert.deepEqual(merged.rawInput, { pattern: "*/*" });
  assert.equal(merged.status, "completed");
  assert.equal(merged.content?.length, 1);
});

test("tool detail prefers a location, else the first primitive inputs", () => {
  assert.equal(toolDetail(call({ locations: [{ path: "Inbox/a.md", line: 3 }] })), "Inbox/a.md:3");
  assert.equal(toolDetail(call({ locations: [], rawInput: { pattern: "*/*", limit: 5, nested: { x: 1 } } })), "*/* · 5");
  assert.equal(toolDetail(call({ locations: [], rawInput: undefined })), "");
});

test("prompt display shows only typed text; context is labelled", () => {
  const tagged = promptDisplay([
    { type: "text", text: "### AGENTS.md\n\nrules…", _meta: { "obsidian-chat/context": "AGENTS.md" } },
    { type: "text", text: "hello" },
    { type: "image", mimeType: "image/png", data: "" },
  ]);
  assert.deepEqual(tagged, { text: "hello", context: ["AGENTS"], images: 1 });
  const legacy = promptDisplay([
    { type: "text", text: "### Vault rules: AGENTS.md\n\n# Rules\n\n---\n\nmore\n\n---\n\ntest" },
  ]);
  assert.deepEqual(legacy, { text: "test", context: ["AGENTS"], images: 0 });
  assert.equal(promptDisplay([{ type: "text", text: "a --- b" }]).text, "a --- b");
});

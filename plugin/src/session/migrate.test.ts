/** T105: lossless, idempotent import of legacy Markdown conversations. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { metaToFrontmatter, renderBody, type LegacyMessage } from "../../test/fixtures/legacy-note.ts";
import { importLegacySessions, legacyMessages, looksLikeLegacyConversation, type LegacyNote } from "./migrate.ts";
import { SessionStore } from "./store.ts";
import { FullPathAdapter, MemoryAdapter } from "./test-adapter.ts";

const messages: LegacyMessage[] = [
  { role: "user", content: "first question" },
  {
    role: "assistant",
    content: "first answer",
    reasoning: [{ text: "thinking it through", durationSeconds: 2 }],
    activity: [
      {
        id: "t1",
        rawName: "read",
        name: "read",
        verb: "Read",
        label: "note.md",
        isPath: true,
        status: "completed",
        startedAt: 1,
      },
    ],
  },
  { role: "user", content: "second question" },
  { role: "assistant", content: "second answer" },
];

function canonicalNote(): string {
  const meta = { created: 1_700_000_000_000, updated: 1_700_000_100_000, tokens: 12, title: "Old chat" };
  return metaToFrontmatter(meta) + renderBody("Old chat", messages);
}

function store(): { store: SessionStore; adapter: MemoryAdapter } {
  const adapter = new MemoryAdapter();
  return { store: new SessionStore(adapter, ".chat/sessions"), adapter };
}

function note(path: string, text: string): LegacyNote {
  return { path, text, mtime: 1_700_000_000_000 };
}

test("a canonical legacy note imports losslessly with provenance", async () => {
  const { store: sessionStore } = store();
  // The note can live anywhere in the vault: discovery is content-based, not
  // folder-based (there is no note-folder setting).
  const report = await importLegacySessions({ store: sessionStore, notes: [note("Journal/older chat.md", canonicalNote())] });
  assert.equal(report.imported, 1);
  assert.equal(report.alreadyImported, 0);
  const sessions = await sessionStore.list();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].header.origin, "legacy_import");
  assert.equal(sessions[0].header.title, "Old chat");
  assert.equal(sessions[0].header.provenance?.originPath, "Journal/older chat.md");
  assert.equal(sessions[0].header.harnessSessionId, null);
  const read = await sessionStore.read(sessions[0].header.sessionId);
  const prompts = read.entries.filter((entry) => entry.kind === "prompt");
  assert.equal(prompts.length, 2);
  assert.ok(read.entries.every((entry) => entry.origin === "legacy_import"));
  const promptTexts = read.entries
    .filter((entry) => entry.kind === "prompt")
    .map((entry) => ((entry as { blocks?: Array<{ text?: string }> }).blocks ?? []).map((block) => block.text ?? "").join(""));
  assert.deepEqual(promptTexts, ["first question", "second question"]);
  const payloads = read.entries
    .filter((entry) => entry.kind === "update")
    .map((entry) => (entry as { payload?: { type?: string; text?: string } }).payload);
  const answers = payloads.filter((payload) => payload?.type === "message").map((payload) => payload!.text);
  assert.deepEqual(answers, ["first answer", "second answer"]);
  assert.ok(payloads.some((payload) => payload?.type === "thought" && /thinking it through/.test(payload.text ?? "")));
});

test("an older prose-only note imports through the fallback parser", async () => {
  const prose = [
    "# Old chat",
    "",
    "## 👤 User (2024-01-01 10:00:00)",
    "",
    "hello from the old note",
    "",
    "## 🤖 Assistant (2024-01-01 10:00:01)",
    "",
    "and the old answer",
    "",
  ].join("\n");
  const { store: sessionStore } = store();
  const report = await importLegacySessions({ store: sessionStore, notes: [note("chat/prose.md", prose)] });
  assert.equal(report.imported, 1);
  const [summary] = await sessionStore.list();
  const read = await sessionStore.read(summary.header.sessionId);
  const prompt = read.entries.find((entry) => entry.kind === "prompt") as { blocks?: Array<{ text?: string }> } | undefined;
  assert.equal(prompt?.blocks?.[0].text, "hello from the old note");
  const answer = read.entries
    .filter((entry) => entry.kind === "update")
    .map((entry) => (entry as { payload?: { type?: string; text?: string } }).payload)
    .find((payload) => payload?.type === "message");
  assert.equal(answer?.text, "and the old answer");
});

test("importing twice is idempotent and never rewrites the record", async () => {
  const { store: sessionStore, adapter } = store();
  const notes = [note("chat/old.md", canonicalNote())];
  const first = await importLegacySessions({ store: sessionStore, notes });
  assert.equal(first.imported, 1);
  const path = `.chat/sessions/${(await sessionStore.list())[0].header.sessionId}.jsonl`;
  const before = adapter.files.get(path);
  const second = await importLegacySessions({ store: sessionStore, notes });
  assert.equal(second.imported, 0);
  assert.equal(second.alreadyImported, 1);
  assert.equal((await sessionStore.list()).length, 1);
  assert.equal(adapter.files.get(path), before, "the existing record is untouched");
});

test("non-session Markdown and empty notes are skipped with a report, never fabricated", async () => {
  const { store: sessionStore } = store();
  const report = await importLegacySessions({
    store: sessionStore,
    notes: [
      note("chat/notes.md", "# Meeting notes\n\njust some Markdown"),
      note(
        "chat/empty.md",
        metaToFrontmatter({ created: 1, updated: 2, tokens: 0, title: "Empty" }) + renderBody("Empty", []),
      ),
    ],
  });
  assert.equal(report.imported, 0);
  assert.equal((await sessionStore.list()).length, 0);
  assert.deepEqual(
    report.skipped.map((entry) => entry.reason).sort(),
    ["no conversation content", "not a session note"],
  );
});

test("legacyMessages exposes the parsed conversation model", () => {
  const restored = legacyMessages(canonicalNote());
  assert.equal(restored.length, messages.length);
  assert.equal(restored[2].content, "second question");
});

test("idempotency still holds when the adapter lists full vault-relative paths", async () => {
  // Regression: Obsidian's DataAdapter.list returns "folder/file.jsonl"; the
  // store must still see its own records so a second import cannot duplicate.
  const adapter = new FullPathAdapter();
  const sessionStore = new SessionStore(adapter, ".chat/sessions");
  const notes = [note("chat/old.md", canonicalNote())];
  const first = await importLegacySessions({ store: sessionStore, notes });
  assert.equal(first.imported, 1);
  const second = await importLegacySessions({ store: sessionStore, notes });
  assert.equal(second.imported, 0);
  assert.equal(second.alreadyImported, 1);
  assert.equal((await sessionStore.list()).length, 1);
});

test("the vault discovery signature recognizes legacy conversations and ignores normal notes", () => {
  assert.equal(looksLikeLegacyConversation(canonicalNote()), true, "canonical marker");
  assert.equal(
    looksLikeLegacyConversation("## 👤 User (2024-01-01 10:00:00)\n\nhi"),
    true,
    "prose role heading",
  );
  assert.equal(looksLikeLegacyConversation("# Meeting notes\n\nno conversation here"), false);
});

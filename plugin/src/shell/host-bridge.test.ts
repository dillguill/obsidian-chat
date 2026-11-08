/** Stored-conversation replay: a session that is not live right now (previous
 *  run, imported legacy note, dead harness) must still be browsable through
 *  standard `session/load`, and ownership must still be enforced. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AgentContext } from "@agentclientprotocol/sdk";
import { metaToFrontmatter, renderBody, type LegacyMessage } from "../../test/fixtures/legacy-note.ts";
import { importLegacySessions } from "../session/migrate.ts";
import { SessionStore } from "../session/store.ts";
import { MemoryAdapter } from "../session/test-adapter.ts";
import { HostBridge } from "./host-bridge.ts";
import { fingerprint } from "./identity.ts";
import { DIGEST_FIRST_LINE } from "../session/digest.ts";

const messages: LegacyMessage[] = [
  { role: "user", content: "old question" },
  { role: "assistant", content: "old answer" },
];

function legacyNote(): string {
  return (
    metaToFrontmatter({ created: 1_700_000_000_000, updated: 1_700_000_001_000, tokens: 3, title: "Old note" }) +
    renderBody("Old note", messages)
  );
}

function bridgeFor(): { bridge: HostBridge; store: SessionStore; sessionId: string; notifications: Array<Record<string, unknown>>; adapter: MemoryAdapter } {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter, ".chat/sessions");
  const notifications: Array<Record<string, unknown>> = [];
  const bridge = new HostBridge({
    store: () => store,
    ensureHarness: async () => {
      throw new Error("no harness in this test");
    },
    harness: () => null,
    vaultRoot: () => "/vault",
    command: () => ({ label: "test", fingerprint: fingerprint("test acp", "/vault"), command: "test acp" }),
    mcpEntry: () => null,
  });
  const context = {
    notify: async (_method: string, params: Record<string, unknown>) => {
      notifications.push(params);
    },
    request: async () => {
      throw new Error("no requests in this test");
    },
  } as unknown as AgentContext;
  bridge.bindDevice("__local__", context);
  return { bridge, store, sessionId: "", notifications, adapter };
}

test("a stored conversation that is not live replays through session/load", async () => {
  const { bridge, store, notifications } = bridgeFor();
  const report = await importLegacySessions({
    store,
    notes: [{ path: "chat/old.md", text: legacyNote(), mtime: 1_700_000_000_000 }],
  });
  assert.equal(report.imported, 1);
  const sessionId = report.importedSessions[0].sessionId;

  const response = await bridge.loadSession("__local__", { sessionId, cwd: "/vault" } as never);
  assert.equal(response.modes, null, "a detached session has no live mode state");
  assert.equal(response.configOptions, null);

  const updates = notifications.map((params) => (params.update as { sessionUpdate?: string }).sessionUpdate);
  assert.ok(updates.includes("user_message_chunk"), "the old user turn is replayed");
  assert.ok(updates.includes("agent_message_chunk"), "the old agent turn is replayed");
  assert.ok(
    notifications.every((params) => (params._meta as Record<string, unknown>)?.["obsidian-chat/replay"] === true),
    "replayed notifications are marked as replay",
  );
  assert.ok(
    notifications.every((params) => typeof (params._meta as Record<string, unknown>)?.["obsidian-chat/seq"] === "number"),
    "replayed notifications carry their record sequence",
  );
});

test("a stored conversation is only loadable by the device that owns it", async () => {
  const { bridge, store } = bridgeFor();
  const report = await importLegacySessions({
    store,
    notes: [{ path: "chat/old.md", text: legacyNote(), mtime: 1_700_000_000_000 }],
  });
  const sessionId = report.importedSessions[0].sessionId;
  await assert.rejects(
    bridge.loadSession("phone", { sessionId, cwd: "/vault" } as never),
    /not owned by this device/,
  );
});

test("session/list reports stored conversations even when their harness is gone", async () => {
  const { bridge, store } = bridgeFor();
  await importLegacySessions({
    store,
    notes: [{ path: "chat/old.md", text: legacyNote(), mtime: 1_700_000_000_000 }],
  });
  const list = await bridge.listSessions("__local__");
  assert.equal(list.sessions.length, 1);
  assert.equal(list.sessions[0].title, "Old note");
  assert.equal((list.sessions[0]._meta as Record<string, unknown>)["obsidian-chat/resume"], "fresh-only");
});


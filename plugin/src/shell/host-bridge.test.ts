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

test("a stored conversation started on the desktop opens from a paired device too", async () => {
  const { bridge, store } = bridgeFor();
  const report = await importLegacySessions({
    store,
    notes: [{ path: "chat/old.md", text: legacyNote(), mtime: 1_700_000_000_000 }],
  });
  const sessionId = report.importedSessions[0].sessionId;
  const listed = await bridge.listSessions("phone");
  assert.equal(listed.sessions.length, 1);
  assert.equal((listed.sessions[0]._meta as Record<string, unknown>)["obsidian-chat/device"], "Desktop");
  await bridge.loadSession("phone", { sessionId, cwd: "/vault" } as never);
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


// ---------- redesign item 6: MCP write approvals route to the owning device ----------

function bridgeWithHarness(answer: string | null) {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter, ".chat/sessions");
  const keys: string[] = [];
  const harness = {
    onRawUpdate: () => undefined,
    onRawPermissionRequest: () => undefined,
    getCapabilitiesSnapshot: () => ({ loadSession: false, resume: false, mcpHttp: true }),
    createSession: async () => ({ sessionId: "harness-1", modes: null, configOptions: null }),
  };
  const bridge = new HostBridge({
    store: () => store,
    ensureHarness: async () => harness as never,
    harness: () => harness as never,
    vaultRoot: () => "/vault",
    command: () => ({ label: "test", fingerprint: fingerprint("test acp", "/vault"), command: "test acp" }),
    mcpEntry: (key) => {
      keys.push(key);
      return { name: "vault", type: "http", url: "http://127.0.0.1:1/mcp", headers: [] } as never;
    },
  });
  const asked: Array<Record<string, unknown>> = [];
  const context = {
    notify: async () => undefined,
    request: async (_method: string, params: Record<string, unknown>) => {
      asked.push(params);
      if (answer === null) throw new Error("device went away");
      return { outcome: { outcome: "selected", optionId: answer } };
    },
  } as unknown as AgentContext;
  bridge.bindDevice("phone", context);
  return { bridge, keys, asked, store };
}

const change = { tool: "write_note", path: "Inbox/a.md", oldText: null, newText: "hi" };

test("a vault write approval goes to the device that owns the session, with the diff", async () => {
  const { bridge, keys, asked } = bridgeWithHarness("allow");
  const { sessionId } = await bridge.newSession("phone", { cwd: "/vault", mcpServers: [] } as never);
  assert.equal(keys.length, 1, "the harness got a per-session MCP key");
  assert.equal(await bridge.approveVaultChange(keys[0], change), true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].sessionId, sessionId);
  const toolCall = asked[0].toolCall as { content: Array<Record<string, unknown>> };
  assert.deepEqual(toolCall.content[0], { type: "diff", path: "Inbox/a.md", oldText: null, newText: "hi" });
});

test("reject, a lost device, or an unknown session key all decline", async () => {
  const rejected = bridgeWithHarness("reject");
  await rejected.bridge.newSession("phone", { cwd: "/vault", mcpServers: [] } as never);
  assert.equal(await rejected.bridge.approveVaultChange(rejected.keys[0], change), false);

  const gone = bridgeWithHarness(null);
  await gone.bridge.newSession("phone", { cwd: "/vault", mcpServers: [] } as never);
  assert.equal(await gone.bridge.approveVaultChange(gone.keys[0], change), false);

  assert.equal(await gone.bridge.approveVaultChange("not-a-key", change), false);
});

test("only the device in control flips web access; fetch approvals show the URL", async () => {
  const { bridge, keys, asked } = bridgeWithHarness("allow");
  const { sessionId } = await bridge.newSession("phone", { cwd: "/vault", mcpServers: [] } as never);
  assert.equal(bridge.webEnabledForKey(keys[0]), false, "off by default");
  await assert.rejects(bridge.setWeb("lenovo", { sessionId, enabled: true }));
  assert.deepEqual(await bridge.setWeb("phone", { sessionId, enabled: true }), { enabled: true });
  assert.equal(bridge.webEnabledForKey(keys[0]), true);
  assert.equal(await bridge.approveWebFetch(keys[0], "https://example.com/x"), true);
  const toolCall = asked[0].toolCall as { title: string };
  assert.equal(toolCall.title, "Fetch https://example.com/x");
  const options = asked[0].options as Array<{ optionId: string; kind: string }>;
  assert.deepEqual(options.map((o) => o.optionId), ["allow", "allow-conversation", "reject"]);
  await bridge.setWeb("phone", { sessionId, enabled: false });
  assert.equal(bridge.webEnabledForKey(keys[0]), false);
});

test("'Allow in this conversation' skips later cards for that conversation only, until web is turned off", async () => {
  const { bridge, keys, asked } = bridgeWithHarness("allow-conversation");
  const a = await bridge.newSession("phone", { cwd: "/vault", mcpServers: [] } as never);
  const b = await bridge.newSession("phone", { cwd: "/vault", mcpServers: [] } as never);
  await bridge.setWeb("phone", { sessionId: a.sessionId, enabled: true });
  assert.equal(await bridge.approveWebFetch(keys[0], "https://example.com/1"), true);
  assert.equal(await bridge.approveWebFetch(keys[0], "https://example.com/2"), true);
  assert.equal(asked.length, 1, "asked once for conversation A");
  await bridge.approveWebFetch(keys[1], "https://example.com/3");
  assert.equal(asked.length, 2, "conversation B still asks");
  await bridge.setWeb("phone", { sessionId: a.sessionId, enabled: false });
  await bridge.setWeb("phone", { sessionId: a.sessionId, enabled: true });
  await bridge.approveWebFetch(keys[0], "https://example.com/4");
  assert.equal(asked.length, 3, "turning web off resets the allowance");
  void b;
});

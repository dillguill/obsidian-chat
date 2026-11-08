/** US4: approvals are routed only to the device that owns the session, never
 *  auto-answered, and cancelled when the device goes away (FR-034/FR-035/FR-036).
 *
 *  Two layers are exercised:
 *  - HostRelay binds each authenticated WebSocket to its own device context.
 *  - HostBridge (the real routing implementation) forwards a harness permission
 *    request to the owning device only and returns its exact optionId.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { methods, type AgentContext, type RequestPermissionRequest, type RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { AcpShellClient } from "./acp-client.ts";
import { HostBridge } from "./host-bridge.ts";
import { AcpShellClient as ShellClient } from "./acp-client.ts";
import { RemoteTransportConnector } from "./remote-transport.ts";
import { SessionStore } from "../session/store.ts";
import { MemoryAdapter } from "../session/test-adapter.ts";
import { startTestHost } from "../../test/fixtures/fake-relay.ts";
import { metaToFrontmatter, renderBody, type LegacyMessage } from "../../test/fixtures/legacy-note.ts";
import { importLegacySessions } from "../session/migrate.ts";
import { DIGEST_FIRST_LINE } from "../session/digest.ts";
import { fingerprint } from "./identity.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition timed out");
    await delay(5);
  }
}

class FakeContext {
  requests: Array<{ method: string; params: unknown }> = [];
  notifications: Array<{ method: string; params: unknown }> = [];
  private pending: Array<(response: RequestPermissionResponse) => void> = [];

  readonly context = {
    request: (method: string, params: unknown) => {
      this.requests.push({ method, params });
      return new Promise<RequestPermissionResponse>((resolve) => this.pending.push(resolve));
    },
    notify: async (method: string, params: unknown) => {
      this.notifications.push({ method, params });
    },
  } as unknown as AgentContext;

  /** Answers the oldest pending request (the user's choice). */
  respond(response: RequestPermissionResponse): void {
    const resolve = this.pending.shift();
    if (!resolve) throw new Error("no pending request to answer");
    resolve(response);
  }

  permissionRequests(): Array<{ sessionId: string; options: Array<{ optionId: string }> }> {
    return this.requests
      .filter((request) => request.method === methods.client.session.requestPermission)
      .map((request) => request.params as { sessionId: string; options: Array<{ optionId: string }> });
  }
}

/** Minimal stand-in for the host↔harness client: one session, one pending
 *  permission trigger, and exact-response capture. */
class StubHarness {
  private counter = 0;
  readonly sessions = new Set<string>();
  private permissionListeners = new Set<(request: RequestPermissionRequest, requestId: string) => boolean>();
  readonly resolved: Array<{ requestId: string; response: RequestPermissionResponse }> = [];
  readonly attachCalls: Array<{ sessionId: string; method: string }> = [];
  readonly promptCalls: Array<Array<{ type?: string; text?: string }>> = [];
  caps = { loadSession: true, resume: true, mcpHttp: false };
  readonly cancelled: string[] = [];
  lastSessionId = "";

  async createSession(): Promise<{ sessionId: string }> {
    const sessionId = `harness_${++this.counter}`;
    this.sessions.add(sessionId);
    this.lastSessionId = sessionId;
    return { sessionId };
  }
  getCapabilitiesSnapshot() {
    return this.caps;
  }
  async attachSession(sessionId: string, options: { method: "resume" | "load" }): Promise<{ modes: null; configOptions: null }> {
    this.attachCalls.push({ sessionId, method: options.method });
    if (!this.sessions.has(sessionId)) throw new Error("session_missing_on_harness");
    return { modes: null, configOptions: null };
  }
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
  async promptIn(_sessionId: string, blocks: Array<{ type?: string; text?: string }>): Promise<string> {
    this.promptCalls.push(blocks);
    return "end_turn";
  }
  getSessionModes(): null {
    return null;
  }
  getSessionConfigOptions(): null {
    return null;
  }
  async cancelIn(sessionId: string): Promise<void> {
    this.cancelled.push(sessionId);
  }
  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
  async setModeIn(): Promise<void> {
    /* no-op */
  }
  async setConfigOptionIn(): Promise<void> {
    /* no-op */
  }
  respondPermissionRaw(requestId: string, response: RequestPermissionResponse): void {
    this.resolved.push({ requestId, response });
  }
  cancelParkedPermissions(sessionId?: string): void {
    this.cancelled.push(sessionId ?? "*");
  }
  private updateListeners = new Set<(params: unknown, meta: { late: boolean; turn?: number }) => void>();
  onRawUpdate(cb: (params: unknown, meta: { late: boolean; turn?: number }) => void): () => void {
    this.updateListeners.add(cb);
    return () => this.updateListeners.delete(cb);
  }
  emitUpdate(params: unknown, meta: { late: boolean; turn?: number } = { late: false }): void {
    for (const cb of [...this.updateListeners]) cb(params, meta);
  }
  onRawPermissionRequest(cb: (request: RequestPermissionRequest, requestId: string) => boolean): () => void {
    this.permissionListeners.add(cb);
    return () => this.permissionListeners.delete(cb);
  }
  emitPermission(request: RequestPermissionRequest, requestId = "perm_test_1"): void {
    for (const cb of [...this.permissionListeners]) cb(request, requestId);
  }
}

const request: RequestPermissionRequest = {
  sessionId: "", // filled with the harness session id by the test
  toolCall: {
    toolCallId: "tc_perm",
    title: "Write note",
    kind: "edit",
    status: "pending",
    content: [{ type: "diff", path: "Inbox/new.md", oldText: "", newText: "+hello\n" }],
    locations: [{ path: "/vault/Inbox/new.md" }],
  } as never,
  options: [
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
    { optionId: "reject_once", name: "Reject", kind: "reject_once" },
  ],
};

function bridgeFixture(): {
  bridge: HostBridge;
  harness: StubHarness;
  store: SessionStore;
  owner: FakeContext;
  other: FakeContext;
} {
  const harness = new StubHarness();
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter, ".chat/sessions");
  const bridge = new HostBridge({
    store: () => store,
    ensureHarness: async () => harness as unknown as AcpShellClient,
    harness: () => harness as unknown as AcpShellClient,
    vaultRoot: () => "/vault",
    command: () => ({ label: "test", fingerprint: fingerprint("test acp", "/vault"), command: "test acp" }),
    mcpEntry: () => null,
  });
  const owner = new FakeContext();
  const other = new FakeContext();
  bridge.bindDevice("phoneA", owner.context);
  bridge.bindDevice("phoneB", other.context);
  return { bridge, harness, store, owner, other };
}

test("the relay binds each authenticated device to its own ACP context", async () => {
  const host = await startTestHost({ devices: { phoneA: "token-a", phoneB: "token-b" } });
  const connect = async (token: string) => {
    const client = new ShellClient({
      mode: "remote",
      cwd: "/",
      label: "test",
      connector: new RemoteTransportConnector({ url: host.url, token, attempts: 1 }),
      autoSession: false,
    });
    await client.connect();
    return client;
  };
  const a = await connect("token-a");
  const b = await connect("token-b");
  try {
    assert.ok(host.bridge.devices.has("phoneA"));
    assert.ok(host.bridge.devices.has("phoneB"));
    const sessionA = await a.createSession({ cwd: "/" });
    const listB = await b.listSessions();
    assert.equal(listB.length, 0, "device B cannot see device A's session");
    await assert.rejects(b.promptIn(sessionA.sessionId, [{ type: "text", text: "hi" }]) as Promise<unknown>, /not owned|unknown session/i);
  } finally {
    await a.close();
    await b.close();
    await host.close();
  }
});

test("a harness permission request goes only to the owning device and returns its exact optionId", async () => {
  const { bridge, harness, store, owner, other } = bridgeFixture();
  const created = await bridge.newSession("phoneA", { cwd: "/", mcpServers: [] } as never);
  harness.emitPermission({ ...request, sessionId: harness.lastSessionId }, "perm_test_1");
  await waitFor(() => owner.requests.length === 1);

  assert.equal(other.requests.length, 0, "the other device never sees the request");
  const [forwarded] = owner.permissionRequests();
  assert.equal(forwarded.sessionId, created.sessionId, "the card is scoped to the host session id");
  assert.deepEqual(
    forwarded.options.map((option) => option.optionId),
    ["allow_once", "allow_always", "reject_once"],
  );

  owner.respond({ outcome: { outcome: "selected", optionId: "allow_always" } });
  await waitFor(() => harness.resolved.length === 1);
  assert.deepEqual(
    harness.resolved[0].response,
    { outcome: { outcome: "selected", optionId: "allow_always" } },
    "the harness receives exactly the offered option id, unprompted",
  );

  const read = await store.read(created.sessionId);
  assert.ok(read.entries.some((entry) => entry.kind === "permission_request"));
  const response = read.entries.find((entry) => entry.kind === "permission_response");
  assert.deepEqual((response as { outcome?: unknown }).outcome, { outcome: "selected", optionId: "allow_always" });
});

test("a device cannot prompt, load, or list another device's session", async () => {
  const { bridge, harness } = bridgeFixture();
  const created = await bridge.newSession("phoneA", { cwd: "/", mcpServers: [] } as never);
  void harness;
  await assert.rejects(
    bridge.prompt("phoneB", { sessionId: created.sessionId, prompt: [{ type: "text", text: "x" }] } as never),
    /not owned by this device/,
  );
  await assert.rejects(
    bridge.loadSession("phoneB", { sessionId: created.sessionId, cwd: "/vault" } as never),
    /not owned by this device/,
  );
  assert.deepEqual((await bridge.listSessions("phoneB")).sessions, []);
});

test("disconnecting the owning device cancels its parked approvals", async () => {
  const { bridge, harness, owner } = bridgeFixture();
  await bridge.newSession("phoneA", { cwd: "/", mcpServers: [] } as never);
  harness.emitPermission({ ...request, sessionId: harness.lastSessionId }, "perm_test_2");
  await waitFor(() => owner.requests.length === 1);
  bridge.unbindDevice("phoneA");
  assert.ok(harness.cancelled.includes(harness.lastSessionId), "the harness's pending request was cancelled");
});

const legacyMessages: LegacyMessage[] = [
  { role: "user", content: "old question" },
  { role: "assistant", content: "old answer" },
];

function legacyNoteText(): string {
  return (
    metaToFrontmatter({ created: 1_700_000_000_000, updated: 1_700_000_001_000, tokens: 2, title: "Old note" }) +
    renderBody("Old note", legacyMessages)
  );
}

function bridgeAndContextFor(store: SessionStore, harness: StubHarness): { bridge: HostBridge; context: FakeContext } {
  const bridge = new HostBridge({
    store: () => store,
    ensureHarness: async () => harness as unknown as AcpShellClient,
    harness: () => harness as unknown as AcpShellClient,
    vaultRoot: () => "/vault",
    command: () => ({ label: "test", fingerprint: fingerprint("test acp", "/vault"), command: "test acp" }),
    mcpEntry: () => null,
  });
  const context = new FakeContext();
  bridge.bindDevice("__local__", context.context);
  return { bridge, context };
}

function bridgeFor(store: SessionStore, harness: StubHarness): HostBridge {
  return bridgeAndContextFor(store, harness).bridge;
}

async function importedSession(store: SessionStore): Promise<string> {
  const report = await importLegacySessions({
    store,
    notes: [{ path: "Journal/old.md", text: legacyNoteText(), mtime: 1_700_000_000_000 }],
  });
  return report.importedSessions[0].sessionId;
}

test("a stored conversation loads with an explicit continuity state and no re-persisted replay", async () => {
  const store = new SessionStore(new MemoryAdapter(), ".chat/sessions");
  const harness = new StubHarness();
  const bridge = bridgeFor(store, harness);
  const sessionId = await importedSession(store);
  const before = (await store.read(sessionId)).entries.length;
  const response = await bridge.loadSession("__local__", { sessionId, cwd: "/vault" } as never);
  const meta = (response as { _meta?: Record<string, unknown> })._meta!;
  assert.equal(meta["obsidian-chat/resume"], "digest-only");
  assert.equal(meta["obsidian-chat/digest"], true);
  assert.equal((await store.read(sessionId)).entries.length, before, "replayed history is not appended");
});

test("a detached conversation refuses to start a new harness session without an explicit choice", async () => {
  const store = new SessionStore(new MemoryAdapter(), ".chat/sessions");
  const harness = new StubHarness();
  const bridge = bridgeFor(store, harness);
  const sessionId = await importedSession(store);
  await assert.rejects(
    bridge.prompt("__local__", { sessionId, prompt: [{ type: "text", text: "continue" }] } as never),
    /continuity choice required/,
  );
  assert.equal(harness.promptCalls.length, 0);
});

test("choosing digest seeds one labelled block, records the decision, and continues the same record", async () => {
  const store = new SessionStore(new MemoryAdapter(), ".chat/sessions");
  const harness = new StubHarness();
  const bridge = bridgeFor(store, harness);
  const sessionId = await importedSession(store);
  const response = await bridge.prompt("__local__", {
    sessionId,
    prompt: [{ type: "text", text: "continue from here" }],
    _meta: { "obsidian-chat/continuity": "digest" },
  } as never);
  assert.equal(response.stopReason, "end_turn");
  const seeded = harness.promptCalls[0];
  assert.ok(String(seeded[0].text).startsWith(DIGEST_FIRST_LINE));
  assert.equal(seeded[1].text, "continue from here");
  const read = await store.read(sessionId);
  const resume = read.entries.find((entry) => entry.kind === "resume") as { method?: string; harnessSessionId?: string } | undefined;
  assert.equal(resume?.method, "digest");
  assert.ok(resume?.harnessSessionId);
  const promptEntry = read.entries.find((entry) => entry.kind === "prompt") as { blocks?: Array<{ text?: string }> } | undefined;
  assert.equal(promptEntry?.blocks?.length, 1, "the digest is not recorded as a visible user turn");
  await bridge.prompt("__local__", { sessionId, prompt: [{ type: "text", text: "again" }] } as never);
  assert.equal(harness.promptCalls.length, 2);
});

test("a fresh choice starts a new harness session without seeding and keeps the record", async () => {
  const store = new SessionStore(new MemoryAdapter(), ".chat/sessions");
  const harness = new StubHarness();
  const bridge = bridgeFor(store, harness);
  const sessionId = await importedSession(store);
  await bridge.prompt("__local__", {
    sessionId,
    prompt: [{ type: "text", text: "start over" }],
    _meta: { "obsidian-chat/continuity": "fresh" },
  } as never);
  assert.equal(harness.promptCalls[0].length, 1, "fresh seeds no digest block");
  const read = await store.read(sessionId);
  const resume = read.entries.find((entry) => entry.kind === "resume") as { method?: string } | undefined;
  assert.equal(resume?.method, "fresh");
});

test("a resumable stored session is reattached with session/resume on open", async () => {
  const harness = new StubHarness();
  const store = new SessionStore(new MemoryAdapter(), ".chat/sessions");
  const first = bridgeFor(store, harness);
  const created = await first.newSession("__local__", { cwd: "/vault", mcpServers: [] } as never);
  await first.prompt("__local__", { sessionId: created.sessionId, prompt: [{ type: "text", text: "seed" }] } as never);
  harness.promptCalls.length = 0;
  const second = bridgeFor(store, harness);
  const response = await second.loadSession("__local__", { sessionId: created.sessionId, cwd: "/vault" } as never);
  const meta = (response as { _meta?: Record<string, unknown> })._meta!;
  assert.equal(meta["obsidian-chat/resume"], "resume-capable");
  assert.equal(harness.attachCalls.at(-1)?.method, "resume");
  await second.prompt("__local__", { sessionId: created.sessionId, prompt: [{ type: "text", text: "hi" }] } as never);
  assert.equal(harness.promptCalls.length, 1);
});

test("a failed reattach becomes digest-only with an explanation and a recorded failure", async () => {
  const harness = new StubHarness();
  const store = new SessionStore(new MemoryAdapter(), ".chat/sessions");
  const first = bridgeFor(store, harness);
  const created = await first.newSession("__local__", { cwd: "/vault", mcpServers: [] } as never);
  await first.prompt("__local__", { sessionId: created.sessionId, prompt: [{ type: "text", text: "seed" }] } as never);
  harness.sessions.clear();
  const second = bridgeFor(store, harness);
  const response = await second.loadSession("__local__", { sessionId: created.sessionId, cwd: "/vault" } as never);
  const meta = (response as { _meta?: Record<string, unknown> })._meta!;
  assert.equal(meta["obsidian-chat/resume"], "digest-only");
  assert.equal(meta["obsidian-chat/reason"], "reattach_failed");
  const read = await store.read(created.sessionId);
  assert.ok(read.entries.some((entry) => entry.kind === "resume" && (entry as { result?: string }).result === "failed"));
});

class FailingAdapter extends MemoryAdapter {
  failAppend = false;
  async append(path: string, data: string): Promise<void> {
    if (this.failAppend) throw new Error("disk full");
    return super.append(path, data);
  }
}

test("a failed record write is surfaced to the owning device, not silently dropped", async () => {
  const adapter = new FailingAdapter();
  const store = new SessionStore(adapter, ".chat/sessions");
  const harness = new StubHarness();
  const { bridge, context } = bridgeAndContextFor(store, harness);
  const created = await bridge.newSession("__local__", { cwd: "/vault", mcpServers: [] } as never);
  await bridge.prompt("__local__", { sessionId: created.sessionId, prompt: [{ type: "text", text: "live" }] } as never);
  assert.equal(harness.promptCalls.length, 1, "the live turn completed");

  adapter.failAppend = true;
  harness.emitUpdate(
    { sessionId: harness.lastSessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "late" } } },
    { late: true },
  );
  await waitFor(() => context.notifications.some((entry) => {
    const update = entry.params as { update?: { sessionUpdate?: string } };
    return update.update?.sessionUpdate === "obsidian_chat_store_error";
  }));
  const failure = context.notifications.find((entry) => {
    const update = entry.params as { update?: { sessionUpdate?: string } };
    return update.update?.sessionUpdate === "obsidian_chat_store_error";
  });
  assert.ok(failure, "the write failure is surfaced to the owning device");
  const read = await store.read(created.sessionId);
  assert.ok(read.entries.some((entry) => entry.kind === "prompt"), "the completed live turn is intact");
});

test("sinceSeq replay returns only later notifications and never resends a prompt", async () => {
  const store = new SessionStore(new MemoryAdapter(), ".chat/sessions");
  const harness = new StubHarness();
  const { bridge, context } = bridgeAndContextFor(store, harness);
  const created = await bridge.newSession("__local__", { cwd: "/vault", mcpServers: [] } as never);
  await bridge.prompt("__local__", { sessionId: created.sessionId, prompt: [{ type: "text", text: "one" }] } as never);
  const afterFirst = (await store.read(created.sessionId)).entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
  await bridge.prompt("__local__", { sessionId: created.sessionId, prompt: [{ type: "text", text: "two" }] } as never);
  const promptsBefore = harness.promptCalls.length;
  context.notifications.length = 0;
  await bridge.loadSession("__local__", {
    sessionId: created.sessionId,
    cwd: "/vault",
    _meta: { "obsidian-chat/sinceSeq": afterFirst },
  } as never);
  const replayed = context.notifications
    .map((entry) => (entry.params as { _meta?: { "obsidian-chat/seq"?: number } })._meta?.["obsidian-chat/seq"])
    .filter((seq): seq is number => typeof seq === "number");
  assert.ok(replayed.length > 0);
  assert.ok(replayed.every((seq) => seq > afterFirst), "nothing already seen is replayed");
  assert.equal(harness.promptCalls.length, promptsBefore, "reconnect/replay never resends a prompt");
});

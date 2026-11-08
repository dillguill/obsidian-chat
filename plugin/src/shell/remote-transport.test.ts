/** US3 transport coverage: remote attach, standard session/list, session/load
 *  replay with `_meta sinceSeq`, reconnect, and auth rejection (T054). */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AcpShellClient } from "./acp-client.ts";
import { isAuthRejection, RemoteTransportConnector } from "./remote-transport.ts";
import type { ChatEvent } from "../acp/types.ts";
import { startTestHost } from "../../test/fixtures/fake-relay.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRemote(url: string, token: string, autoSession = false): { client: AcpShellClient; events: ChatEvent[] } {
  const client = new AcpShellClient({
    mode: "remote",
    cwd: "/",
    label: "remote test",
    connector: new RemoteTransportConnector({ url, token, attempts: 1 }),
    autoSession,
  });
  const events: ChatEvent[] = [];
  client.onEvent((event) => events.push(event));
  return { client, events };
}

test("a remote attaches without spawning, lists stored sessions, and loads one", async () => {
  const host = await startTestHost();
  const { client, events } = makeRemote(host.url, "phone-token");
  try {
    await client.connect();
    assert.equal(client.getState(), "connected");
    const created = await client.createSession({ cwd: "/" });
    const sessions = await client.listSessions();
    assert.ok(sessions.some((session) => session.sessionId === created.sessionId));
    assert.deepEqual(
      sessions.map((session) => session.title),
      ["Session 1"],
    );
    assert.equal((sessions[0]._meta as Record<string, unknown>)["obsidian-chat/resume"], "load-only");

    assert.equal(events.some((event) => event.update?.type === "message"), false, "no replay before load");
    await client.loadSession(created.sessionId, { sinceSeq: 0 });
    await delay(25);
    assert.ok(
      events.some((event) => event.update?.type === "message" && event.update.text === "replayed from record"),
      "the stored transcript was replayed as a standard session/update before load resolved",
    );
  } finally {
    await client.close();
    await host.close();
  }
});

test("session/load carries the sinceSeq sequence cursor without requiring it", async () => {
  const host = await startTestHost();
  const { client } = makeRemote(host.url, "phone-token");
  try {
    await client.connect();
    const created = await client.createSession({ cwd: "/" });
    await client.loadSession(created.sessionId, { sinceSeq: 7 });
    await client.loadSession(created.sessionId);
    const first = host.bridge.loadRequests[0] as { _meta?: Record<string, unknown> };
    const second = host.bridge.loadRequests[1] as { _meta?: Record<string, unknown> };
    assert.deepEqual(first._meta, { "obsidian-chat/sinceSeq": 7 });
    assert.equal(second._meta, undefined, "the metadata is optional");
  } finally {
    await client.close();
    await host.close();
  }
});

test("reconnect reattaches via session/load and never resends the prompt", async () => {
  const host = await startTestHost();
  const { client, events } = makeRemote(host.url, "phone-token");
  try {
    await client.connect();
    const created = await client.createSession({ cwd: "/" });
    await client.reconnect({ sinceSeq: 4 });
    assert.equal(client.getState(), "connected");
    await delay(25);
    const load = host.bridge.loadRequests.at(-1) as { _meta?: Record<string, unknown> };
    assert.deepEqual(load._meta, { "obsidian-chat/sinceSeq": 4 });
    assert.ok(events.some((event) => event.update?.type === "message"));
    assert.equal(host.bridge.prompted.length, 0, "reconnect never resends a prompt");
  } finally {
    await client.close();
    await host.close();
  }
});

test("an auth rejection is never retried as a transient network error", async () => {
  const host = await startTestHost();
  try {
    const connector = new RemoteTransportConnector({ url: host.url, token: "revoked-device", attempts: 3, baseMs: 20 });
    const started = Date.now();
    await assert.rejects(connector.connect(), (err: unknown) => {
      assert.equal(isAuthRejection(err), true, "classified as an auth rejection");
      return true;
    });
    assert.ok(Date.now() - started < 2_000, "no backoff retries for an auth rejection");
    assert.equal(host.bridge.created, 0);
  } finally {
    await host.close();
  }
});

test("the remote transport path spawns nothing, listens on nothing, and writes no store", () => {
  const source = readFileSync(new URL("./remote-transport.ts", import.meta.url), "utf8");
  assert.ok(!/child_process|\bcreateServer\b|\.listen\(/.test(source), "no process/listener in the remote path");
  assert.ok(!/SessionStore|session\/store/.test(source), "no local conversation store on the remote path");
});

test("SeqDedupe renders each obsidian-chat/seq once and resets on demand", async () => {
  const { SeqDedupe } = await import("./remote-transport.ts");
  const dedupe = new SeqDedupe();
  assert.equal(dedupe.accept("s1", 1), true);
  assert.equal(dedupe.accept("s1", 2), true);
  assert.equal(dedupe.accept("s1", 2), false, "a replayed sequence is not rendered twice");
  assert.equal(dedupe.accept("s2", 2), true, "sequences are per-session");
  dedupe.reset("s1");
  assert.equal(dedupe.accept("s1", 2), true, "an explicit reload may render the record again");
});

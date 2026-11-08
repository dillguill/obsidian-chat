/** US3 integration: the host listener, auth-before-upgrade, remote one-turn,
 *  and the host's own loopback attach (T053/T055, FR-005/FR-008…FR-014). */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WebSocket } from "ws";
import { AcpShellClient } from "./acp-client.ts";
import { RemoteTransportConnector } from "./remote-transport.ts";
import type { ChatEvent } from "../acp/types.ts";
import { startTestHost } from "../../test/fixtures/fake-relay.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectClient(url: string, token: string): { client: AcpShellClient; events: ChatEvent[] } {
  const client = new AcpShellClient({
    mode: "remote",
    cwd: "/vault",
    label: "test",
    connector: new RemoteTransportConnector({ url, token, attempts: 1 }),
  });
  const events: ChatEvent[] = [];
  client.onEvent((event) => events.push(event));
  return { client, events };
}

test("an unauthenticated upgrade is rejected before any ACP connection exists", async () => {
  const host = await startTestHost();
  try {
    await assert.rejects(
      new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`${host.url}?token=not-a-device`);
        socket.on("open", () => {
          socket.close();
          resolve();
        });
        socket.on("error", reject);
        socket.on("close", () => reject(new Error("closed without an error")));
      }),
      /401|Unexpected server response/i,
    );
    await delay(25);
    assert.equal(host.bridge.created, 0, "no session was created for an unauthenticated attach");
    assert.equal(host.bridge.devices.size, 0, "no ACP connection was established");
  } finally {
    await host.close();
  }
});

test("a paired device completes one turn over the host WebSocket", async () => {
  const host = await startTestHost();
  const { client, events } = connectClient(host.url, "phone-token");
  try {
    await client.connect();
    assert.equal(client.getState(), "connected");
    const sessionId = client.getSessionId();
    assert.ok(sessionId, "the host assigned a session id");
    assert.equal(host.bridge.sessions.get(sessionId!)?.deviceId, "phone");
    const stop = await client.prompt([{ type: "text", text: "hi" }]);
    assert.equal(stop, "end_turn");
    await delay(25);
    assert.ok(
      events.some((event) => event.update?.type === "message" && event.update.text.includes("echo: hi")),
      "the harness update streamed back to the device",
    );
    assert.ok(events.some((event) => event.turn?.stopReason === "end_turn"), "the prompt resolution ends the turn");
    assert.deepEqual(host.bridge.prompted[0]?.text, "hi");
  } finally {
    await client.close();
    await host.close();
  }
});

test("the single listener serves only the ACP and loopback MCP endpoints", async () => {
  const host = await startTestHost();
  try {
    const base = `http://127.0.0.1:${host.server.boundPort}`;
    const missing = await fetch(`${base}/not-a-route`);
    assert.equal(missing.status, 404);
    const mcp = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(mcp.status, 204, "the /mcp route is mounted on the same listener");
  } finally {
    await host.close();
  }
});

test("the host's own UI attaches over loopback with the per-run local token", async () => {
  const host = await startTestHost();
  const { client } = connectClient(host.url, host.localToken);
  try {
    await client.connect();
    const sessionId = client.getSessionId();
    assert.ok(sessionId);
    assert.equal(host.bridge.sessions.get(sessionId!)?.deviceId, "__local__");
    assert.ok(host.bridge.devices.has("__local__"), "the local view used the loopback ACP path");
  } finally {
    await client.close();
    await host.close();
  }
});

test("revoking a device closes its live socket without disturbing the other device", async () => {
  const devices: Record<string, string> = { phoneA: "token-a", phoneB: "token-b" };
  const host = await startTestHost({ devices });
  const connect = async (token: string) => {
    const client = new AcpShellClient({
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
    assert.equal(host.bridge.devices.has("phoneA"), true);
    host.server.closeDevice("phoneA");
    await delay(40);
    assert.notEqual(a.getState(), "connected", "the revoked device's connection is closed");
    assert.equal(b.getState(), "connected", "the other device is unaffected");
    assert.equal(host.bridge.devices.has("phoneA"), false, "the revoked device's relay context is gone");

    delete devices.phoneA;
    const revoked = new AcpShellClient({
      mode: "remote",
      cwd: "/",
      label: "test",
      connector: new RemoteTransportConnector({ url: host.url, token: "token-a", attempts: 1 }),
      autoSession: false,
    });
    await assert.rejects(revoked.connect(), /401|Unexpected server response|unauthori/i);
    await revoked.close().catch(() => undefined);
  } finally {
    await a.close().catch(() => undefined);
    await b.close().catch(() => undefined);
    await host.close();
  }
});

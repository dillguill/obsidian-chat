/** Redesign item 4: client-side liveness. A host that stops answering is
 *  detected and reported lost instead of looking connected. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { WebSocket } from "ws";
import { AcpShellClient } from "./acp-client.ts";
import { RemoteTransportConnector } from "./remote-transport.ts";
import { startTestHost } from "../../test/fixtures/fake-relay.ts";

function client(url: string, onLost?: (reason: string) => void): AcpShellClient {
  return new AcpShellClient({
    mode: "remote",
    cwd: "/vault",
    label: "test",
    connector: new RemoteTransportConnector({ url, token: "phone-token", attempts: 1 }),
    heartbeatTimeoutMs: 300,
    onTransportLost: onLost,
  });
}

test("a live host answers the ping", async () => {
  const host = await startTestHost();
  const c = client(host.url);
  try {
    await c.connect();
    assert.equal(await c.checkAlive(), true);
    assert.equal(c.getState(), "connected");
  } finally {
    await c.close();
    await host.close();
  }
});

test("a silent host is detected: the transport is closed and reported lost", async () => {
  const host = await startTestHost();
  const reasons: string[] = [];
  const c = client(host.url, (reason) => reasons.push(reason));
  try {
    await c.connect();
    // Stop reading on the host side: TCP stays up, nothing answers.
    const sockets = (host.server as unknown as { sockets: Map<WebSocket, unknown> }).sockets;
    for (const ws of sockets.keys()) ws.pause();
    assert.equal(await c.checkAlive(), false);
    assert.equal(c.getState(), "reconnecting");
    assert.deepEqual(reasons, ["the host stopped answering"]);
  } finally {
    await c.close();
    await host.close();
  }
});

test("concurrent checks share one ping", async () => {
  const host = await startTestHost();
  const c = client(host.url);
  try {
    await c.connect();
    const [a, b] = [c.checkAlive(), c.checkAlive()];
    assert.equal(a, b);
    assert.equal(await a, true);
  } finally {
    await c.close();
    await host.close();
  }
});

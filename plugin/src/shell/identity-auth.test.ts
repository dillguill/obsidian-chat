/** Redesign item 3: remote devices authenticate with the Tailscale Serve
 *  identity header on a loopback-only listener; no device codes. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WebSocket } from "ws";
import { deviceNameFromUrl, loginAllowed } from "./device-auth.ts";
import { remoteUrlWithToken } from "./remote-transport.ts";
import { originAllowed } from "./host-server.ts";
import { startTestHost } from "../../test/fixtures/fake-relay.ts";

function attach(url: string, headers: Record<string, string> = {}): Promise<number | "open"> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers });
    socket.on("open", () => {
      socket.close();
      resolve("open");
    });
    socket.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0);
      socket.terminate();
    });
    socket.on("error", () => undefined);
  });
}

test("an allowed Tailscale login attaches under its self-declared device name", async () => {
  const host = await startTestHost({ devices: {}, allowedUsers: ["Me@Example.com"] });
  try {
    const socket = new WebSocket(`${host.url}?device=phone`, { headers: { "Tailscale-User-Login": "me@example.com" } });
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", reject);
    });
    const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
    // The connection is registered under "phone": closing that device closes it.
    host.server.closeDevice("phone");
    assert.equal(await closed, 1008);
  } finally {
    await host.close();
  }
});

test("no identity header, an unlisted login, or a forged local token is rejected with 401", async () => {
  const host = await startTestHost({ devices: {}, allowedUsers: ["me@example.com"] });
  try {
    assert.equal(await attach(`${host.url}?device=phone`), 401);
    assert.equal(await attach(`${host.url}?device=phone`, { "Tailscale-User-Login": "other@example.com" }), 401);
    assert.equal(await attach(`${host.url}?token=guess`), 401);
  } finally {
    await host.close();
  }
});

test("an empty allow-list accepts any login Serve vouches for; identity is off unless configured", async () => {
  const open = await startTestHost({ devices: {}, allowedUsers: [] });
  const closed = await startTestHost({ devices: {} });
  try {
    assert.equal(await attach(open.url, { "Tailscale-User-Login": "anyone@example.com" }), "open");
    assert.equal(await attach(closed.url, { "Tailscale-User-Login": "anyone@example.com" }), 401);
  } finally {
    await open.close();
    await closed.close();
  }
});

test("the host's own per-run token still attaches", async () => {
  const host = await startTestHost({ devices: {}, allowedUsers: [] });
  try {
    assert.equal(await attach(`${host.url}?token=${host.localToken}`), "open");
  } finally {
    await host.close();
  }
});

test("login matching and device-name sanitizing", () => {
  assert.equal(loginAllowed("A@b.c", []), true);
  assert.equal(loginAllowed("", []), false);
  assert.equal(loginAllowed(undefined, []), false);
  assert.equal(loginAllowed("a@b.c", ["x@y.z"]), false);
  assert.equal(deviceNameFromUrl("/acp?device=My%20Phone"), "My Phone");
  assert.equal(deviceNameFromUrl("/acp?device=__local__"), null, "cannot impersonate the host view");
  assert.equal(deviceNameFromUrl("/acp?device=%3Cscript%3E"), "script");
  assert.equal(deviceNameFromUrl("/acp"), null);
});

test("the attach URL carries the device name and no token when there is none", () => {
  const url = new URL(remoteUrlWithToken("https://mac.tail1234.ts.net", "", "phone"));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/acp");
  assert.equal(url.searchParams.get("device"), "phone");
  assert.equal(url.searchParams.has("token"), false);
});

test("a web page's origin is refused even with a valid identity (no cross-site WebSocket hijacking)", async () => {
  const host = await startTestHost({ devices: {}, allowedUsers: [] });
  try {
    const login = { "Tailscale-User-Login": "me@example.com" };
    assert.equal(await attach(host.url, { ...login, Origin: "https://evil.example" }), 403);
    assert.equal(await attach(host.url, { ...login, Origin: "app://obsidian.md" }), "open");
    assert.equal(await attach(host.url, { ...login, Origin: "capacitor://localhost" }), "open");
  } finally {
    await host.close();
  }
});

test("origin allow-list", () => {
  assert.equal(originAllowed(undefined), true, "native clients send no Origin");
  assert.equal(originAllowed("app://obsidian.md"), true);
  assert.equal(originAllowed("https://device-01.example.ts.net"), false);
});

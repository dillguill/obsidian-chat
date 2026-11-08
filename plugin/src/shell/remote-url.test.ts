import test from "node:test";
import assert from "node:assert/strict";
import { remoteUrlWithToken } from "./remote-transport.ts";

test("remote URL normalizes scheme, defaults the path to /acp and adds the token", () => {
  assert.equal(remoteUrlWithToken("http://100.64.0.7:8765", "t1"), "ws://100.64.0.7:8765/acp?token=t1");
  assert.equal(remoteUrlWithToken("https://host.example:8443/", "t1"), "wss://host.example:8443/acp?token=t1");
  assert.equal(remoteUrlWithToken("ws://100.64.0.7:8765/acp", "t1"), "ws://100.64.0.7:8765/acp?token=t1");
  assert.equal(remoteUrlWithToken("wss://host.example/custom", ""), "wss://host.example/custom");
  assert.throws(() => remoteUrlWithToken("ftp://x", "t"), /ws:\/\/ or wss:\/\//);
});

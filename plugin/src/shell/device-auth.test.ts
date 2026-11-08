/** T117: security edges for device credentials. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DeviceRegistry, constantTimeEqual, mintToken, tokenFromUrl } from "./device-auth.ts";

test("token comparison is constant-time and length-safe", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual("", ""), true);
});

test("registry resolves paired tokens and the per-run local token", () => {
  const registry = new DeviceRegistry({
    devices: () => ({ phone: "phone-token" }),
    localToken: "local-token",
  });
  assert.equal(registry.deviceForToken("phone-token"), "phone");
  assert.equal(registry.deviceForToken("local-token"), "__local__");
  assert.equal(registry.deviceForToken("wrong"), null);
  assert.equal(registry.deviceForToken(null), null);
  assert.equal(registry.isRevoked("phone"), false);
  assert.equal(registry.isRevoked("gone"), true);
  assert.equal(registry.isRevoked("__local__"), false);
});

test("tokens are read only from the WebSocket query parameter", () => {
  assert.equal(tokenFromUrl("/acp?token=abc"), "abc");
  assert.equal(tokenFromUrl("/acp"), null);
  assert.equal(tokenFromUrl(undefined), null);
});

test("minted tokens are long, unique and never empty", () => {
  const a = mintToken();
  const b = mintToken();
  assert.ok(a.length >= 24);
  assert.notEqual(a, b);
});

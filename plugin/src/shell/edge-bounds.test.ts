/** T124: the documented bounds and safety edges actually hold. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_APPROVAL_TIMEOUT_MS,
  HARNESS_RESTART_ATTEMPTS,
  MAX_ENTRY_BYTES,
  RAW_DISPLAY_LIMIT,
  RECONNECT_ATTEMPTS,
  REPLAY_MAX_ENTRIES,
  SESSION_SIZE_WARN_BYTES,
} from "../session/limits.ts";
import { backoffDelay } from "./transport.ts";
import { harnessTarget, isLoopbackBind } from "./types.ts";
import { STOP_GRACE_MS } from "./local-transport.ts";
import { sanitizeForRecord } from "../session/record.ts";

test("the contract bounds are the ones the code uses", () => {
  assert.equal(MAX_ENTRY_BYTES, 256 * 1024);
  assert.equal(RAW_DISPLAY_LIMIT, 16 * 1024);
  assert.equal(REPLAY_MAX_ENTRIES, 20_000);
  assert.equal(SESSION_SIZE_WARN_BYTES, 50 * 1024 * 1024);
  assert.equal(DEFAULT_APPROVAL_TIMEOUT_MS, 10 * 60 * 1000);
  assert.equal(RECONNECT_ATTEMPTS, 8);
  assert.equal(HARNESS_RESTART_ATTEMPTS, 5);
});

test("reconnect backoff is 1 s → 15 s over the bounded attempts", () => {
  assert.equal(backoffDelay(0), 1_000);
  assert.equal(backoffDelay(1), 2_000);
  assert.equal(backoffDelay(3), 8_000);
  assert.equal(backoffDelay(4), 15_000, "capped at 15 s");
  assert.equal(backoffDelay(20), 15_000, "never unbounded");
});

test("only loopback addresses count as loopback binds", () => {
  for (const address of ["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackBind(address), true);
  }
  assert.equal(isLoopbackBind("0.0.0.0"), false);
  assert.equal(isLoopbackBind("100.64.0.2"), false);
});

test("record sanitization strips image/audio bytes and auth header values", () => {
  const sanitized = sanitizeForRecord({
    type: "image",
    mimeType: "image/png",
    data: "SECRET_BYTES",
    name: "shot.png",
  }) as Record<string, unknown>;
  assert.equal(sanitized.data, "");
  assert.equal(sanitized.mimeType, "image/png");
  assert.equal(sanitized.name, "shot.png");

  const headers = sanitizeForRecord({
    headers: [
      { name: "Authorization", value: "Bearer device-token" },
      { name: "content-type", value: "application/json" },
    ],
  }) as { headers: Array<{ name: string; value: string }> };
  assert.equal(headers.headers[0].value, "***");
  assert.equal(headers.headers[1].value, "application/json");
});

test("the harness setting is a command unless it is a ws(s):// URL", () => {
  assert.deepEqual(harnessTarget("  ~/bin/dsh-acp "), { kind: "command", command: "~/bin/dsh-acp" });
  assert.deepEqual(harnessTarget("npx @zed-industries/claude-code-acp"), { kind: "command", command: "npx @zed-industries/claude-code-acp" });
  assert.deepEqual(harnessTarget("wss://harness.example/acp"), { kind: "url", url: "wss://harness.example/acp" });
  assert.deepEqual(harnessTarget("WS://127.0.0.1:9000"), { kind: "url", url: "WS://127.0.0.1:9000" });
  assert.equal(harnessTarget("https://x").kind, "command", "only ws/wss are harness URLs");
});

test("a stopping harness gets time to clean up before SIGKILL", () => {
  assert.ok(STOP_GRACE_MS >= 8_000);
});

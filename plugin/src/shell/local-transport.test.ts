import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpShellClient } from "./acp-client.ts";
import { LocalTransportConnector } from "./local-transport.ts";
import type { ShellEnvironment } from "./types.ts";

const env: ShellEnvironment = {
  canServeVault: () => true,
  readTextFile: async () => "",
  writeTextFile: async () => undefined,
};
const fixture = new URL("../../test/fixtures/mock-harness.ts", import.meta.url).pathname;
const cwd = mkdtempSync(join(tmpdir(), "oc-shell-"));

function makeClient(command: string, extraEnv: Record<string, string> = {}): AcpShellClient {
  return new AcpShellClient({
    mode: "local",
    cwd,
    label: "mock-child",
    environment: env,
    connector: new LocalTransportConnector({ command, cwd, env: extraEnv }),
  });
}

test("spawns the mock harness child and completes one turn over stdio", async () => {
  const command = `"${process.execPath}" --experimental-strip-types "${fixture}"`;
  const client = makeClient(command);
  await client.connect();
  assert.equal(client.getState(), "connected");
  const events: string[] = [];
  client.onEvent((event) => {
    if (event.update?.type === "message") events.push(event.update.text);
  });
  const stop = await client.prompt([{ type: "text", text: "hello" }]);
  assert.equal(stop, "end_turn");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(events.some((t) => t.includes("hello")));
  await client.close();
});

test("a missing harness binary fails attach promptly instead of hanging", async () => {
  const client = makeClient("definitely-not-a-real-harness-xyz --acp");
  await assert.rejects(client.connect(), /harness/i);
  await client.close();
});

test("a crash mid-turn rejects the prompt and reports an interrupted turn", async () => {
  const command = `"${process.execPath}" --experimental-strip-types "${fixture}"`;
  const client = makeClient(command, { MOCK_PROMPT_DELAY_MS: "800", MOCK_CRASH_AFTER_MS: "350" });
  await client.connect();
  const errors: string[] = [];
  let interrupted = false;
  client.onEvent((event) => {
    if (event.error) errors.push(event.error.message);
    if (event.turn?.interrupted) interrupted = true;
  });
  const prompted = client.prompt([{ type: "text", text: "crash" }]);
  await assert.rejects(Promise.race([prompted, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3_000))]));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(interrupted, "turn reported interrupted");
  assert.ok(errors.length > 0, "transport error surfaced");
  await client.close();
});

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AcpShellClient, type McpServerEntry } from "./acp-client.ts";
import type { ShellEnvironment } from "./types.ts";
import type { TransportConnector } from "./transport.ts";
import { createMockAgent, linkedStreams, type MockAgentOptions } from "../../test/fixtures/mock-agent.ts";
import type { ChatEvent } from "../acp/types.ts";

const env: ShellEnvironment = {
  canServeVault: () => true,
  readTextFile: async () => "file content",
  writeTextFile: async () => undefined,
};

function makeClient(
  options: MockAgentOptions = {},
  extra: { mcpServer?: () => McpServerEntry | null } = {},
): { client: AcpShellClient; events: ChatEvent[] } {
  const agentApp = createMockAgent(options);
  const streams = linkedStreams();
  agentApp.connect(streams.agentStream as never);
  const connector: TransportConnector = {
    connect: async () => ({
      label: "mock",
      stream: streams.clientStream as never,
      close: async () => undefined,
      onClose: () => () => undefined,
    }),
  };
  const client = new AcpShellClient({
    mode: "local",
    cwd: "/vault",
    label: "mock",
    environment: env,
    connector,
    ...(extra.mcpServer ? { mcpServer: extra.mcpServer } : {}),
  });
  const events: ChatEvent[] = [];
  client.onEvent((event) => events.push(event));
  return { client, events };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("one local turn: initialize, session/new, streamed updates, turn boundary", async () => {
  const { client, events } = makeClient();
  await client.connect();
  assert.equal(client.getState(), "connected");
  assert.ok(client.getSessionId());
  const stop = await client.prompt([{ type: "text", text: "hi" }]);
  assert.equal(stop, "end_turn");
  await delay(20);
  assert.ok(events.some((e) => e.update?.type === "message" && e.update.text.includes("hello")));
  assert.ok(events.some((e) => e.update?.type === "tool_call"));
  assert.ok(events.some((e) => e.turn?.stopReason === "end_turn" && !e.turn.interrupted));
  await client.close();
});

test("cancel during a turn resolves cancelled and emits an honest turn boundary", async () => {
  const { client, events } = makeClient({ blockUntilCancel: true });
  await client.connect();
  const prompted = client.prompt([{ type: "text", text: "wait" }]);
  await delay(10);
  await client.cancel();
  const stop = await prompted;
  assert.equal(stop, "cancelled");
  assert.ok(events.some((e) => e.turn?.stopReason === "cancelled"));
  await client.close();
});

test("late updates after prompt resolution are attributed and surfaced, not dropped", async () => {
  const { client, events } = makeClient({ resolveBeforeLastUpdate: true });
  await client.connect();
  const stop = await client.prompt([{ type: "text", text: "hi" }]);
  assert.equal(stop, "end_turn");
  await delay(40);
  assert.ok(events.some((e) => e.turn));
  assert.ok(events.some((e) => e.late && e.update?.type === "message"), "late update surfaced");
  await client.close();
});

test("permission requests are surfaced with the harness's own options and answered verbatim", async () => {
  const { client } = makeClient({ requestPermission: true });
  await client.connect();
  const seen: { value: { options: string[]; requestId: string } | null } = { value: null };
  client.onPermissionRequest((request) => {
    seen.value = { options: request.options.map((o) => o.optionId), requestId: request.requestId };
  });
  const prompted = client.prompt([{ type: "text", text: "write" }]);
  await delay(20);
  assert.ok(seen.value);
  assert.deepEqual(seen.value.options, ["allow_once", "reject_once"]);
  await client.respondPermission(seen.value.requestId, seen.value.options[0]);
  const stop = await prompted;
  assert.equal(stop, "end_turn");
  await client.close();
});

test("the MCP vault entry is advertised only when the harness supports HTTP MCP", async () => {
  const entry: McpServerEntry = {
    name: "vault",
    type: "http",
    url: "http://127.0.0.1:4321/mcp",
    headers: [{ name: "Authorization", value: "Bearer session-token" }],
  };
  const loads: unknown[] = [];

  const supported = makeClient(
    { capabilities: { mcpHttp: true }, onSessionRequest: (_m, params) => loads.push(params) },
    { mcpServer: () => entry },
  );
  await supported.client.connect();
  assert.deepEqual((loads[0] as { mcpServers: unknown[] }).mcpServers, [entry]);
  await supported.client.close();

  loads.length = 0;
  const unsupported = makeClient(
    { capabilities: { mcpHttp: false }, onSessionRequest: (_m, params) => loads.push(params) },
    { mcpServer: () => entry },
  );
  await unsupported.client.connect();
  assert.deepEqual((loads[0] as { mcpServers: unknown[] }).mcpServers, []);
  assert.equal(unsupported.client.getCapabilitiesSnapshot().mcpHttp, false);
  await unsupported.client.close();
});

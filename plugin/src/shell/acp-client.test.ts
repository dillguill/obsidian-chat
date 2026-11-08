import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AcpShellClient, type McpServerEntry } from "./acp-client.ts";
import type { ShellEnvironment } from "./types.ts";
import type { TransportConnector } from "./transport.ts";
import { createMockAgent, linkedStreams, type MockAgentOptions } from "../../test/fixtures/mock-agent.ts";
import type { ChatEvent } from "../acp/types.ts";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

const env: ShellEnvironment = {
  canServeVault: () => true,
  readTextFile: async () => "file content",
  writeTextFile: async () => undefined,
};

function makeClient(
  options: MockAgentOptions = {},
  extra: {
    mcpServer?: () => McpServerEntry | null;
    approvalTimeoutMs?: number;
    connector?: TransportConnector;
  } = {},
): { client: AcpShellClient; events: ChatEvent[] } {
  const agentApp = createMockAgent(options);
  const streams = linkedStreams();
  agentApp.connect(streams.agentStream as never);
  const connector: TransportConnector =
    extra.connector ??
    {
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
    ...(extra.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: extra.approvalTimeoutMs } : {}),
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

test("explicit cancel resolves a parked approval cancelled and never approves", async () => {
  let response: unknown = null;
  const { client } = makeClient({
    requestPermission: true,
    onPermissionResponse: (value) => {
      response = value;
    },
  });
  await client.connect();
  const prompted = client.prompt([{ type: "text", text: "write" }]);
  await waitFor(() => client.pendingPermissionCount === 1);
  await client.cancel();
  assert.equal(client.pendingPermissionCount, 0, "the parked request was answered cancelled");
  await prompted;
  await delay(20);
  assert.deepEqual(response, { outcome: { outcome: "cancelled" } }, "cancel is never sent as an approval");
  await client.close();
});

test("transport loss cancels every parked approval and explains it in the transcript", async () => {
  const agentApp = createMockAgent({ requestPermission: true });
  const streams = linkedStreams();
  agentApp.connect(streams.agentStream as never);
  let drop: ((reason: string) => void) | null = null;
  const connector: TransportConnector = {
    connect: async () => ({
      label: "mock",
      stream: streams.clientStream as never,
      close: async () => undefined,
      onClose: (callback) => {
        drop = callback;
        return () => undefined;
      },
    }),
  };
  const { client, events } = makeClient({ requestPermission: true }, { connector, approvalTimeoutMs: 0 });
  await client.connect();
  const prompted = client.prompt([{ type: "text", text: "write" }]);
  const settled = prompted.catch((err: unknown) => err as Error);
  await waitFor(() => client.pendingPermissionCount === 1);
  drop!?.("host connection closed");
  await delay(20);
  assert.equal(client.pendingPermissionCount, 0);
  assert.ok(
    events.some(
      (event) =>
        event.error?.scope === "transport" &&
        /1 pending approval were cancelled/i.test(event.error.message) &&
        /host connection closed/.test(event.error.message),
    ),
    "the transcript says why the card disappeared",
  );
  await settled;
  await client.close();
});

test("an approval timeout cancels the request (never approves) and says so", async () => {
  const { client, events } = makeClient({ requestPermission: true }, { approvalTimeoutMs: 25 });
  await client.connect();
  const prompted = client.prompt([{ type: "text", text: "write" }]);
  await waitFor(() => client.pendingPermissionCount === 1);
  await waitFor(() => events.some((event) => /timed out/i.test(event.error?.message ?? "")), 1_000);
  assert.equal(client.pendingPermissionCount, 0);
  assert.ok(events.some((event) => event.error?.scope === "permission"), "timeout is surfaced");
  const stop = await prompted;
  assert.equal(stop, "end_turn", "the harness continued after the cancellation; nothing was approved");
  await client.close();
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition timed out");
    await delay(5);
  }
}

const modeState = {
  currentModeId: "build",
  availableModes: [
    { id: "build", name: "Build" },
    { id: "plan", name: "Plan" },
  ],
} as never;

const configState = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "m1",
    options: [
      { value: "m1", name: "Model One" },
      { value: "m2", name: "Model Two" },
    ],
  },
  { id: "thinking", name: "Thinking", category: "thought_level", type: "boolean", currentValue: false },
] as never;

test("mode/config selections are forwarded unchanged in ACP's tagged shapes", async () => {
  const requests: Array<{ method: string; params: unknown }> = [];
  const { client } = makeClient({
    modes: modeState,
    configOptions: configState,
    onControlRequest: (method, params) => requests.push({ method, params }),
  });
  await client.connect();
  await client.setMode("plan");
  await client.setConfigOption("model", "m2");
  await client.setConfigOption("thinking", true);
  assert.deepEqual(requests[0], {
    method: "set_mode",
    params: { sessionId: "session_mock_1", modeId: "plan" },
  });
  assert.deepEqual(requests[1], {
    method: "set_config_option",
    params: { sessionId: "session_mock_1", configId: "model", value: "m2" },
  });
  assert.deepEqual(requests[2], {
    method: "set_config_option",
    params: { sessionId: "session_mock_1", configId: "thinking", type: "boolean", value: true },
  });
  await client.close();
});

test("reapplyControls resends only the session's last selected declared values", async () => {
  const requests: Array<{ method: string; params: unknown }> = [];
  const { client } = makeClient({
    modes: modeState,
    configOptions: configState,
    onControlRequest: (method, params) => requests.push({ method, params }),
  });
  await client.connect();
  await client.setMode("plan");
  await client.setConfigOption("model", "m2");
  requests.length = 0;
  // This is the helper the reconnect/resume path calls after session/load.
  await client.reapplyControls();
  const reapplied = requests.map((request) => ({
    method: request.method,
    params: request.params as Record<string, unknown>,
  }));
  assert.ok(
    reapplied.some((request) => request.method === "set_mode" && request.params.modeId === "plan"),
    "the last selected mode is reapplied",
  );
  assert.ok(
    reapplied.some((request) => request.method === "set_config_option" && request.params.configId === "model" && request.params.value === "m2"),
    "the last selected config value is reapplied",
  );
  assert.equal(requests.some((request) => (request.params as Record<string, unknown>).configId === "invented"), false);
  await client.close();
});

test("declared controls update live from harness notifications", async () => {
  const updates: SessionUpdate[] = [
    { sessionUpdate: "current_mode_update", currentModeId: "plan" } as SessionUpdate,
    {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "m2",
          options: [
            { value: "m1", name: "Model One" },
            { value: "m2", name: "Model Two" },
          ],
        },
      ],
    } as unknown as SessionUpdate,
    {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "compact", description: "Compact" }],
    } as unknown as SessionUpdate,
  ];
  const { client } = makeClient({ modes: modeState, configOptions: configState, updates });
  await client.connect();
  await client.prompt([{ type: "text", text: "hi" }]);
  await delay(25);
  assert.equal(client.getModes()?.currentModeId, "plan");
  assert.equal(client.getConfigOptions()?.[0].currentValue, "m2");
  assert.deepEqual(client.getCommands()?.map((command) => command.name), ["compact"]);
  await client.close();
});

test("a second prompt while a turn is in flight is rejected locally", async () => {
  const { client } = makeClient({ promptDelayMs: 80 });
  await client.connect();
  const first = client.prompt([{ type: "text", text: "first" }]);
  await assert.rejects(client.prompt([{ type: "text", text: "second" }]), /already in flight/);
  assert.equal(await first, "end_turn");
  await client.close();
});

import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { VaultMcpServer } from "./mcp-server.ts";
import { FakeVault } from "../../test/fixtures/fake-vault.ts";
import { AcpFileEnvironment } from "./acp-fs.ts";
import type { PathPolicyConfig } from "./path-policy.ts";

const policy: PathPolicyConfig = {
  vaultRoot: "/vault",
  harnessRoot: "/vault",
  blacklist: ["Private"],
  protectedPrefixes: [".chat/sessions"],
};

function fixtureVault(): FakeVault {
  return new FakeVault(
    {
      "Inbox/idea.md": { content: "an idea about gardening", tags: ["#idea"], headings: [{ level: 1, heading: "Idea", line: 0 }] },
      "Notes/project.md": {
        content: "project links to [[Inbox/idea]]",
        tags: ["#project"],
        links: ["Inbox/idea.md"],
        headings: [
          { level: 1, heading: "Project", line: 0 },
          { level: 2, heading: "Next", line: 4 },
        ],
      },
      "Private/secret.md": { content: "hidden", tags: ["#secret"] },
    },
    ["Private"],
  );
}

function createServerFor(vault = fixtureVault(), token: string | null = "tok") {
  return new VaultMcpServer({ vault, policy: () => policy, token: () => token, version: "9.9.9" });
}

type RpcReply = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string };
};

let nextId = 0;
async function call(server: VaultMcpServer, method: string, params?: unknown): Promise<RpcReply> {
  const reply = (await server.handle({ jsonrpc: "2.0", id: ++nextId, method, params })) as RpcReply;
  assert.ok(reply, `no reply for ${method}`);
  return reply;
}

async function callTool(server: VaultMcpServer, name: string, args: Record<string, unknown> = {}) {
  const reply = await call(server, "tools/call", { name, arguments: args });
  assert.ok(reply.result, `tool ${name} failed at the protocol layer: ${JSON.stringify(reply.error)}`);
  return reply.result as { content: { type: string; text: string }[]; isError?: boolean };
}

function parseTool(result: { content: { type: string; text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

test("initialize reports the MCP protocol version and tools-only capability", async () => {
  const reply = await call(createServerFor(), "initialize");
  assert.equal(reply.result.protocolVersion, "2025-06-18");
  assert.deepEqual(reply.result.capabilities, { tools: {} });
  assert.equal(reply.result.serverInfo.name, "obsidian-vault");
  assert.equal(reply.result.serverInfo.version, "9.9.9");
  assert.equal(reply.result.capabilities.resources, undefined);
});

test("tools/list exposes exactly the six read-only vault tools", async () => {
  const reply = await call(createServerFor(), "tools/list");
  const tools = reply.result.tools as { name: string; annotations: Record<string, unknown> }[];
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["get_backlinks", "get_links", "get_note_metadata", "get_outline", "list_tags", "search_notes"],
  );
  for (const tool of tools) {
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false }, tool.name);
  }
  for (const forbidden of ["write", "edit", "append", "delete", "move", "rename", "command"]) {
    assert.ok(!tools.some((t) => t.name.includes(forbidden)), `write-shaped tool ${forbidden}`);
  }
});

test("search finds notes and keeps blacklisted ones invisible", async () => {
  const server = createServerFor();
  const hits = parseTool(await callTool(server, "search_notes", { query: "gardening" })) as { path: string }[];
  assert.deepEqual(hits.map((h) => h.path), ["Inbox/idea.md"]);

  const secret = parseTool(await callTool(server, "search_notes", { query: "hidden" })) as { path: string }[];
  assert.deepEqual(secret, []);
});

test("search honours the folder filter, tags and limit", async () => {
  const server = createServerFor();
  const limited = await callTool(server, "search_notes", { query: ".", limit: 1 });
  assert.ok((parseTool(limited) as unknown[]).length <= 1);

  const tagged = parseTool(await callTool(server, "search_notes", { query: "project", tags: ["#project"] })) as {
    path: string;
  }[];
  assert.deepEqual(tagged.map((h) => h.path), ["Notes/project.md"]);

  const folder = parseTool(await callTool(server, "search_notes", { query: "idea", folder: "Inbox" })) as {
    path: string;
  }[];
  assert.deepEqual(folder.map((h) => h.path), ["Inbox/idea.md"]);
});

test("backlinks, links, outline, tags and metadata come from the shared service", async () => {
  const server = createServerFor();

  const backlinks = parseTool(await callTool(server, "get_backlinks", { path: "Inbox/idea.md" })) as {
    path: string;
  }[];
  assert.deepEqual(backlinks.map((b) => b.path), ["Notes/project.md"]);

  const links = parseTool(await callTool(server, "get_links", { path: "Notes/project.md" })) as {
    path: string;
    resolved: boolean;
  }[];
  assert.deepEqual(links, [{ path: "Inbox/idea.md", title: "Inbox/idea", resolved: true }]);

  const outline = parseTool(await callTool(server, "get_outline", { path: "Notes/project.md" })) as {
    heading: string;
  }[];
  assert.deepEqual(outline.map((h) => h.heading), ["Project", "Next"]);

  const tags = parseTool(await callTool(server, "list_tags", { prefix: "#pro" })) as { tag: string }[];
  assert.deepEqual(tags.map((t) => t.tag), ["#project"]);

  const meta = parseTool(await callTool(server, "get_note_metadata", { path: "Notes/project.md" })) as {
    title: string;
    backlinkCount: number;
    links: number;
  };
  assert.equal(meta.title, "Notes/project");
  assert.equal(meta.links, 1);
  assert.equal(meta.backlinkCount, 0);
});

test("blacklisted, configuration and missing paths are tool errors", async () => {
  const server = createServerFor();
  for (const path of ["Private/secret.md", ".obsidian/app.json", ".chat/sessions/s_1.jsonl", "Notes/missing.md"]) {
    const result = await callTool(server, "get_outline", { path });
    assert.equal(result.isError, true, path);
    assert.match(result.content[0].text, /refused|not found/);
  }
});

test("absolute paths inside the vault are accepted, outside ones refused", async () => {
  const server = createServerFor();
  const inside = await callTool(server, "get_outline", { path: "/vault/Notes/project.md" });
  assert.equal(inside.isError, undefined);
  const outside = await callTool(server, "get_outline", { path: "/etc/passwd" });
  assert.equal(outside.isError, true);
  assert.match(outside.content[0].text, /outside the harness root|refused/);
});

test("invalid arguments produce tool errors, not protocol errors", async () => {
  const server = createServerFor();
  for (const args of [{}, { query: 42 }, { query: "x", limit: 0 }, { query: "x", limit: "many" }]) {
    const result = await callTool(server, "search_notes", args as Record<string, unknown>);
    assert.equal(result.isError, true, JSON.stringify(args));
  }
});

test("unknown tools and methods are protocol errors", async () => {
  const server = createServerFor();
  const unknownTool = await call(server, "tools/call", { name: "write_note", arguments: {} });
  assert.equal(unknownTool.error?.code, -32602);
  const unknownMethod = await call(server, "resources/list");
  assert.equal(unknownMethod.error?.code, -32601);
});

test("notifications get no reply", async () => {
  const server = createServerFor();
  assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await server.handle([{ jsonrpc: "2.0", method: "notifications/initialized" }]), null);
});

test("bearer authorization is constant-time, session-scoped and fails closed", async () => {
  const vault = fixtureVault();
  let token: string | null = "one";
  const server = new VaultMcpServer({ vault, policy: () => policy, token: () => token });

  assert.equal(server.authorize("Bearer one"), true);
  assert.equal(server.authorize("bearer one"), true);
  assert.equal(server.authorize("Bearer two"), false);
  assert.equal(server.authorize("Bearer "), false);
  assert.equal(server.authorize(undefined), false);
  assert.equal(server.authorize("one"), false);

  token = null;
  assert.equal(server.authorize("Bearer one"), false, "a revoked session token never authorizes again");
});

test("the HTTP transport enforces loopback, method, token and JSON parsing", async () => {
  const token = { value: "local-token" };
  const server = new VaultMcpServer({ vault: fixtureVault(), policy: () => policy, token: () => token.value });
  const { createVaultMcpHandler } = await import("../shell/host-server.ts");
  const handler = createVaultMcpHandler({ server, token: () => token.value });
  const httpServer = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/mcp`;

  const post = (body: string, headers: Record<string, string> = {}) =>
    fetch(base, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

  try {
    const ok = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), {
      authorization: "Bearer local-token",
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { jsonrpc: "2.0", id: 1, result: {} });
    assert.equal(ok.headers.get("mcp-protocol-version"), "2025-06-18");

    assert.equal((await post(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }))).status, 401);
    assert.equal(
      (await post(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }), { authorization: "Bearer wrong" }))
        .status,
      401,
    );

    const get = await fetch(base, { headers: { authorization: "Bearer local-token" } });
    assert.equal(get.status, 405);

    const malformed = await post("{not json", { authorization: "Bearer local-token" });
    assert.equal(malformed.status, 200);
    assert.equal(((await malformed.json()) as { error: { code: number } }).error.code, -32700);

    const notification = await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), {
      authorization: "Bearer local-token",
    });
    assert.equal(notification.status, 202);

    const toolCall = await post(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_tags", arguments: {} } }),
      { authorization: "Bearer local-token" },
    );
    assert.equal(toolCall.status, 200);
    assert.ok(((await toolCall.json()) as RpcReply).result);
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test("ACP fs and MCP tools share exactly the same path verdicts", async () => {
  const env = new AcpFileEnvironment({
    policy: () => policy,
    readText: async () => "",
    writeText: async () => undefined,
    fileFor: () => null,
  });
  const server = createServerFor();
  const cases = [
    { path: "/vault/Inbox/idea.md", allowed: true },
    { path: "/vault/Private/secret.md", allowed: false },
    { path: "/vault/.obsidian/app.json", allowed: false },
    { path: "/vault/.chat/sessions/s_1.jsonl", allowed: false },
    { path: "/etc/passwd", allowed: false },
    { path: "/vault/../escape.md", allowed: false },
  ];
  for (const { path, allowed } of cases) {
    let fsAllowed = true;
    try {
      env.relPath(path);
    } catch {
      fsAllowed = false;
    }
    const mcp = await callTool(server, "get_outline", { path });
    const mcpAllowed = mcp.isError === undefined;
    assert.equal(fsAllowed, allowed, `fs verdict for ${path}`);
    assert.equal(mcpAllowed, allowed, `mcp verdict for ${path}`);
    assert.equal(mcpAllowed, fsAllowed, `shared policy diverged for ${path}`);
  }
});

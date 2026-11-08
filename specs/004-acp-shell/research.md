# Phase 0 Research — ACP Shell

**Date**: 2026-11-07

**Feature**: `specs/004-acp-shell/spec.md` (approved 2026-11-07)

**Input**: Feature specification plus `.specify/memory/constitution.md` v1.1.0 and the proposed
v2.0.0 amendment in `specs/004-acp-shell/constitution-amendment.md` (not applied). Plan template:
`.specify/templates/plan-template.md`. Current plugin: `plugin/src/**`.

**Method**: every API claim below was checked against the installed packages and the current source
in this worktree. Dependencies resolve from the parent checkout
(`/workspace/obsidian-chat/node_modules`), because this worktree has no `node_modules` of its own;
paths beginning `node_modules/` are relative to that checkout. No code, settings, or other file was
modified; this is the only file written.

**Architecture fixed by the brief (not researched as a choice)**: one host-owned Obsidian desktop
process spawns one ACP harness child over stdio; paired devices attach to that host over ACP/WebSocket;
one listener carries the ACP and loopback MCP endpoints; the host executes ACP `fs/*` capabilities
through one shared in-process `VaultService`; MCP is read-only; conversations are host-owned
append-only JSONL; continuity is resume → load → explicit digest/fresh; the UI is a generic ACP
renderer; the legacy path is deleted at the end.

---

## R1 — ACP SDK v1.4.0 API surface and message shapes

### Decision

Use `@agentclientprotocol/sdk` **1.4.0** as the only ACP implementation, on both sides:

- **Client side (shell → harness, and remote device → host)**: `client({ name })` +
  `connectWith(stream, ctx => …)` for one-shot workflows, or `connect(stream)` for a long-lived
  `ClientConnection` whose `.agent` is a `ClientContext`; transports are `ndJsonStream(output,
  input)` for stdio and `createWebSocketStream(url, opts)` from the **`experimental/ws-client`**
  subpath for WebSocket.
- **Server side (host → paired device)**: `agent({ name })` with typed `onRequest`/`onNotification`
  handlers, served per WebSocket connection through
  `AcpServer.prepareWebSocketUpgrade({ createAgent })` from the **`experimental/server`** subpath.
  `AgentSideConnection` still exists but is deprecated in 1.4.0; do not build on it.
- **Protocol version**: `PROTOCOL_VERSION === 1`. `initialize` is **not automatic** — the client
  must send it explicitly before any session call, and must check the negotiated
  `protocolVersion` (a non-1 value is a hard attach error).
- **Capability advertisement**: `clientCapabilities.fs = { readTextFile: true, writeTextFile: true }`
  on the host-side client; `terminal` omitted/`false`; image/audio prompt content only when
  `agentCapabilities.promptCapabilities` allows it; MCP only when
  `agentCapabilities.mcpCapabilities.http === true`.
- **Method constants**: use `methods.agent.session.*` / `methods.client.session.*` rather than
  string literals.

Exact request/response shapes used by the shell (all from
`node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts`; the same shapes exist as
`$defs` in `node_modules/@agentclientprotocol/sdk/schema/schema.json`):

| Method | Direction | Request fields | Response fields |
|---|---|---|---|
| `initialize` | client → agent | `protocolVersion`, `clientCapabilities?`, `clientInfo?` (`InitializeRequest`, :4148) | `protocolVersion`, `agentCapabilities?`, `authMethods?`, `agentInfo?` (`InitializeResponse`, :1469) |
| `session/new` | client → agent | `cwd` (absolute), `mcpServers` (required array), `additionalDirectories?` (`NewSessionRequest`, :4692) | `sessionId`, `modes?`, `configOptions?` (`NewSessionResponse`, :2530) |
| `session/resume` | client → agent | `sessionId`, `cwd`, `additionalDirectories?`, `mcpServers?` (`ResumeSessionRequest`, :5018) | `modes?`, `configOptions?` (`ResumeSessionResponse`, :2894) — **no history replay** |
| `session/load` | client → agent | `sessionId`, `cwd`, `mcpServers` (required), `additionalDirectories?` (`LoadSessionRequest`, :4885) | `modes?`, `configOptions?` (`LoadSessionResponse`, :2756); prior history is replayed as `session/update` notifications **before** the response |
| `session/prompt` | client → agent | `sessionId`, `prompt: ContentBlock[]` (`PromptRequest`, :5140) | `stopReason` (`end_turn` \| `max_tokens` \| `max_turn_requests` \| `refusal` \| `cancelled`), optional `usage?` (`PromptResponse`, :2970; `StopReason` :3001) |
| `session/cancel` | client → agent | **notification** `sessionId` (`CancelNotification`, :5890) | none |
| `session/set_mode` | client → agent | `sessionId`, `modeId` (`SetSessionModeRequest`, :5079) | `{}` (`SetSessionModeResponse`) |
| `session/set_config_option` | client → agent | `sessionId`, `configId` and either `{ value: string }` or `{ value: boolean, type: "boolean" }` (`SetSessionConfigOptionRequest`, :5102) | `configOptions` (full set) (`SetSessionConfigOptionResponse`) |
| `session/request_permission` | **agent → client** | `sessionId`, `toolCall: ToolCallUpdate`, `options: PermissionOption[]` (`RequestPermissionRequest`, :108) | `{ outcome: { outcome: "selected", optionId } \| { outcome: "cancelled" } }` (`RequestPermissionResponse`, :5613; `RequestPermissionOutcome`) |
| `fs/read_text_file` | **agent → client** | `sessionId`, `path` (absolute), `line?` (1-based), `limit?` (`ReadTextFileRequest`, :73) | `{ content: string }` (`ReadTextFileResponse`, :5594) |
| `fs/write_text_file` | **agent → client** | `sessionId`, `path` (absolute), `content` (`WriteTextFileRequest`, :35) | `{}` / void (`WriteTextFileResponse`, :5579) |
| `session/update` | agent → client | **notification** `{ sessionId, update: SessionUpdate }` (`SessionNotification`, :3383) | none |

`SessionUpdate` (:3410) is a closed union of 15 kinds in 1.4.0:
`user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`,
`plan`, `plan_update`, `plan_removed`, `available_commands_update`, `current_mode_update`,
`config_option_update`, `session_info_update`, `usage_update`, `compaction_update`,
`compaction_summary_chunk`. Anything outside this union must still be rendered raw (R8), because a
newer agent may send a kind this SDK version does not know.

Optional lifecycle methods used by the relay, not by the shell↔harness turn path:
`session/list` (`ListSessionsRequest`/`ListSessionsResponse`, `SessionInfo`) for the host's stored
history and `session/close` (`CloseSessionRequest`) for explicit teardown; both are gated on
`sessionCapabilities.list` / `sessionCapabilities.close` when talking to a harness, while the host
always serves `list` from its own record.

Relevant nested types: `ContentBlock` (:249) is `text | image | audio | resource_link | resource`;
`ToolCall` (:3479) carries `toolCallId`, `title` (required), `name?`, `kind?`, `status?`, `content?`,
`locations?`, `rawInput?`, `rawOutput?`; `ToolCallUpdate` (:140) makes every field except
`toolCallId` optional (partial updates replace only present fields); `ToolCallContent` (:226) is
`content | diff | terminal`; `ToolKind` (:209) is the fixed ten-value enum; `ToolCallStatus` (:217) is
`pending | in_progress | completed | failed`; `Diff` (:522) is `{ path, oldText?, newText }`;
`PermissionOption` (:604) is `{ optionId, name, kind }` with
`kind: allow_once | allow_always | reject_once | reject_always`.

Capabilities: `AgentCapabilities` (:1517) has top-level `loadSession?`, `promptCapabilities?`,
`mcpCapabilities?`, and `sessionCapabilities?`; `SessionCapabilities` (:1670) has `resume?`, `list?`,
`delete?`, `close?`, `fork?`, `additionalDirectories?`. `session/load` is gated by the **legacy
top-level** `agentCapabilities.loadSession`, not by `sessionCapabilities`; `session/resume` is gated
by `sessionCapabilities.resume`. `McpCapabilities.http` (:1629) gates whether an `http` MCP server
entry may be sent at all. `ClientCapabilities.fs` is `FileSystemCapabilities` (:4265), whose fields
are `readTextFile?` and `writeTextFile?`.

### Rationale

The SDK's generated types are the protocol; hand-writing JSON-RPC duplicates them and immediately
drifts (the current `plugin/src/host/jsonrpc.ts` is exactly that drift: no typed params, no
capability model, no `initialize` result). The 1.4.0 app API also provides connection-scoped handler
contexts, which is what a host relay needs: `AgentConnection.client` is an `AgentContext` that can
call back into a paired device (permission requests, replay notifications), and
`ClientConnection.agent` is a `ClientContext` that calls the harness. `session/resume`'s schema
description is explicit that it resumes **without returning previous messages (unlike
`session/load`)**, so the ladder in R7 is protocol-backed, not an interpretation.

`PROTOCOL_VERSION` is 1 (`node_modules/@agentclientprotocol/sdk/dist/schema/index.js:51`), matching
the shell's ACP v1 target.

### Alternatives considered

- **Keep the hand-rolled `JsonRpcPeer`** (`plugin/src/host/jsonrpc.ts`): rejected. It is a second
  protocol implementation with no validation, no method typing, and no capability negotiation; it
  already skips `initialize` in places. It also violates Constitution Principle I/IV once the SDK
  covers the seam.
- **Use only the deprecated `ClientSideConnection` / `AgentSideConnection` classes**: they still
  work in 1.4.0 but are marked deprecated (`dist/acp.d.ts:754`, `:981`); new code should use
  `client()` / `agent()` and `AcpServer`.
- **Pin to an older SDK** (e.g. 0.x) with a smaller surface: rejected; 1.4.0 is installed, its
  schema includes `session/resume`, `plan_removed`, `compaction_*`, and the server transport the
  host needs.
- **Use ACP v2 experimental entry point**: rejected; the spec targets ACP v1 and v2 is explicitly a
  draft (`node_modules/@agentclientprotocol/sdk/README.md` "Experimental ACP v2").

### Evidence

- `node_modules/@agentclientprotocol/sdk/package.json`: version `1.4.0`; exports `.`,
  `./experimental/v2`, `./experimental/http-client`, `./experimental/ws-client`,
  `./experimental/server`, `./experimental/node`; `"type": "module"`; peer `zod`.
- `dist/acp.d.ts:5` (re-exports `AGENT_METHODS`, `CLIENT_METHODS`, `PROTOCOL_METHODS`,
  `PROTOCOL_VERSION`), `:28` (`ndJsonStream`), `:39` (`methods`), `:680` (`client`), `:610`
  (`agent`), `:757` (deprecated `AgentSideConnection`), `:754` (deprecation note).
- `dist/ws-stream.d.ts:54` (`createWebSocketStream`); package export
  `./experimental/ws-client` → `dist/ws-stream.js`.
- `dist/server.d.ts:64` (`AcpServer`), `:70` (`handleRequest`), `:72`
  (`prepareWebSocketUpgrade`); `dist/node-adapter.d.ts:15–16` (`createNodeHttpHandler`,
  `createNodeWebSocketUpgradeHandler`).
- `dist/schema/types.gen.d.ts` lines listed in the table; `schema/schema.json` `$defs` names
  (`NewSessionRequest`, `ResumeSessionRequest`, `LoadSessionRequest`, `RequestPermissionRequest`,
  `ReadTextFileRequest`, `WriteTextFileRequest`, `SessionUpdate`, …), 265 defs total.
- `dist/schema/types.gen.d.ts:1670` region (`SessionCapabilities`) and the schema description of
  `ResumeSessionRequest` ("Resumes an existing session without returning previous messages (unlike
  `session/load`)").
- SDK example wiring: `dist/examples/client.js:88` (`ndJsonStream`), `:95–98` (`connectWith` +
  `initialize`); `dist/examples/ws-client.js:44–67` (`createWebSocketStream` + `initialize` +
  `session/new`); `dist/examples/http-server.js:28–41` (`loadSession` replays history via
  `client.notify(session/update, …)` before returning).

---

## R2 — Turn lifecycle and the prompt/update ordering anomaly

### Decision

- **A turn ends exactly when the `session/prompt` request resolves** with a `stopReason`; an error
  response ends it as an error, and a transport/harness death ends it as *interrupted* (a shell
  status, not a fabricated ACP stop reason). There is no `turn_end` wire event and no quiet-period
  completion.
- **The host does not delay the prompt response to hide the anomaly.** It resolves the remote
  `session/prompt` as soon as the harness resolves, with the harness's `stopReason` (the
  `host-transport.md` contract requires this).
- **Post-resolution attribution window**: the session owner keeps `lastTurn` (turn number, start
  time) after writing the turn's boundary entry. Any `session/update` for that session that arrives
  after resolution is:
  1. persisted as a normal `update` entry with `turn = lastTurn`, `late: true`;
  2. forwarded to the owning device with ACP `_meta` (`obsidian-chat/turn`, `obsidian-chat/late`);
  3. rendered into that turn if its card is still the current turn; otherwise rendered as a
     generic "late ACP update (arrived after the turn ended)" row inside that turn's raw view.
  Nothing is dropped and nothing is reclassified as a new turn. Updates are attributed to
  `lastTurn` until the next prompt starts; after that they are marked `orphan: true` and kept in
  the raw record for that same turn.
- Before starting a new prompt, the host waits for its per-session update queue to drain (bounded,
  250 ms) so a late update cannot land inside the new turn's first events.
- Constants: `LATE_ATTRIBUTION_WINDOW_MS = 2_000` (the UI treats a late update as belonging to the
  just-ended turn for this long; the store attributes it to `lastTurn` until the next prompt
  starts), `UPDATE_QUEUE_DRAIN_MS = 250`, `CANCEL_RESPONSE_TIMEOUT_MS = 5_000`. These are
  implementation constants, not protocol semantics.

**Known risk, stated plainly**: no purely event-driven client can distinguish "the harness sent its
last update before the response on the wire" from "the harness will send more updates after the
response". The ACP contract says the response is authoritative; a harness that violates it (opencode)
can only be handled heuristically. The mitigation above preserves every byte and never invents
completion, at the cost that a late chunk can appear after the answer (marked as late). This is the
honest failure mode; a held response would add latency to every turn and a custom envelope would
violate FR-043/FR-070.

### Rationale

The anomaly is real and already documented in this repo: `plugin/src/host/server.ts:51–54` says
"Some harnesses resolve `session/prompt` before their last `session/update` notifications are
written"; the old host compensated with `TURN_END_QUIET_MS = 300` / `TURN_END_MAX_WAIT_MS = 3000`
(`server.ts:53–54`) and published a synthetic `turn_end` (`server.ts:204–222`). The chat view then
had to *drop* stale reasoning bursts (`plugin/src/ui/chat-view.ts:2162–2175`, citing
anomalyco/opencode#17505 and #18672). Both behaviours are disallowed by the new spec (FR-043 "no
kind may be silently dropped"; FR-048 raw record; FR-070 delete the custom envelope). Attribution
keeps the record lossless and the ACP response meaningful.

### Alternatives considered

- **Keep the quiet-period + `turn_end` envelope** (`server.ts:204–222`): rejected. It is a custom
  protocol event (Constitution I/IV, FR-070), it makes "turn ended" a timing guess, and a slow
  harness silently adds 300 ms to every turn.
- **Delay the `session/prompt` response until the stream is quiet**: rejected. It converts the
  response into a quiet-period completion, contradicts `contracts/acp-shell.md` §4, adds latency to
  every turn, and still has a maximum-wait fallback that can misfire.
- **Drop updates that arrive after resolution** (the current UI behaviour for reasoning): rejected;
  FR-043 forbids dropping any update.
- **Buffer late updates and never show them**: rejected; the raw record may keep them, but visible
  content must not vanish.

### Evidence

- `plugin/src/host/server.ts:49` (`REPLAY_LIMIT`), `:51–54` (anomaly comment and constants),
  `:192–222` (`publish`, `runPrompt`, synthetic `turn_end`).
- `plugin/src/ui/chat-view.ts:2162–2175` (`turnSettled`; opencode issues #17505/#18672),
  `:2120` (drops stale reasoning).
- `node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts:2970–3001`
  (`PromptResponse.stopReason`, `StopReason`); `:5890` (`session/cancel` is a notification).
- `specs/004-acp-shell/contracts/acp-shell.md` §4 (turn ends on resolution; no synthetic
  terminator; late-update handling).
- `specs/004-acp-shell/contracts/host-transport.md` §3 (host resolves the remote prompt only when
  the harness prompt resolves, with the harness stop reason).

---

## R3 — Transports: stdio, WebSocket client, and the host WebSocket listener

### Decision

**Local (host → harness)**: `child_process.spawn(command, args, { stdio: ["pipe","pipe","pipe"], cwd: vaultBasePath })`,
then `ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))` and
`client({name}).connect(stream)`. Keep the existing quote-aware `splitCommand`
(`plugin/src/host/server.ts:61–67`) and PATH augmentation (`:375–385`); keep the Windows `.cmd`
`shell: true` exception. Spawn only on desktop, lazily `require("child_process")`.

**Remote (device → host)**: `createWebSocketStream("ws://<host>:<port>/acp?token=<device-token>",
{ WebSocket: <optional ctor>, cookies: "omit" })`, then `initialize` + `session/load` on reconnect.

- On **desktop** the optional constructor may be `ws.WebSocket`, which supports custom headers; on
  **mobile** there is no `ws`, so omit the option and use `globalThis.WebSocket` (browser WebSocket).
  Because a browser WebSocket cannot set request headers, the token must be accepted as a query
  parameter (`?token=`); header auth is an optional second form for Node clients.
- Do not pass `protocols` with a token; subprotocol strings are visible in some proxies and are no
  safer than the query string.

**Host listener**: one `http.createServer()` in the plugin process:

- `POST /mcp` → read-only MCP handler (R4), loopback + per-session token.
- `GET /acp` with `Upgrade: websocket` → authenticate the device **before** the handshake, then
  `ws.WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false })`
  and `handleUpgrade(req, socket, head, ws => prepared.accept(ws))`.
- `AcpServer.prepareWebSocketUpgrade({ createAgent: () => relayAgentFor(deviceId) })` from the SDK's
  `experimental/server` subpath creates the ACP connection; `PreparedWebSocketUpgrade.accept(socket)`
  attaches it. This per-device factory is why the raw `ws` upgrade is done directly instead of via
  `createNodeWebSocketUpgradeHandler` (which cannot inject the device identity into the agent
  factory).
- Bind: `server.listen(port, host)` where `host` is `127.0.0.1` by default; a user-selected VPN
  interface/`0.0.0.0` only after explicit confirmation. No TLS in v1; `wss://` only if the user
  fronts it with their own terminator (the VPN is the security boundary per the spec assumptions).
- Heartbeat: `ws` ping every 15 s; terminate after two missed pongs.
- Framing: **one JSON-RPC message per WebSocket text frame**, not NDJSON. The SDK's client sends
  `JSON.stringify(message)` per `send` (`dist/ws-stream.js:110`) and the server parses each text
  frame as one JSON value (`dist/ws-server.js:67`); binary frames are ignored
  (`ws-server.js:64–66`). Do not add newline framing or a length prefix.
- Reconnect: remote keeps the `sessionId` (host relay id), reconnect with bounded exponential
  backoff (1 s → 15 s, 8 attempts; auth failures are not retried), send `initialize`, then
  `session/load { sessionId, cwd, mcpServers: [] }` with `_meta { "obsidian-chat/sinceSeq": n }`.
  The host replays stored entries as `session/update` with `_meta` seq (R7/`host-transport.md` §4).
  The remote never resends a prompt. ACP v1 does not replay in-flight transport messages
  (`dist/ws-stream.d.ts` doc comment), which is exactly why replay is record-based.
- Local chat UI path: the host's own view also attaches over the same loopback WebSocket with a
  per-host-run local token, so there is one transport, one auth boundary, and one relay path rather
  than a second in-process shortcut.

**Dependency finding**: `ws` is **not installed and not in the lockfile**. `npm ls ws` is empty and
`package-lock.json` contains no `node_modules/ws` or `@types/ws` entry. The ACP SDK only has `ws` in
its devDependencies (`ws ^8.18.0`, `@types/ws ^8.5.13`) and its examples import it; it is not a
runtime dependency of the SDK. Add to `plugin/package.json`:

```json
"devDependencies": {
  "ws": "^8.18.0",
  "@types/ws": "^8.5.13"
}
```

`ws` is bundled by esbuild (do **not** mark it external; Obsidian does not ship it). Add
`bufferutil` and `utf-8-validate` to esbuild `external` (optional native addons that `ws` probes
with `require` in a try/catch; leaving them unresolved produces build warnings). `ws` is CJS and
uses Node built-ins; with `platform: "node"` esbuild leaves those external, and the module is only
evaluated when the desktop-only host module is lazily required, so the mobile bundle never runs it.
Risk: new dependency + lockfile churn (the lockfile currently also carries a stale, `extraneous`
`harness` workspace stanza at `package-lock.json:15–26`; remove it in the same change).

### Rationale

The SDK already ships a standards-based server transport and a WebSocket client; using them means
the host is a standard ACP agent toward devices and a standard ACP client toward the harness, with no
private envelope. `ws` is unavoidable for the server half: the SDK accepts a prepared WebSocket
socket but does not implement RFC 6455 (the `AcpServer`/node-adapter docs make this explicit).
Query-token auth is forced by browser WebSocket constructors, which cannot set headers — the same
constraint the contract records.

### Alternatives considered

- **SDK Streamable HTTP instead of WebSocket for devices**: rejected. Obsidian's desktop renderer
  cannot reliably stream `fetch` responses (the current client documents CSP failures and uses raw
  Node `http` for SSE, `plugin/src/acp/client.ts:271–289`), `requestUrl` buffers whole responses,
  and a long-lived request per session is a worse fit than a socket. WebSocket is the SDK's
  first-class transport for this.
- **Hand-rolled WebSocket JSON-RPC** (reuse `plugin/src/host/jsonrpc.ts`): rejected for the same
  reasons as R1; also loses `AcpServer` connection registry, initialize gating, and backpressure.
- **One `AcpServer` for all devices with `createNodeWebSocketUpgradeHandler`**: workable if device
  identity is not needed in the agent factory, but it is (ownership checks, permission routing), so
  the direct `prepareWebSocketUpgrade({ createAgent })` path is simpler.
- **A second port for MCP** (or an MCP proxy command): rejected by FR-008 (one listener, two
  endpoints) and the current host already routes both on one port (`server.ts:242`, `:326–354`).
- **Token in a subprotocol**: rejected; no better than the query string and harder to keep out of
  logs.

### Evidence

- `node_modules/@agentclientprotocol/sdk/dist/ws-stream.js:9` (text frames), `:110`
  (`socket.send(JSON.stringify(message))`); `dist/ws-server.js:64–67` (text-only, per-frame JSON),
  `:282` (server send).
- `dist/ws-stream.d.ts` doc comment: "ACP v1 reconnect creates a new transport connection … ACP v1
  does not replay in-flight transport messages emitted while disconnected."
- `dist/server.d.ts:60–72`; `dist/node-adapter.d.ts:15–16`.
- `node_modules/@agentclientprotocol/sdk/package.json` devDependencies (`ws ^8.18.0`,
  `@types/ws ^8.5.13`); `dist/examples/ws-client.js:1` (`import { WebSocket } from "ws"`).
- `package-lock.json:15–26` (stale extraneous `harness` entry with `@modelcontextprotocol/sdk`);
  `package-lock.json` has no `ws` entry.
- `plugin/src/host/server.ts:61–67` (`splitCommand`), `:96` (`listen(port, "0.0.0.0")` — the current
  over-broad default), `:375–385` (`harnessPath`).
- `plugin/src/acp/client.ts:271–289` (desktop CSP/fetch limitation for long-lived streams).

---

## R4 — MCP server: transport, implementation, tools, token, bounds

### Decision

Keep a **minimal, hand-written, tool-only MCP server** in `plugin/src/vault/mcp-server.ts`, rewritten
to be read-only and backed by the shared `VaultService`. Do **not** add
`@modelcontextprotocol/sdk` in v1.

- **Transport**: MCP Streamable HTTP, stateless JSON-response mode, on the host's single listener at
  `POST /mcp`. One JSON-RPC message (or batch) per POST, `application/json` response; notification-
  only bodies return `202`; `GET /mcp` returns `405` (no SSE stream). Protocol version
  `2025-06-18`, `capabilities: { tools: { listChanged: false } }`,
  `serverInfo: { name: "obsidian-vault", version: <plugin version> }`.
- **Auth**: per-ACP-session bearer token minted with `crypto.getRandomValues` (24–32 bytes hex),
  validated in constant time, mapped `token → relay session id`, revoked on session close/harness
  respawn. Loopback check first (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), then token; anything else
  `401`. Never persist/log the token (do not store the raw `session/new` request — it contains the
  header).
- **Read-only tools** (exact six; no `read`/`list`/write/move/delete/command):

| Tool | Input schema | Result (text content) | Bound |
|---|---|---|---|
| `search_notes` | `{ query: string; limit?: 1..50 (10); folder?: string; tags?: string[] }` | one line per hit: `path\tscore\tsnippet` | 50 hits, snippet ≤ 400 chars |
| `get_backlinks` | `{ path: string; limit?: 1..50 (20) }` | `sourcePath\tcount` lines | 50 |
| `get_links` | `{ path: string }` | `target\tresolved\|unresolved` lines | 500 |
| `list_tags` | `{ prefix?: string; limit?: 1..200 (100) }` | `#tag\tcount` lines | 200 |
| `get_outline` | `{ path: string }` | `level\theading\tline` lines | 500 |
| `get_note_metadata` | `{ path: string }` | one JSON object: path, title, size, mtime, tags, frontmatter, link counts | 8 KiB |

All tools declare `annotations: { readOnlyHint: true, destructiveHint: false }`. Tool failures are
results with `isError: true` and a safe message; protocol errors only for malformed JSON-RPC. If the
harness does not advertise `agentCapabilities.mcpCapabilities.http`, the host must not pretend it
can attach a server: send `mcpServers: []` (the contract's "never empty on the host" applies only
when the capability is present), mark native tools unavailable in the UI, and keep chat working;
never return empty success.

- **Bound the result text** at 256 KiB per response (contract `vault-mcp.md` §5); truncate with an
  explicit `truncated: true` marker. Per-call timeout 5 s (search 2 s).
- **Protocol details to implement explicitly**: `initialize` / `notifications/initialized` (ignore
  notification) / `ping` / `tools/list` / `tools/call`; tolerate `MCP-Protocol-Version` and
  `Accept` headers without failing; reject unknown methods with `-32601`, unknown tools with
  `-32602` (tool error), malformed JSON with `-32700`.

### Rationale

The official SDK is **not installed**: `/workspace/obsidian-chat/node_modules/@modelcontextprotocol`
is an empty scope directory; `npm ls` shows nothing; the only reference in the repo is the stale,
`extraneous` `harness` stanza in `package-lock.json:15–26` (`@modelcontextprotocol/sdk ^1.30.0`).
Adopting it would mean a new dependency, a lockfile update, and a heavy transitive tree. A
machine-local pnpm copy of `@modelcontextprotocol/sdk@1.32.2` (outside this repo, not a dependency)
shows the shape of that tree: `express`, `hono`, `@hono/node-server`, `ajv`, `ajv-formats`, `jose`,
`cors`, `eventsource`, `cross-spawn`, `raw-body`, `zod`, `zod-to-json-schema`, plus a CF-worker
validation peer. It is dual ESM/CJS and its server transport files exist, so it is *usable* — but for
a stateless six-tool request/response server it is almost all dead weight in an Obsidian bundle.

The existing handler already implements exactly the stateless subset
(`plugin/src/host/vault-mcp.ts:9–13` explains why) in ~100 lines of dispatch; the rewrite is the
tool bodies plus the shared service, not a protocol implementation.

### Alternatives considered

- **Official `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`**: rejected for v1. Cost:
  new dep + heavy bundle; benefit: protocol conformance for features the shell does not use
  (sessions, SSE resumability, resources/prompts, auth). Revisit only if the minimal handler fails a
  real harness's client checks.
- **SSE transport**: rejected. It adds long-lived streams, event IDs, and reconnect logic for a
  request/response tool server; Obsidian's renderer streaming constraints (R3) make it worse.
- **Write tools through MCP** (the current handler has `write`/`append`/`edit`/`move`/`delete`,
  `vault-mcp.ts:180–282`): forbidden by FR-028/FR-025; they would create a second write path that
  bypasses ACP approvals and snapshots.
- **A separate MCP process / proxy**: forbidden by FR-030/FR-008 and the constitution amendment.

### Evidence

- `plugin/src/host/vault-mcp.ts:16` (`PROTOCOL_VERSION = "2025-06-18"`), `:32–93`
  (`initialize`/`tools/list`/`tools/call`), `:129–283` (tools, including the write/move/delete tools
  to be removed).
- `plugin/src/host/server.ts:249–259` (MCP server entry in `session/new`),
  `:326–354` (`routeMcp`: loopback check + token before dispatch), `:369–373` (`randomToken`).
- `plugin/src/host/server.ts:230` (CORS allow-list already includes `mcp-protocol-version`,
  `mcp-session-id`).
- `package-lock.json:15–26`; filesystem check of `node_modules/@modelcontextprotocol` (empty) and
  `npm ls` (no entry).
- `specs/004-acp-shell/contracts/vault-mcp.md` §1–§6 (transport/auth/tools/bounds).

---

## R5 — Obsidian runtime APIs for the shared VaultService

### Decision

Implement one `VaultService` (desktop host only) that owns all vault semantics; ACP `fs/*`, MCP
tools, and the mention index call it. It uses only the Obsidian API — no direct `fs` for vault
content.

- **Read**: resolve the vault-relative path through the path policy; if a `MarkdownView`/source
  editor has that file open, return `view.editor.getValue()` (current text, including unsaved
  edits); otherwise `vault.cachedRead(file)` (`obsidian.d.ts:7420`). Apply `line`/`limit`
  (1-based `line`, count `limit`) in memory. Return an error for a missing file or a folder.
- **Write**: policy check → ensure parent folders (create each missing segment; `vault.createFolder`
  throws if it exists, `obsidian.d.ts:7404`) → `vault.modify(file, content)` if it exists
  (`:7467`) or `vault.create(path, content)` if not (`:7386`). `vault.process(file, fn)` (`:7510`)
  is available for atomic read-modify-write and should be used where a race with an editor is
  possible; for a full-content ACP write, `modify` is the direct mapping. Best-effort snapshot is
  captured by the capability handler (not the service) before the first write per path per session.
- **Editor refresh**: after a write, for every `workspace.getLeavesOfType("markdown")` leaf whose
  `view.file?.path` matches: call `view.previewMode.rerender(true)` when `view.getMode() ===
  "preview"` (`MarkdownPreviewView.rerender`, `:4088`), and `view.editor.refresh()` for source mode
  (`Editor.refresh`, `:2414`). Rely on Obsidian's own `modify` event for the metadata cache; do not
  reload the workspace or close leaves.
- **Backlinks**: Obsidian 1.13.1 does **not** expose a public `getBacklinksForFile` (grep of
  `obsidian.d.ts` returns nothing). Compute them by inverting `metadataCache.resolvedLinks`
  (`:4438`): for each `source → {dest: count}`, collect entries where `dest === targetPath`; filter
  excluded sources; sort by count desc then path; return `{path, title, snippet?}`. `unresolvedLinks`
  (`:4444`) is available but is not a backlink to a real file.
- **Outgoing links**: `metadataCache.getFileCache(file)` (`:4417`) → `cache.links` (`LinkCache`,
  `:3711`) plus `cache.frontmatterLinks`; resolve with
  `metadataCache.getFirstLinkpathDest(link.link, file.path)` (`:4411`), or use
  `resolvedLinks[file.path]` for resolved-only output. Keep unresolved links visible with
  `resolved: false` (spec says outgoing links, not only resolved ones).
- **Tags**: `getAllTags(cache)` (`:3332`) merges frontmatter + inline tags; vault-wide aggregate by
  iterating `vault.getMarkdownFiles()` and their `getFileCache` (cheap; no file reads), filtering
  blacklisted paths. Per-note tags come from the same call.
- **Headings/outline**: `cache.headings` (`HeadingCache`, `:3378`: `heading`, `level`,
  `position`) → `{level, heading, line}`; keep document order.
- **Metadata**: `cache.frontmatter` (`FrontMatterCache`, `:3242`), `file.stat` (size/mtime/ctime),
  `getAllTags`, link counts, heading count. Frontmatter must be bounded/serialized safely (it can
  contain arbitrary YAML values).
- **Full-text search**: Obsidian exposes **no vault full-text search API**. It exposes per-string
  helpers `prepareSimpleSearch` / `prepareFuzzySearch` (`:5260` / `:5252`), which still require the
  text. The current `plugin/src/retrieval/index.ts` is a **document cache**, not BM25: it reads all
  markdown files once into `docs` (`:56–68`), invalidates on vault events (`:21–29`), and `getAll()`
  filters the blacklist (`:74–76`); there is no scoring, term frequency, or ranking anywhere in the
  file. Implement a small pure BM25 (or equivalent scored substring search) in `vault/search.ts`
  over that cached corpus, shared by MCP `search_notes` and the `@mention` picker. If BM25 is not
  built, the honest fallback is bounded substring + title boost; do not call the existing cache
  "BM25".
- **Hidden configuration folder writes**: use `app.vault.adapter` (`DataAdapter`, `:2006`) directly:
  `exists` (`:2020`), `mkdir` (`:2099`), `read` (`:2038`), `write` (`:2052`), `append` (`:2069`),
  `list` (`:2033`). Files under a dot folder (`.chat/`) are not part of Obsidian's note index, so
  the ordinary `Vault` file APIs may not see them; the adapter is the reliable surface for the JSONL
  store. The adapter is available on mobile too, but the store is host-only by role.
- **Desktop base path / mobile**: `FileSystemAdapter.getBasePath()` (`:3005`) supplies the absolute
  vault root used as the harness `cwd` and as the prefix for ACP absolute paths. `CapacitorAdapter`
  (`:1483`) has no `getBasePath`, and `Platform.isMobileApp`/`isDesktopApp` (`:4838`/`:4843`)
  distinguish the runtime; host mode is hidden on mobile (FR-004). ACP `fs/*` handlers are never
  registered on mobile (or on a remote-only instance).

### Rationale

The spec requires "the content Obsidian currently sees, including a note open in an editor" and
"open editors/metadata refresh without a reload". The only way to get unsaved editor text is the
`MarkdownView.editor` value; the only way to refresh a preview is `MarkdownPreviewView.rerender`.
Backlinks must be derived because the public API has no backlink method in the installed typings;
`resolvedLinks` is the live metadata cache and already handles link resolution. A single service is
also the FR-023/FR-024 requirement: one path policy, one blacklist, one index.

### Alternatives considered

- **Direct `fs` reads/writes** for speed or for the store: rejected for vault content (FR-024; the
  whole point is Obsidian's cache/editor/index consistency). The JSONL store is the one exception
  where `vault.adapter` is used, still through the vault abstraction.
- **Build a second search index** for MCP: rejected; reuse the mention cache and score over it.
- **Use `metadataCache.resolvedLinks` only for outgoing links**: rejected; it loses unresolved links
  and per-link position, which the UI can show.
- **Call `getBacklinksForFile`**: does not exist in the installed API; a call would be invented.
- **Refresh editors by `setValue`**: rejected; it resets cursor/selection and can clobber a dirty
  editor. `editor.refresh()` / `previewMode.rerender()` are the public, non-destructive calls.

### Evidence

- `node_modules/obsidian/package.json` version `1.13.1`.
- `node_modules/obsidian/obsidian.d.ts:1402` (`CachedMetadata`), `:3332` (`getAllTags`), `:3378`
  (`HeadingCache`), `:3711` (`LinkCache`), `:4404` (`MetadataCache`), `:4411`
  (`getFirstLinkpathDest`), `:4417` (`getFileCache`), `:4438` (`resolvedLinks`), `:4444`
  (`unresolvedLinks`), `:6965` (`TagCache`).
- `obsidian.d.ts:2006` (`DataAdapter`), `:2020` (`exists`), `:2033` (`list`), `:2038` (`read`),
  `:2052` (`write`), `:2069` (`append`), `:2087` (`process`), `:2099` (`mkdir`); `:2996`
  (`FileSystemAdapter`), `:3005` (`getBasePath`), `:3042` (`append`), `:1483`
  (`CapacitorAdapter`).
- `obsidian.d.ts:7321` (`Vault`), `:7386` (`create`), `:7404` (`createFolder`), `:7420`
  (`cachedRead`), `:7467` (`modify`), `:7510` (`process`).
- `obsidian.d.ts:4188` (`MarkdownView`), `:4193` (`editor`), `:4196` (`previewMode`), `:4060`
  (`MarkdownPreviewView`), `:4088` (`rerender`), `:2414` (`Editor.refresh`).
- `obsidian.d.ts:5252`/`:5260` (`prepareFuzzySearch`/`prepareSimpleSearch`).
- `plugin/src/retrieval/index.ts:12` (class), `:21–29` (invalidation), `:56–68` (read-all build),
  `:74–76` (`getAll` filter); no BM25 terms in the file.
- `plugin/src/host/vault-mcp.ts:14` (`normalizePath`, `TFile`, `TFolder` imports), `:106–125`
  (current path handling / one-level `ensureParent`).
- `plugin/src/acp/client.ts:20` (`requestUrl`, `Platform`) and `:271–289` (desktop Node streams).

---

## R6 — Session record: JSONL mechanics, durability, repair, migration

### Decision

**Location**: `plugin/src/session/store.ts` (new, JSONL) with records in
`<vault>/<sessionStoreFolder>/<sessionId>.jsonl`, default `.chat/sessions/` (setting). Hidden from
the note surface, inside the vault for backup/sync, outside `.obsidian/` so it is not mixed with
Obsidian's own config. Host-only; remote devices never write it (FR-012).

**Files** (per `contracts/session-store.md` §1): `<sessionId>.jsonl`, optional `index.json` cache,
`registry.json` host reattach registry, `migration.json` legacy-import ledger.

**Record format**: UTF-8, one JSON object per line, first line header, then entries. Header:
`{kind:"header", v:1, sessionId, deviceId, title, createdAt, updatedAt, lastSeq, harness:{command,
commandFingerprint, cwd, protocolVersion, agentName, agentVersion, capabilities:{loadSession,resume}},
harnessSessionId, resume:{state,reason}, modes, config}`. Entries: `prompt`, `update`, `permission_request`,
`permission_response`, `turn`, `resume`, `meta`, `error` — each with `seq`, `ts`, `turn` (where
applicable) and a `v` field when it can evolve. **Name the internal turn-boundary kind `turn` (or
`turn_boundary`), not `turn_end`**: `turn_end` is the deleted SSE envelope name, and the plan's grep
gate (plan.md P1) looks for it. A record kind named `turn_end` would make that gate ambiguous and
keep a dead protocol word alive.

**Append**: serialize the entry, append one complete line + `\n`, and await completion after each
entry. Use `app.vault.adapter.append(path, line)` (`obsidian.d.ts:2069`) — the adapter has an append
primitive on both `FileSystemAdapter` (`:3042`) and `CapacitorAdapter` (`:1535`), so no
read-modify-write fallback is needed. `await` each append; serialize appends through one promise
chain per session (no concurrent writes to the same file). The store never rewrites earlier lines,
never reorders, never truncates on update.

**Create**: `adapter.exists` → if absent, `adapter.mkdir` each missing segment and
`adapter.write(path, headerLine + "\n")`, then append entries. Do not use `vault.create` for the
hidden folder (the vault index may not know it).

**Sequence**: header `lastSeq = 0`; entries start at 1 and increase by 1 per appended entry. The
store assigns `seq`; readers treat the last parseable entry's `seq` as authoritative, and the header's
`lastSeq` as a best-effort hint updated at turn boundaries. On open, if the file's last good `seq`
is less than the registry's `lastSeq`, mark the session degraded (possible external truncation/sync
conflict) and never rewrite.

**Crash / repair**: on open, split on `\n`; parse every complete line. A trailing fragment with no
newline is a partial write: ignore it, count it, mark `degradedTail`. Before the next append, if the
file does not end in `\n`, append a single `\n` first so the partial fragment becomes an isolated
skipped line and the next entry starts clean (still append-only; no rewrite). An interior malformed
line is skipped and counted; the session continues and the UI shows "degraded". A file with a bad
header is reported as unreadable and never fabricated into an empty session.

**Bounds**: per-entry raw payload cap **256 KiB** (contract §8); truncation is explicit
(`{truncated:true, originalBytes:n}`) and the UI never presents a truncated tail as complete. UI raw
disclosure displays at most 16 KiB (R8). No rotation/compaction in v1 (the record is the history);
surface per-session size + a warning at 50 MiB; replay to a remote is capped at the last 20 000
entries (a full replay can be requested by `session/load` without `sinceSeq`; the host still streams
it in order, with backpressure). Images are stored by name/type only (as today,
`plugin/src/session/store.ts:176–179`).

**Concurrency / sync**: the host is the only writer. `obsidian-chat` must ignore Obsidian Sync
conflict files (e.g. `*.sync-conflict-*`) and never merge them; a changed tail/sequence marks the
session degraded. Two hosts on the same vault are out of scope (spec assumption).

**Migration** (first run after upgrade): discover legacy conversations **vault-wide** by note content
and frontmatter (`type: chat-session` / the canonical transcript marker). There is no note-folder
setting. For each matching `*.md`, parse with the existing canonical block
`<!-- oc-transcript-b64: … -->` (`plugin/src/session/store.ts:68`, `:203`) via
`parseSessionNote` (`:76–88`), falling back to the prose parser (`:107–171`) which already handles
`oc-activity-b64` (`:55`, `:102`). Convert `ChatMessage[]` → `prompt`/`update`/`meta` entries:
user/assistant content becomes prompt/agent chunks, tool `ActivityItem[]` becomes
`tool_call`-shaped updates marked `imported: true, synthetic: true` (they are presentation summaries,
not raw ACP events), plus a provenance marker. Header: `harnessSessionId: null`,
`resume.state: "digest-only"`, `provenance: {originPath, originMtime, originHash}`. Leave original
notes untouched. Idempotency: `migration.json` maps `notePath → {hash, sessionId}`; re-run skips
unchanged notes; if a note changed, skip and report rather than duplicate. A manifest loss is
recovered by scanning imported headers for `provenance.originPath`. Import is lossless for the
note's content, not for never-recorded raw ACP payloads — say so in the migration report.

### Rationale

Append-only JSONL with one line per entry is the only format that satisfies "crash cannot corrupt a
whole session", "skip the bad line", and "raw record for every update" without a database. The
vault adapter's `append` is the portable primitive; direct `fs` would duplicate the vault abstraction
and is forbidden for vault content. Naming the boundary entry `turn` avoids resurrecting the deleted
`turn_end` vocabulary in grep gates and docs.

**Realignment note (2026-11-07)**: during implementation the legacy Markdown note writer/parser was
moved to `plugin/src/session/legacy-note.ts`, and `plugin/src/session/store.ts` became the **new JSONL
store**. Any historical citation below that attributes the Markdown format to `session/store.ts`
refers to the legacy module, not to the retained JSONL store.

### Alternatives considered

- **One JSON file rewritten per turn**: rejected; O(size) rewrite per turn, whole-file corruption on
  crash, and it breaks the append-only guarantee.
- **SQLite/IndexedDB**: rejected; new dependency, migration complexity, not vault-syncable, and
  overkill for a personal log.
- **Markdown notes with embedded base64**: the old design (now `plugin/src/session/legacy-note.ts`);
  rejected by the spec (no note-based history; whole-note rewrites; base64 bloat).
- **Append via direct `fs.appendFile` + `fsync`**: rejected for portability and FR-024; the adapter's
  append is enough for process-crash durability (page cache survives a process crash; power loss may
  lose the last line, which the repair path handles).
- **Rotate/compact old entries**: out of scope v1; it would break the raw-record promise. Bound entry
  size and surface total size instead.

### Evidence

- `plugin/src/session/store.ts:1–5` (Markdown-note purpose), `:36–70` (`renderBody`),
  `:55` (`oc-activity-b64`), `:68` (`oc-transcript-b64`), `:76–88` (`parseSessionNote`),
  `:102` (`LEGACY_ACTIVITY_RE`), `:107–171` (prose parser), `:176–179` (image bytes stripped).
- `plugin/src/ui/chat-view.ts:2183–2207` (`persistSession` rewrites the whole note via
  `vault.modify` — the behaviour being replaced).
- `plugin/src/session/store.test.ts:1–129` (round-trip tests to port/replace).
- `obsidian.d.ts:2006` (`DataAdapter`), `:2069` (`append`), `:3042` (`FileSystemAdapter.append`);
  `:1483` (`CapacitorAdapter`); `obsidian.d.ts:7321` (`Vault`).
- `specs/004-acp-shell/contracts/session-store.md` §1–§3, §7–§8 (format, repair, bounds, import).

---

## R7 — Continuity: resume vs load, registry, fingerprint, digest

### Decision

**Ladder** (host ↔ harness, per stored session):

1. If the host registry says the harness session is still live in the current child, reuse it; no
   resume/load call.
2. Else `initialize` (cached) and inspect capabilities.
3. If `agentCapabilities.sessionCapabilities?.resume` is truthy → `session/resume { sessionId, cwd,
   mcpServers }`. Do **not** expect or render replayed history; the stored transcript remains the
   view. This is the preferred verb because it restores context without replay.
4. Else if `agentCapabilities.loadSession === true` → `session/load { sessionId, cwd, mcpServers }`.
   The agent replays history as `session/update` notifications before the response. Set
   `replaying = true`; route replay updates to reconciliation, **not** to the store and not to a
   second transcript render.
5. Else → explicit user choice: **Continue with digest (default)**, **Start fresh**, **Full
   transcript replay** (advanced). No `session/new` until the user chooses.

**Refusal rules** (FR-064): resume/load is refused with an explanation when the stored
`harness.cwd` differs from the current vault base path, or the stored `commandFingerprint` differs
from the current attach. Version policy for spec Open Decision 8: store `agentName`/`agentVersion`
separately; a changed version is a **warning, not a refusal** (same harness, upgraded), a changed
command/fingerprint or cwd is a refusal, and a changed `protocolVersion` (≠1) is a refusal. When
refused, show the same digest/fresh/full choice; never attach to the wrong harness/vault.

**Registry**: `sessionStoreFolder/registry.json` (host-only; contract §1) with
`sessionId → {harnessSessionId, deviceId, cwd, commandFingerprint, protocolVersion, lastSeq, state:
"live"|"detached"|"dead", lastSeen}`. Keep it with the store rather than in `data.json`: it is host
session state that must move with the record folder, and `data.json` is already the settings surface
(device tokens should not sit next to high-frequency session state). Write debounced (≤1 s) on
session create/turn end/attach; read on load; reconcile against records (drop registry rows with no
record, adopt records with no row as `dead`, mark rows whose lastSeq is ahead of the tail as
degraded). The registry is never synced to a remote and never contains tokens.

**Fingerprint**: `attachFingerprint(command, cwd) = fnv1a64Hex(argv.join("\0") + "\0" +
normalizePath(cwd))`, where `argv` is the quote-aware `splitCommand(command)` result (so
`opencode  acp` and `opencode acp` are identical, and the hash covers exactly what will be spawned),
and `normalizePath` swaps `\`→`/`, removes a trailing slash except root, and keeps case (note:
macOS/Windows case-insensitive filesystems are a known limitation — compare case-insensitively
there if a mismatch is only case). Use a pure FNV-1a 64-bit hash (two 32-bit halves via BigInt or
`Math.imul`) rather than `crypto.subtle.digest`: deterministic, synchronous, testable under
`node --test`, and not reliant on a secure context. Store `commandFingerprint`, `cwd`, `agentName`,
`agentVersion`, `protocolVersion` separately so the refusal reason can name the mismatch.

**Digest construction** (deterministic, bounded, model-free):

- Input: the record only; rebuild from header + entries sorted by `seq`.
- Include: a fixed first line `[Conversation digest — generated by Obsidian Chat from the stored
  record; not written by the model]`; the stored title/createdAt; the last `N = 6` complete turns
  (turn entries with a `turn` boundary and stopReason not `error`), each as:
  `Turn <n> — user: <text ≤600 chars>; assistant: <final assistant text ≤900 chars>; tools:
  <up to 8 lines "status kind: title (path)">`; then a deduped `Files touched:` line (≤30 paths,
  from prompt context + tool `locations`/`rawInput.path`); then `Errors:` (≤5, safe messages);
  then `[end digest; truncated]` if any bound was hit.
- Exclude: timestamps other than `createdAt`, raw payloads, base64, image bytes, permission
  messages, provider/credential-looking strings, and anything not in the record.
- Cap the whole digest at 8 000 characters (hard truncate with the marker). Same record →
  byte-identical digest; a fixture snapshot test pins it.
- Delivery: prepend the digest as a single labelled `ContentBlock` to the first prompt of the new
  session (not a separate visible user turn), record a `resume` entry
  `{method:"digest", sourceSessionId, chars}`, and label it in the transcript/raw view. "Full
  transcript replay" is the same mechanism with the full text (bounded by a 100 000-char prompt cap)
  and a clearer label.

**Load reconciliation**: during `replaying`, do not append to the store and do not render
duplicates. Match replayed `session/update` notifications against the stored update sequence by
`(sessionUpdate kind, normalized content hash)` in order; consume matching stored entries as
already-rendered; if a replay update has no stored match, render it in a separate "replayed from
harness" region (not persisted as a new turn) and count it; when the load response arrives, if the
matched prefix < replay count, show a notice and keep the stored transcript authoritative. This
satisfies FR-061 (no duplicate render/persist) without silently discarding a divergent replay.

### Rationale

The schema makes the distinction explicit: resume returns modes/config only and "without returning
previous messages"; load replays via `session/update` (confirmed by the SDK's own `loadSession`
example at `dist/examples/http-server.js:28–41`). The ladder matches the spec exactly and uses each
capability for what it is for. The fingerprint refusal is the only defence against resuming a
conversation into a different harness/vault; a digest is the only model-free way to preserve context
when neither capability exists.

### Alternatives considered

- **Always `session/load`** (simpler): rejected; it replays potentially thousands of updates and
  requires reconciliation even when resume is available and cheaper.
- **Always digest/fresh when a session is not live**: rejected; loses real harness memory that
  resume/load can restore.
- **Global config overrides replayed into every new session** (current `acpConfigOverrides`,
  `plugin/src/settings.ts:36–43`): rejected; FR-041 says the selection affects only the current
  session. Store per-session `modes`/`config` in the header and reapply after resume/load (FR-065),
  not globally.
- **Hash with `crypto.subtle.digest`**: rejected for async/secure-context complexity; the fingerprint
  is an identity check, not a security primitive.
- **Include the whole transcript in the digest**: rejected; unbounded and defeats the purpose.

### Evidence

- Schema descriptions: `ResumeSessionRequest` (no previous messages), `LoadSessionRequest`,
  `SessionCapabilities` (`loadSession` is top-level; resume is `sessionCapabilities.resume`).
- `dist/examples/http-server.js:28–41` (`loadSession` loops `client.notify(session.update)`) and
  `dist/examples/http-client.js:72–81` (reconnect sketch: initialize → require `loadSession` →
  `session/load`).
- `dist/schema/types.gen.d.ts:1517` (`loadSession`), `:1670` (`resume`), `:2756`/`:2894`
  (load/resume responses), `:4885`/`:5018` (requests).
- `docs/TODO-session-continuity.md:60–118`: the prior audit already identified the missing
  capability gating, the `resume`-without-replay preference, the `load` replay hazard, the silent
  new-session bug, and the need to persist the session handle; this research turns those notes into
  the decisions above.
- `plugin/src/settings.ts:36–43` (`acpConfigOverrides`), `plugin/src/ui/chat-view.ts:2254–2276`
  (`loadSession` restores the record but explicitly cannot rejoin the harness).

---

## R8 — UI rendering: generic ACP renderer, unknown kinds, bounds, density

### Decision

Replace `plugin/src/ui/activity.ts`'s name→verb/icon dictionary with a generic renderer:

- **One card per `toolCallId`**, merged with `ToolCall`/`ToolCallUpdate` semantics: every field is
  partial in updates, so merge only present fields (title, name, kind, status, content, locations,
  rawInput, rawOutput). The headline is the harness's `title` verbatim; if absent, its `name`
  verbatim; if both absent, the `kind`. No plugin verb, no tense adjustment, no basename rewriting
  of the title. An icon may be chosen from the fixed `ToolKind` enum only; `failed` gets a failure
  icon.
- **Content variants**: render each `ToolCallContent` independently — `content` (TextContent as
  Markdown, ImageContent as preview/link, AudioContent as an audio element/link, ResourceLink as a
  link, EmbeddedResource as a bounded text/blob link), `diff` as a diff with `Diff.path`, `oldText?`,
  `newText`, `terminal` as a terminal-output block by `terminalId`. Do not drop a variant because
  another exists.
- **Locations**: `ToolCallLocation.path` is absolute; resolve to a vault note with the same
  suffix-matching helper as today (`plugin/src/ui/chat-view.ts:2015–2033`) and make it clickable only
  when it resolves; otherwise show the path as text.
- **Raw input/output**: behind an explicit per-card Details disclosure; serialize lazily on first
  expand; cap at 16 KiB displayed, with "truncated, N bytes total"; never write the formatted raw
  into the transcript/record as visible content.
- **Unknown update kinds**: a generic row carrying the literal `sessionUpdate` string and a bounded
  raw payload disclosure (16 KiB), lazy. It is never dropped and never coerced into an existing
  renderer. This includes future/unstable kinds (`plan_removed`, `compaction_update`,
  `compaction_summary_chunk`, and anything newer).
- **Per-turn "ACP updates"**: a disclosure listing that turn's raw `update` entries from the store,
  bounded/paged; connection details expose the whole session record with the same paging. Do not
  build a second raw log.
- **Density**: keep `uiDensity: "comfortable" | "compact"` for spacing; add
  `activityDensity: "chronological" | "grouped"` (default `"chronological"`). Grouping may collapse
  consecutive tool rows into a header (`N steps · duration · failures`) but must never hide
  reasoning, plans, errors, or unknown kinds. The setting changes presentation only, never the store.
- **Performance**: streaming text is rendered at most once per animation frame (the existing
  `streamInto`/`flushStream` pattern, `plugin/src/ui/chat-view.ts:1528–1552`); tool updates mutate
  the existing card (O(1), no full re-render); raw JSON is stringified only on expand; reopening a
  long session renders the last 50 turns and offers "load earlier" in 50-turn pages; live raw rows
  are capped at 2 000 per turn with a "N more in the record" affordance; diff LCS runs only on
  `completed`/`failed` (as today, `plugin/src/acp/client.ts:632–653`) to avoid
  O(n·m) on every intermediate update.

### Rationale

The spec's visible thesis is "the transcript streams the protocol, not a translation of it"
(FR-043…FR-050). The current dictionary is exactly the translation to delete: `NAME_CATEGORY`,
`VERBS`, `ICONS`, `toolCategory`, `verbFor` (`plugin/src/ui/activity.ts:36–156`) invent "Reading",
"Wrote", "Ran" etc., and `applyToolEvent` (:194–228) derives a basename label. ACP already supplies
the title/name/kind/status/content/locations/raw fields. The current UI also collapses a run into
one header by default (`renderStoredActivity`, `chat-view.ts:566`), which the spec reverses.

### Alternatives considered

- **Keep the dictionary for "nicer" labels**: rejected by FR-044/FR-049/SC-010; it is the behaviour
  the user explicitly asked to remove.
- **Map unknown kinds to the nearest known renderer**: rejected; changes meaning and hides protocol
  evolution. Generic raw row is the honest option.
- **Render raw JSON inline for every update**: rejected; unreadable and a performance hazard.
- **Virtualize the whole transcript with a third-party list**: rejected; Obsidian plugin DOM plus
  paging is enough for personal-scale sessions and avoids a dependency.
- **Group by default**: rejected; FR-047 says chronological/expanded is the default.

### Evidence

- `plugin/src/ui/activity.ts:36–64` (name→category map), `:67–78` (kind map), `:81–95` (verbs),
  `:98–112` (icons), `:122–125` (`toolCategory`), `:132–136` (`isStatusTitle`), `:152–156`
  (`verbFor`), `:194–228` (`applyToolEvent`).
- `plugin/src/ui/chat-view.ts:566–599` (`renderStoredActivity`, collapsed by default), `:1070–1102`
  (live activity group state), `:1528–1552` (rAF streaming), `:2137–2145` (done), `:2162–2175`
  (`turnSettled` drop).
- `plugin/src/chat/types.ts:26–50` (`ActivityItem` with `verb`/`label` — to be replaced by render
  model), `:77–104` (`StreamEvent`).
- `node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts:209` (`ToolKind`), `:217`
  (`ToolCallStatus`), `:226` (`ToolCallContent`), `:249` (`ContentBlock`), `:522` (`Diff`), `:557`
  (`Terminal`), `:581` (`ToolCallLocation`), `:3479` (`ToolCall`), `:140` (`ToolCallUpdate`),
  `:3410` (`SessionUpdate`).
- `specs/004-acp-shell/contracts/acp-shell.md` §5 (total mapping, no dictionary).

---

## R9 — Security: credentials, exposure, path policy

### Decision

**Credential types**:

| Credential | Scope | Storage | Lifetime | Never |
|---|---|---|---|---|
| Local UI token | Host's own chat view | In memory, per host run | Host start → stop | Persisted/logged |
| Device token | One paired device | Host `data.json` `host.devices` (name→token) | Until revoked | Logged, shown in transcript/connection details, stored in records |
| MCP session token | One relayed ACP session | In memory map `token→sessionId` | Session create → close/harness respawn | Logged, stored in the record, included in `session/new` copy kept in the record |

Generate with `crypto.getRandomValues(new Uint8Array(24))` hex (as `randomToken`,
`plugin/src/host/server.ts:369–373`); compare with a constant-time helper (`timingSafeEqual` where
Node is available; a length-independent XOR loop elsewhere). Device tokens are shown once in
settings with copy/revoke; revocation closes the device's open socket and cancels its parked
approvals.

**Exposure**:

- Default bind `127.0.0.1`; host mode is desktop-only (FR-004/FR-006). A wider bind requires an
  explicit settings confirmation and a persistent warning; MCP is loopback-only regardless of the
  ACP bind (socket-address check before dispatch).
- One listener, routes `/acp` (WebSocket upgrade) and `/mcp` (POST); everything else 404. No extra
  port, no second server, no launchd job.
- Auth happens **before** the WebSocket handshake; failure is HTTP 401 and no ACP connection. Auth
  failure is distinct from network failure and is never retried as transient (FR-016).
- `maxPayload` 8 MiB, HTTP body limit 1 MiB for `/mcp`, per-call timeouts, approval timeout (10 min
  as today, `server.ts:56`), prompt/cancel timeouts. Oversized messages close the socket with a
  policy error.

**Path policy** (one implementation in `vault/path-policy.ts`, used by ACP fs, MCP, mention index):

1. Reject non-string, empty, NUL, or control characters.
2. ACP `fs/*` paths must be absolute (schema says absolute); resolve the vault base from
   `FileSystemAdapter.getBasePath()`, normalize separators, then compute the vault-relative path.
   Reject if the relative path is `..`, starts with `../`, or is itself absolute (different root).
3. Reject `.obsidian/` unconditionally (any case; first segment), and reject the session-store folder
   (`.chat/sessions/` by default) and `.trash/` as protected config paths. Refusals name the policy
   (`outside vault`, `blacklisted`, `config-protected`, `malformed`), never the file content, and
   never clamp/redirect.
4. Apply the user blacklist with the same normalization used by the mention index (strip trailing
   `/`, match the folder itself or a descendant).
5. Only then call the VaultService. A refused request performs zero vault operations.

**Symlink limitation**: lexical checks do not resolve symlinks. A symlink inside the vault pointing
outside can still be read/written through the Vault API; v1 documents this (spec assumption) and
does not attempt realpath resolution. Optional defence-in-depth on desktop only: after lexical
approval, `fs.realpath` the resolved base and target and re-check the prefix; if added, it must not
change mobile behaviour. This is a known limitation, not a silent guarantee.

**Logging/store redaction**: the session record stores protocol data but **not** the raw
`session/new` request (its `mcpServers[0].headers` contains the MCP token), not device tokens, not
Authorization headers, not image bytes, not provider credentials. The connection log redacts
`authorization`, `token`, `access_token`, and any `Bearer …` substring; URLs are logged without
query strings. Error messages must not echo a token or file content. The MCP handler must not log
tool arguments that may contain note content.

### Rationale

The host is reachable over a VPN and, if misconfigured, a LAN; the token is the only application
boundary (TLS is the VPN's job per the spec assumptions). A single auth gate plus loopback-only MCP
keeps the surface small. Path policy is the product's security promise (FR-022/FR-023/SC-004): it
must be lexical, shared, and refusal-only. Constant-time comparison and redaction are cheap and
prevent accidental leakage through the connection details the user will actually open.

### Alternatives considered

- **Trust the VPN and skip tokens**: rejected; FR-009/FR-010 require per-device credentials and
  revocation, and a wider bind must still be safe.
- **TLS in the plugin**: rejected for v1; the spec puts transport security on the VPN and a
  self-signed TLS listener adds cert management.
- **Store device tokens in SecretStorage**: attractive (mobile docs recommend it), but the host is
  desktop and Obsidian's `SecretStorage` availability/version is not verified here; `data.json` is
  the current convention (`plugin/src/settings.ts:49–56`). Revisit if the plugin targets shared
  machines.
- **Resolve symlinks with `realpath` in v1**: rejected as scope; document the limitation (spec
  assumption) and keep the lexical checks deterministic/testable.
- **Allow `.obsidian/` for the store**: rejected; `.obsidian/` is unconditionally refused to the
  harness, and the store lives in `.chat/sessions/` instead, so the refusal is unambiguous.

### Evidence

- `plugin/src/host/server.ts:56` (approval timeout), `:96` (current `0.0.0.0` bind),
  `:226–245` (CORS + bearer + device check), `:326–329` (MCP loopback + token), `:356–361`
  (`deviceFor`), `:369–373` (`randomToken`), `:391–394` (`bearer`).
- `plugin/src/settings.ts:49–56` (devices stored in settings), `:243–272` (pairing UI),
  `:11–14` (gateway token).
- `plugin/src/host/vault-mcp.ts:97–113` (current blacklist check; no `.obsidian/` refusal — the new
  policy adds it) and `:106–112` (lexical `..` check).
- `plugin/src/retrieval/index.ts:32–43` (duplicated blacklist logic today — the new policy replaces
  it).
- `specs/004-acp-shell/contracts/host-transport.md` §2 (token/revocation, 401 before upgrade);
  `contracts/vault-mcp.md` §2 (loopback + token); `contracts/acp-shell.md` §7 (path policy errors).

---

## R10 — Delete/rewrite scope and test infrastructure

### Decision

Greenfield module set; the legacy files below are removed at the end of the branch (not kept as a
fallback). Mapping:

| Current file | Action | Replacement |
|---|---|---|
| `plugin/src/host/server.ts` (414 lines: spawn, SSE relay, approvals, MCP route, `turn_end`) | **Delete** | `shell/host-server.ts` (single listener), `shell/host-relay.ts`, `shell/local-transport.ts`, `session/resume.ts` registry |
| `plugin/src/host/jsonrpc.ts` (101 lines: hand-rolled stdio JSON-RPC) | **Delete** | SDK `ndJsonStream` + `client()` in `shell/acp-client.ts`/`local-transport.ts` |
| `plugin/src/host/vault-mcp.ts` (285 lines; includes write/append/edit/move/delete tools) | **Rewrite** | `vault/mcp-server.ts` (read-only six tools over `VaultService`) |
| `plugin/src/acp/client.ts` (679 lines: `AcpBridgeClient`, SSE, `turn_end`, dict helpers) | **Delete** | `shell/acp-client.ts` (SDK client, transport-injected), `shell/remote-transport.ts` |
| `plugin/src/session/legacy-note.ts` (252 lines: legacy Markdown note writer/parser) | **Delete after migration** | `session/migrate.ts` (parsers moved here); the new JSONL `session/store.ts` is retained |
| `plugin/src/ui/activity.ts` (260 lines: name→verb/icon/label dictionary) | **Delete** | `acp/session-update.ts` + `ui/renderer.ts`; keep only pure `formatDuration`/`diffStat` in `ui/format.ts` |
| `plugin/src/chat/tool-input.ts` (95 lines: target derivation/sanitizer) | **Delete/replace** | `ui/raw-bounds.ts` (bounded raw JSON display only; no verb/target derivation) |
| `plugin/src/ui/chat-view.ts` (2 676 lines: monolithic view, note persistence, allowlist, custom renderers) | **Retire** | `ui/shell-view.ts` (shell, built new rather than evolving this file), `ui/renderer.ts`, `ui/controls.ts`, `ui/raw-view.ts`, `ui/session-list.ts`; deletion owned by T121 |
| `plugin/src/ui/approval.ts` (100 lines: Approve/Reject + "always allow" + undo) | **Rewrite** | One action per offered `PermissionOption`; no allowlist; optional host-side snapshot/undo |
| `plugin/src/ui/connection-info.ts` (94 lines: SSE cursor/retry fields) | **Rewrite** | Attach mode, listener, harness state, registry, raw record (paged); no tokens |
| `plugin/src/ui/session-suggest.ts` (36 lines: note picker) | **Delete** | `ui/session-list.ts` (store-backed titles/time/resume state) |
| `plugin/src/ui/acp-model-suggest.ts` (37 lines: model-specific picker) | **Delete** | generic `ui/acp-select-suggest.ts` for any declared select with a long option list |
| `plugin/src/main.ts` (264 lines: `AcpBridgeClient` ownership, host start) | **Rewrite** | Host/shell lifecycle, store ownership, reattach, migration |
| `plugin/src/settings.ts` (296 lines: gateway + note store + allowlist + overrides) | **Rewrite** | Host/attach/devices/store/blacklist/activityDensity; remove `gateway`, `toolAllowlist`, `acpConfigOverrides`, note-folder writing |
| `plugin/src/chat/types.ts` (112 lines: `StreamEvent`, `ActivityItem`) | **Replace** | Record/entry types + render-model types |
| `plugin/src/chat/ground.ts` (15 lines: wikilink extraction) | **Keep** (pure utility) | — |
| `plugin/src/retrieval/index.ts` (85 lines: doc cache) | **Adapt** | `vault/search.ts` (BM25/scored search; same cache idea), `VaultService` |
| `plugin/src/ui/markdown.ts`, `ui/mention.ts`, `ui/image-picker.ts`, `ui/acp-picker-menu.ts` | **Keep/adapt** | They are generic (MarkdownRenderer, mention picker, vault image picker, declared-option menu) |
| `plugin/src/session/store.test.ts` (129 lines) | **Replace** | New `session/*.test.ts` suites |

**Test infrastructure**: `plugin/package.json` script is
`node --test 'src/**/*.test.ts'`; Node here is **v24.22.2**, where TypeScript type stripping is on by
default (the existing `.test.ts` suite runs green with 10 tests). `tsconfig.json` currently has
`"moduleResolution": "node"`; that is node10 resolution and **cannot see the ACP SDK's `exports` map**
(the SDK has no `experimental/` directory on disk — its subpaths are export-map entries). Change to
`"moduleResolution": "bundler"` (TypeScript 5.5 supports it; esbuild is the bundler) while keeping
`module: "ESNext"` and `allowImportingTsExtensions` (the test files import `.ts`). This is required
before `import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client"`
type-checks.

**Test harness needed**:

1. **In-process mock ACP agent**: `agent({name})` from the SDK with handlers for initialize,
   session/new/resume/load, prompt, cancel, permission, and a scripted update sequence; connect to
   the shell client with `clientApp.connect(agentApp)` (`ClientApp.connect(AgentApp)`,
   `dist/acp.d.ts:692` region) — no child process, no ports, deterministic. Scenarios: normal turn,
   prompt resolves before a late update (R2), cancel, permission options, load replay, capability
   matrix (resume-only/load-only/neither), unknown update kind, large payload.
2. **Mock harness child** for the stdio path: a small `test/fixtures/mock-harness.ts` run with
   `node --experimental-strip-types` that wraps the same agent app over `ndJsonStream`; one smoke
   test proves spawn + initialize + one turn, and a crash test kills it mid-turn.
3. **Fake WebSocket client + real host listener** on an ephemeral port (`server.listen(0)`), using
   `ws` and the SDK's `createWebSocketStream` (Node test), to prove auth-before-upgrade, one turn,
   permission routing to owner, second-device isolation, reconnect with `sinceSeq`, revocation.
4. **Fake `VaultService`** for MCP/fs policy tests: a small in-memory adapter with `read/write/
   exists/list` plus a `MetadataCache` stub (`resolvedLinks`, `getFileCache`, `getAllTags`) so
   `vault/mcp-server.ts` and `path-policy.ts` are testable without Obsidian. Keep `path-policy.ts`
   and `session/*` dependency-free so they run under plain Node.
5. **Store tests** against a temp directory + `DataAdapter`-shaped fake: append 1 000 entries and
   assert the file only grows; truncate the final line and assert all prior entries parse + degraded
   tail; malformed interior line skipped; sequence monotonic; migration idempotent with fixtures for
   `oc-transcript-b64` and prose notes.

`npm test` on Windows has a quoting caveat (`'src/**/*.test.ts'` is a Unix shell literal); the
project's dev environment is macOS/Linux, but a cross-platform script (`node --test
"src/**/*.test.ts"` or a small runner) is a cheap improvement.

### Rationale

The spec makes deletion a requirement (FR-070/FR-074), and the current files are exactly the legacy
path: the SSE relay (`host/server.ts`), the custom JSON-RPC peer (`host/jsonrpc.ts`), the SSE client
(`acp/client.ts`), the note writer (`session/store.ts`), and the dictionary (`ui/activity.ts`). Keeping
any of them creates two write/transport/presentation paths, which the constitution forbids.
`moduleResolution: "bundler"` is a hard prerequisite for the SDK subpath imports (R1/R3), not a style
choice.

### Alternatives considered

- **Evolve `chat-view.ts` in place**: rejected; 2 676 lines already mix transport, persistence, and
  rendering, and the new renderer/controls/raw view have different data sources (the store, not the
  view).
- **Keep the legacy note parsers in place for migration only**: acceptable temporarily during P4, but
  the plan requires the legacy writer removed and only the reader retained under `session/migrate.ts`;
  the final tree must not import the legacy note module (`session/legacy-note.ts`) from runtime code.
  `session/store.ts` is the JSONL store and remains runtime code by design.
- **Use Vitest/Jest**: rejected; `node --test` is already the project convention, runs TS directly on
  Node 24, and adds no dependency.
- **Test against a real `opencode acp` in CI**: rejected as the only strategy; too slow/flaky and
  harness-version dependent. Real harnesses remain a manual quickstart check; the mock agent is the
  regression net.

### Evidence

- `plugin/package.json:11` (`test` script), `:13–21` (devDependencies), `plugin/tsconfig.json:10`
  (`moduleResolution: "node"`), `:13` (`allowImportingTsExtensions`).
- `node --version` → `v24.22.2`; `npm test` → 10 passing `store.test.ts` tests (run in this worktree).
- Current file sizes: `host/server.ts` 414, `host/jsonrpc.ts` 101, `host/vault-mcp.ts` 285,
  `acp/client.ts` 679, `session/store.ts` 235, `ui/activity.ts` 260, `ui/chat-view.ts` 2 676.
- `plugin/src/ui/chat-view.ts:2041–2102` (persistent allowlist + invented allow/reject options —
  to delete), `:2183–2207` (note persistence — to delete), `:2254–2276` (no resume — to replace).
- `node_modules/@agentclientprotocol/sdk/package.json` exports map (no `experimental` directory on
  disk); `dist/acp.d.ts:692` (`ClientApp.connect(AgentApp)`).
- `specs/004-acp-shell/plan.md` P1–P6 gates (verification strategy and legacy-removal table).

---

## R11 — Top technical risks and mitigations

### Decision

Carry these eight risks as the plan's risk register, each with a named gate where its mitigation is
verified. The register is deliberately restricted to risks that could invalidate the architecture or
the branch's acceptance criteria; smaller implementation risks stay in the task list.

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| 1 | **WebSocket server inside Obsidian/Electron**: port binding, firewall prompts, CSP, `ws` not installed, optional native deps, mobile accidentally evaluating Node code | Medium / High | Add `ws@^8.18.0` + `@types/ws`, bundle it, lazy `require("ws")` only inside the desktop-gated host start, `platform: "node"` externals, `bufferutil`/`utf-8-validate` external, loopback default, `maxPayload`, integration test on an ephemeral port, and a mobile bundle check that no host module is evaluated. Gate: P6. |
| 2 | **opencode (or another harness) resolves `session/prompt` before its final updates** | High / Medium | Turn ends on the response; bounded post-resolution attribution (`late:true`, `_meta`), never drop, never synthesize a terminator; mock-agent test reproduces the anomaly; raw record keeps every update. Gate: P1/P5. |
| 3 | **Harness resume/load support gaps** (opencode may advertise neither; `load` replay may diverge) | High / Medium | Capability-gated ladder; explicit digest/fresh/full choice; fingerprint refusal; replay reconciliation that never re-persists; unit matrix for resume-only/load-only/neither/mismatch. Gate: P4. |
| 4 | **ACP SDK + zod bundle growth** | Medium / Medium | The SDK's `acp.js` imports `schema/zod.gen.js`, which imports `zod/v4` (`dist/acp.js:2`, `dist/schema/zod.gen.js:3`); every runtime import of `client`/`agent` pulls validation. Keep host-only SDK imports out of the mobile-critical path where possible, measure the production bundle, and accept the cost if the plugin envelope allows; fallback is to use the lower-level `Stream`/`ndJsonStream` + a thin typed router (only if measurement fails). Bundle measurement could not be run here: the installed esbuild binary is `@esbuild/darwin-arm64` while the container is `linux-aarch64`, so `esbuild` cannot execute — verify on a real dev machine. Gate: P5/P6. |
| 5 | **JSONL sync conflicts / external truncation** (vault sync, manual edits) | Medium / Medium | Single writer (host), append-only, sequence check vs registry, degraded state on tail/sequence mismatch, ignore `*.sync-conflict-*`, never rewrite to "fix", surface size/degraded status in the session list. Gate: P1/P4. |
| 6 | **Large logs / long turns** (thousands of updates, big diffs, raw payloads) | Medium / Medium | 256 KiB per-entry cap with explicit truncation, 16 KiB UI raw display on demand, lazy JSON serialization, rAF text batching, one card per tool id, paged reopen/raw views, replay cap (20 000 entries) with full-replay option. Gate: P1/P5. |
| 7 | **Mobile constraints** (no Node/Electron APIs; may not spawn or serve MCP) | High / High | Host modules only under `Platform.isDesktopApp` + lazy requires; `CapacitorAdapter` has no `getBasePath`; mobile only runs the remote WebSocket client (global `WebSocket`, no `ws` import), never registers fs/MCP handlers, and the settings UI hides host mode; add a bundle/load test for mobile. Gate: P6. |
| 8 | **Path-policy escape / symlink limitation** | Low–Medium / High | Central lexical policy with `.obsidian/`, store folder, `.trash/`, blacklist, `..`, relative, NUL checks; 100% refusal tests (SC-004); document the symlink limitation; optional desktop-only `realpath` re-check as defence-in-depth (not a v1 guarantee). Gate: P2. |

### Rationale

These are the risks that either (a) can invalidate a core user story, (b) depend on a package that is
not currently installed, or (c) are known protocol/harness deviations rather than ordinary bugs. Each
has a concrete test or gate, so the register is actionable rather than a list of worries. Risks that
are merely "more work" (editor refresh edge cases, markdown rendering fidelity, settings migration
details) belong in tasks, not here.

### Alternatives considered

- **Only carry the three protocol/dependency risks** (`ws`, MCP SDK, opencode ordering): rejected;
  mobile and JSONL sync failures would still invalidate acceptance criteria and need explicit gates.
- **Treat the WebSocket listener as a spike rather than a risk**: rejected; it is the one new
  network surface in the product and must be tested on the real Electron runtime, not assumed.
- **Defer bundle-size measurement until after implementation**: rejected as a *planning* position;
  the SDK pulls zod validation on every runtime import, so it is a known cost to measure at P5, not
  a surprise at release.

### Evidence

- `node_modules/@agentclientprotocol/sdk/dist/acp.js:2` and `dist/schema/zod.gen.js:3` (runtime zod
  import); `node_modules` has `zod@4.5.4` (`package-lock.json:650–660`).
- `package-lock.json` has no `ws` entry; `node_modules/@modelcontextprotocol` is empty.
- `plugin/src/host/server.ts:51–54` (ordering anomaly), `:96` (current over-broad bind).
- `plugin/src/ui/chat-view.ts:2162–2175` (opencode drop workaround).
- `obsidian.d.ts:1483` (`CapacitorAdapter`), `:3005` (`getBasePath`), `:4838`/`:4843`
  (`Platform` flags).
- `specs/004-acp-shell/contracts/session-store.md` §3/§8 (repair and bounds); `contracts/host-transport.md`
  §7 (limits).

Additional risks tracked in "Open risks" below: MCP protocol strictness, hidden-folder sync behaviour,
snapshot/undo semantics for remote devices, and the constitution gate.

---

## Resolved unknowns

1. **ACP SDK version and surface** — installed `@agentclientprotocol/sdk@1.4.0`; `PROTOCOL_VERSION`
   is `1`; `client`/`agent`, `ndJsonStream`, `methods`, and the experimental
   `./experimental/ws-client` / `./experimental/server` / `./experimental/node` subpaths exist. The
   1.4.0 app APIs are preferred; `ClientSideConnection`/`AgentSideConnection` are deprecated.
2. **`session/load` replay semantics** — confirmed by the schema description and the SDK's own
   `loadSession` example: the agent sends `session/update` notifications for prior history before
   resolving the load request. `session/resume` explicitly does not return previous messages.
3. **WebSocket framing** — one JSON-RPC message per WebSocket **text** frame, not NDJSON; binary
   frames are ignored. Reuse the SDK client/server transports; do not add a second framing layer.
4. **`ws` dependency** — **not installed and not in `package-lock.json`**. Required package:
   `ws@^8.18.0` (types `@types/ws@^8.5.13`). It must be added, bundled (not external), and loaded
   lazily only on desktop. The lockfile also contains a stale `extraneous` `harness` stanza
   (`package-lock.json:15–26`) that should be removed while touching it.
5. **MCP SDK** — **not installed**. `node_modules/@modelcontextprotocol` is an empty directory; the
   only repo reference is the stale `harness` lock entry (`@modelcontextprotocol/sdk ^1.30.0`). The
   v1 decision is to keep the minimal tool-only handler and add no dependency. If the official
   transport is later chosen, the exact package to add is `@modelcontextprotocol/sdk@^1.30.0` (the
   version the old lockfile intended), and its dependency tree is heavy (express/hono/ajv/jose/…)
   with dual ESM/CJS builds — a deliberate bundle-size trade-off, not a drop-in.
6. **Obsidian backlinks/full-text search** — there is **no** public `getBacklinksForFile` in
   `obsidian@1.13.1`; backlinks must be derived by inverting `metadataCache.resolvedLinks`. There is
   **no** vault full-text search API; `prepareSimpleSearch`/`prepareFuzzySearch` are per-string
   helpers. The current `plugin/src/retrieval/index.ts` is a **document cache, not BM25**; a scored
   search must be written in `vault/search.ts` (or the UI must be honest that it is substring
   search). The plan/contract wording "BM25 (adapted from retrieval/index.ts)" is therefore
   aspirational, not a description of existing code.
7. **Obsidian adapter surface for the store** — `DataAdapter.append` exists on desktop and
   `CapacitorAdapter`, so the JSONL store can be append-only without read-modify-write. Hidden
   dot-folder files are not in the note index; use `vault.adapter` (`exists`/`mkdir`/`read`/`write`/
   `append`/`list`), not `vault.create`.
8. **Obsidian editor refresh** — public APIs are `Editor.refresh()` and
   `MarkdownPreviewView.rerender(true)`; use them after `vault.modify`/`vault.create` instead of
   `setValue` (which would reset the cursor/clobber a dirty editor). `vault.createFolder` is not
   documented as recursive; create each missing segment.
9. **Module resolution** — `plugin/tsconfig.json` must move from `"moduleResolution": "node"` to
   `"bundler"` for the SDK export map (`experimental/*` has no directory on disk). TypeScript 5.5
   supports it; `allowImportingTsExtensions` stays for the Node test files.
10. **Turn boundary naming** — the contract's record kind `turn_end` collides with the deleted SSE
    envelope name and the plan's "no `turn_end`" grep gate. Rename the internal entry kind to `turn`
    (or `turn_boundary`); the protocol boundary remains the `session/prompt` response.
11. **Host-side ACP server API** — `contracts/host-transport.md` §3 says "one `AgentSideConnection`";
    that class is deprecated in 1.4.0. Use `agent({...})` + `AcpServer.prepareWebSocketUpgrade({
    createAgent })` instead; the behaviour (one ACP connection per WebSocket, per-device factory) is
    unchanged.
12. **Local UI transport** — the cleanest single-boundary design is for the host's own view to attach
    over the loopback WebSocket with a per-run local token, rather than a second in-process client
    path. This keeps one relay/auth path and still satisfies "local chat works with only Obsidian +
    harness".
13. **Bundle-size measurement** — not possible in this container: esbuild's installed platform
    binary is `@esbuild/darwin-arm64` and the host is `linux-aarch64`, so the binary cannot execute.
    The zod/validation cost is real (`dist/acp.js:2`, `dist/schema/zod.gen.js:3`); measure on a real
    machine before P6.
14. **Constitution** — v1.1.0 forbids the plugin spawning subprocesses and limits vault access to MCP
    (not ACP `fs/*`); the proposed v2.0.0 amendment is the gate prerequisite. This research did not
    edit the constitution; the plan's Constitution Check already marks the gate blocked until
    ratification.

## Open risks

- **WebSocket + experimental SDK in Obsidian**: the SDK's `experimental/server`/`experimental/node`
  APIs are not covered by a stability promise; pin `@agentclientprotocol/sdk` exactly (or `~1.4.0`)
  and keep the host transport behind `shell/host-server.ts` so a future API change is localized.
- **Bundle size is unmeasured** (see Resolved unknowns 13); the ACP SDK pulls zod v4 validation.
  If the production bundle exceeds the plugin's envelope, the fallback is a thin typed router over
  `ndjson`/WS (more code, less validation) — a deliberate trade-off to make at P6, not now.
- **Real harness behaviour**: only mock-agent tests can prove the shell; opencode's resume/load
  support, `mcpCapabilities.http`, prompt/update ordering, and permission option kinds must be
  validated against the real CLI in the quickstart. The spec's own assumption is that some harnesses
  advertise neither resume nor load.
- **Obsidian Sync and hidden folders**: whether `.chat/sessions/` is synced/backed up by the user's
  sync setup is not verified here; the store is append-only and single-writer, but a sync service that
  rewrites files could create conflict copies. Surface store path/size/degraded state in the UI and
  document the recommendation.
- **Remote snapshot/undo**: ACP writes are host-side; the pre-write snapshot and undo are host
  concerns. A remote device cannot request an undo through standard ACP without a custom method;
  v1 may expose undo only on the host UI. This needs a product decision if remote parity is required.
- **MCP protocol strictness**: the minimal handler is a subset; a harness's MCP client may require
  `Mcp-Session-Id`, SSE `Accept`, or `MCP-Protocol-Version` handling beyond the current code. Add
  conformance tests against a real harness in P3; keep the official SDK as the documented fallback.
- **Symlink escapes** remain a known v1 limitation (lexical policy only). If the user's vault
  contains symlinks to sensitive paths, the policy cannot see it; document and consider a
  desktop-only realpath check later.
- **Session-store location default** (`.chat/sessions/`) is still the spec's open decision; the
  research recommends it (hidden, vault-local, outside `.obsidian/`, syncable) but the user must
  confirm at the plan gate.
- **Turn-boundary naming**: if the contract keeps `turn_end` as a record kind, the "no `turn_end`"
  grep gate cannot distinguish the deleted wire envelope from an internal record entry. Recommend
  renaming before tasks are generated.

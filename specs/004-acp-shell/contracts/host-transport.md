# Contract: Paired Device ↔ Host (ACP over WebSocket)

**Status**: Design contract for spec `004-acp-shell` (approved 2026-11-07).
**Applies to**: `plugin/src/shell/host-server.ts`, `plugin/src/shell/host-relay.ts`,
`plugin/src/shell/remote-transport.ts`, `plugin/src/shell/device-auth.ts`.
**Spec**: FR-005…FR-017, FR-026, FR-053…FR-067, FR-068…FR-071.

The host plugin is an ACP **server** toward paired devices and an ACP **client** toward its harness.
The relay between the two is a standard ACP proxy: it never invents a protocol, never executes
tools, and never serves a remote device the host vault. ACP v1 via `@agentclientprotocol/sdk` 1.4.0,
using its app/server APIs — `agent({ name })`, `AcpServer.handleRequest`/`AcpServer.prepareWebSocketUpgrade`
from `@agentclientprotocol/sdk/experimental/server`, and `client()` + `createWebSocketStream` from
`@agentclientprotocol/sdk/experimental/ws-client`. The deprecated `AgentSideConnection` /
`ClientSideConnection` classes are not used by new code.

## 1. Network surface

Exactly one host listener, `http.createServer(...)`, in the Obsidian host process (desktop only):

| Route | Protocol | Audience |
|---|---|---|
| `GET /acp` with WebSocket upgrade | ACP v1 over WebSocket | paired devices over the VPN |
| `POST /mcp` | MCP streamable HTTP, stateless JSON | the harness child, loopback only |
| anything else | `404` | — |

- No other listener, port, or server exists. No `tailscale serve`/launchd/daemon is required; the
  user's VPN supplies the private network. `wss://` is supported when the user fronts the listener
  with their own TLS terminator.
- WebSocket server implementation: the host needs an RFC 6455 server (the ACP SDK server transport
  accepts a prepared WebSocket socket; it does not implement the server itself). Add
  `ws@^8.18.0` (+ `@types/ws@^8.5.13`) to `plugin` devDependencies, bundle it (do **not** mark it
  external — Obsidian does not ship it), lazy-`require("ws")` only in the desktop-gated host module,
  and mark `bufferutil`/`utf-8-validate` external (optional native probes). Use
  `new ws.WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false })`
  and `handleUpgrade(req, socket, head, ws => prepared.accept(ws))`. Remove the stale `extraneous`
  `harness` stanza from `package-lock.json` while touching the lockfile.
- Framing: **one JSON-RPC message per WebSocket text frame**, not NDJSON and not a length prefix;
  binary frames are ignored. The SDK's client/server transports already do this
  (`createWebSocketStream` sends `JSON.stringify(message)` per send; the server parses each text
  frame as one JSON value).
- Bind address: `127.0.0.1` by default; a user-selected VPN interface/`0.0.0.0` only after explicit
  confirmation in settings. MCP is loopback only regardless of the ACP bind.

## 2. Device authentication

- Each paired device has a name and a bearer credential in host settings (`devices: name → token`).
- The device presents it as `?token=<token>` on the WebSocket URL (browser/WebView WebSocket
  constructors cannot set request headers). Tokens are compared in constant time and never logged,
  rendered, or stored in the session record.
- The host validates **before** completing the upgrade; failure returns HTTP 401 and no WebSocket is
  established. A malformed/unknown token is an auth rejection, not a network retry.
- Revocation takes effect on the next request/attach; an already-open connection for a revoked
  device is closed with a policy error and its pending approvals are cancelled.
- Device identity is attached to every session it creates (`owningDevice`), and all session
  operations are scoped to it. Another device receives 403/`policy` errors, never data.

## 3. Server-side ACP behaviour (host as agent-side relay)

For each accepted WebSocket, the host creates one SDK ACP agent connection via
`AcpServer.prepareWebSocketUpgrade({ createAgent: () => relayAgentFor(deviceId) })` (the per-device
factory is how ownership and permission routing are scoped). Its `Agent` handlers relay to the
harness. It MUST behave as follows:

- **initialize**: return `protocolVersion: 1`, `agentInfo` = the shell's name/version, and
  `agentCapabilities` derived from the host's own storage plus the harness mirrors:
  - `loadSession: true` (the host can always replay its record; see §4),
  - `sessionCapabilities.list: true` (the host lists its stored sessions),
  - other capabilities (prompt image/audio, mcp) mirrored from the harness where the host can
    actually honour them; unsupported ones are `false`, never advertised speculatively.
  - The remote client's `clientCapabilities.fs` is ignored for harness filesystem requests; the host
    serves fs itself. The remote shell advertises `fs: false`.
- **session/new**: create a host session bound to the device, create the corresponding harness
  session through the host's ACP client (`cwd` = host vault root, `mcpServers` = host vault MCP
  entry), assign an opaque session id, persist the record header, and return `{ sessionId, modes,
  configOptions }` exactly as the harness reported them.
- **session/prompt**: forward the prompt to the harness session; stream every harness
  `session/update` back as the host's own `session/update` notification for that session; resolve
  the remote request only when the harness prompt resolves, with the harness's `stopReason`.
  No synthetic `turn_end` or quiet-period completion.
- **session/cancel**: cancel parked permissions for the session, then send `session/cancel` to the
  harness; the pending remote prompt resolves with the harness's stop reason.
- **session/set_mode**, **session/set_config_option**: forward unchanged; return the harness result.
- **session/request_permission** (host → device): the harness request is forwarded to the owning
  device as the standard ACP request. The device's selected `optionId` (or `cancelled`) is returned
  to the harness verbatim. No other device sees it.
- **fs/* requests** from the harness: handled by the host itself through
  `contracts/acp-shell.md` §7; they are never forwarded to a remote device.
- **terminal/* handlers**: absent; capability `false`.
- **session/list** (standard ACP): return the host's stored sessions for this device, with title,
  updated time, and resumability state (see `contracts/session-store.md` §6). This is how a remote
  device browses history; there is no separate REST/HTTP history API.
- **Local chat path**: the host's own view attaches over the same loopback WebSocket with a
  per-host-run local token (never persisted), rather than a second in-process client path. One
  transport, one auth boundary, one relay path; local chat still requires only Obsidian + harness.

## 4. Record replay to a remote device

A remote device keeps no durable local history (spec FR-054/Assumption), so the host must supply the
transcript over ACP:

- On attach/open of a stored session, the remote client calls **`session/load`** for that session.
  The host replays the stored record's transcript-relevant entries as standard `session/update`
  notifications **before** resolving the load request, then resolves it. No new ACP method is
  introduced.
- Every replayed notification carries ACP's standard `_meta` extensibility:
  `_meta: { "obsidian-chat/seq": <n>, "obsidian-chat/replay": true }`. Live forwarded
  notifications carry `_meta: { "obsidian-chat/seq": <n> }`. The remote client uses the sequence to
  dedupe on reconnect and to mark history vs live in the raw view; it MUST NOT require the metadata
  to render (it is additive, standard `_meta`).
- `session/load` request may carry `_meta: { "obsidian-chat/sinceSeq": <n> }` to request only
  entries after the remote's last seen sequence; without it the host replays the full record. The
  host MUST tolerate the metadata being absent.
- `session/resume` is not advertised to remote devices (resume returns no history and the remote has
  none); resume is an internal host↔harness concern (see `contracts/acp-shell.md` §3).
- The host MUST NOT re-persist a replay: replay reads the record and emits notifications; it does
  not create entries.
- If the harness session cannot be reattached, the replay still works for browsing, and the remote
  UI shows the host's explicit continuity choice (digest/fresh/full) before the next prompt. The
  digest is built by the host from the record; the choice is passed through the standard prompt
  path (the host seeds the chosen continuation; no new method).

## 5. Reconnect, liveness, and replay

- WebSocket heartbeat: ping every 15 s, close after two missed pongs.
- On connection loss the remote marks any in-flight turn interrupted, stops appending, and never
  reports success; the host resolves parked permissions for that device `cancelled` and preserves
  the session record.
- Reconnect: bounded exponential backoff (1 s → 15 s, 8 attempts); auth rejections are not retried
  as network faults. After reconnecting, the client sends `initialize` again and then
  `session/load { sessionId, cwd, mcpServers: [] }` with `_meta { "obsidian-chat/sinceSeq": n }`;
  it never resends a prompt.
- On reconnect the remote re-attaches to its session via `session/load` with `_meta
  {sinceSeq}`, receives the missed notifications in order, dedupes by `obsidian-chat/seq`, and
  reconciles the live turn state. No prompt is resent; no turn is duplicated.
- The host's per-session replay buffer is bounded; a device that falls further behind than the
  buffer receives a full replay from the record instead (still via `session/load`).
- Session records and pending approvals are preserved across a remote disconnect; approvals are
  cancelled, records are not.
- Host restart: sessions are not live; a reconnecting device uses `session/list` +
  `session/load` to browse; an attempt to prompt triggers the host's continuity ladder against the
  harness and the explicit choice when it cannot reattach.

## 6. Isolation and concurrency

- One host session belongs to exactly one device; session ids are opaque and ownership-checked on
  every request.
- Multiple sessions per device and multiple devices per host are supported; the harness receives one
  ACP session per host session.
- Two views of the same session on one device share one session and one record; they receive the
  same notifications and never create a second session.
- A device may open only its own sessions; `session/list` is scoped.

## 7. Limits and failure behaviour

- WebSocket `maxPayload` is 8 MiB; the `/mcp` HTTP body limit is 1 MiB; per-call and approval
  timeouts are bounded (approval 10 minutes). Oversized messages close the connection with a policy
  error.
- Attach/session-creation/prompt operations have bounded timeouts; failures surface as named errors.
- A harness crash closes/fails affected sessions, cancels permissions, and reports an interrupted
  turn; remote devices see the host state, not a fabricated completion.
- A revoked device's open connection is closed; its sessions stop being served.
- No token, credential, or file content appears in logs, error messages, the session list, or the
  raw record. Raw payload bounds apply as in `contracts/session-store.md` §8.

## 8. Conformance checks (plan gates)

- Exactly one `http.createServer`/`listen(` exists on the host; routes are `/acp` and `/mcp` only.
- No SSE (`text/event-stream`, `EventSource`, `Last-Event-ID`) and no `turn_end` remain.
- Mock-device integration: pair/attach, one turn, cancel, permission routing to the owner only,
  second-device isolation, reconnect with `sinceSeq` (no duplicated turn), revocation, host restart
  (browse via list/load, continuity choice on prompt).
- Auth rejection occurs before upgrade; no session or payload is created for an unauthenticated
  connection.

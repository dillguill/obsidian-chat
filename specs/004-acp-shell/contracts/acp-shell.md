# Contract: Shell ↔ Harness (ACP)

**Status**: Design contract for spec `004-acp-shell` (approved 2026-11-07).
**Applies to**: `plugin/src/shell/acp-client.ts`, `plugin/src/shell/transports/*`,
`plugin/src/acp/*`. ACP v1 via `@agentclientprotocol/sdk` 1.4.0, using its 1.4.0 app APIs
(`client()`, `agent()`, `AcpServer`, `ndJsonStream`, `createWebSocketStream`);
`ClientSideConnection`/`AgentSideConnection` are deprecated and MUST NOT be used by new code.
`initialize` is explicit and `PROTOCOL_VERSION` is `1`.
**Spec**: FR-001…FR-008, FR-018…FR-025, FR-034…FR-042, FR-053…FR-067.

The shell is always the ACP **client**. It never implements an agent, a model call, or a tool
execution. This document fixes the wire behaviour the shell relies on; anything not named here is
out of scope for v1.

## 1. Transport construction

Two transports, one client implementation:

| Mode | Transport | Construction |
|---|---|---|
| `local` (desktop host only) | stdio ACP to one spawned harness child | `ndJsonStream(child.stdout, child.stdin)` from the SDK; child started once per attach and supervised (bounded respawn, never after an explicit stop) |
| `remote` (paired device) | ACP over WebSocket to the host plugin | `createWebSocketStream("wss://<host>:<port>/acp?token=<device-token>", { WebSocket: ws.WebSocket, cookies: "omit" })` |

- The same `AcpShellClient` drives both; the transport is injected behind a small interface
  (`send`, `close`, `onClose`) and never leaks into UI code.
- `local` MUST refuse on mobile and on a vault without a filesystem adapter (no absolute cwd).
- The harness command is split quote-aware and spawned with no shell interpolation (Windows `.cmd`
  shim handling may require `shell: true`; that is the only allowed exception and is documented).
- Exactly one harness child exists per host; remote clients do not start one.

## 2. `initialize` (once per transport, before any session call)

Request:
```json
{
  "protocolVersion": 1,
  "clientInfo": { "name": "obsidian-chat", "version": "<plugin version>" },
  "clientCapabilities": {
    "fs": { "readTextFile": true, "writeTextFile": true },
    "terminal": false
  }
}
```
- `fs` is `true` for `local` on desktop, and for `remote` only when the shell is the host-side
  handler of paired-device sessions; a paired remote device itself advertises `fs: false` (the host
  serves the vault).
- `terminal` is always `false` in v1 on every platform and every mode.
- `agentCapabilities.promptCapabilities` gates image/audio prompt content: the shell only sends an
  image/audio block when the harness advertises that content type; otherwise it attaches it as text
  or omits it with a visible notice.
- `agentCapabilities.mcpCapabilities.http` gates the MCP server entry in `session/new`: when it is
  not `true`, the shell sends `mcpServers: []`, advertises no native vault tools for that run, and
  keeps chat working (FR-031).
- The response's `agentCapabilities` (notably the top-level `loadSession` and
  `sessionCapabilities.resume`), `agentInfo` and negotiated `protocolVersion` are cached for the
  lifetime of that transport. A negotiated version other than 1 is a hard attach error; it is not
  retried as a transient fault.
- The cached capability snapshot (including `agentName`/`agentVersion`) is written into the
  session-record header (see `contracts/session-store.md`) so continuity decisions survive restarts.

## 3. Session creation and restoration

- **new**: `session/new { cwd: <absolute path>, mcpServers: [vaultServer] }`.
  - `cwd` is the host vault root for `local`; for the host-side session serving a paired device it
    is still the host vault root.
  - `mcpServers` contains exactly one standard MCP server entry pointing at the host's loopback
    `/mcp` endpoint with the per-session bearer token (see `contracts/vault-mcp.md`) **only when the
    harness advertises `agentCapabilities.mcpCapabilities.http === true`**. Otherwise it is `[]`,
    native vault tools are marked unavailable for that run, and chat continues over ACP. It is never
    set on a remote client.
  - Cache `sessionId`, `modes`, `configOptions`, and any `availableCommands` from the response.
  - The record header is written before the first prompt.
- **resume** (preferred when `sessionCapabilities.resume` is advertised):
  `session/resume { sessionId, cwd }`. Restores context; the shell MUST NOT expect or render
  replayed history, and MUST keep the locally stored transcript as the view.
- **load** (when only the top-level `agentCapabilities.loadSession` is advertised):
  `session/load { sessionId, cwd, mcpServers }`. The agent replays prior history as
  `session/update` notifications **before resolving the load request**; the shell routes those
  replay updates through the record reconciliation rules so no turn is rendered twice and no replay
  is persisted as new.
- **close**: `session/close { sessionId }` only for an explicit user action (delete/end session) or
  plugin shutdown; ordinary view teardown MUST NOT close the session.
- A failed resume/load enters the explicit continuity choice in `contracts/session-store.md` §6; it
  MUST NOT fall through to a silent `session/new`.

## 4. Turns

- A turn is `session/prompt { sessionId, prompt: ContentBlock[] }`. `prompt` carries only this
  turn's blocks (user text, attached note context, images); the agent owns conversation state.
- The turn ends when the `session/prompt` request **resolves** with `{ stopReason }`. The shell
  MUST NOT invent a `turn_end` event, quiet-period completion, or any other synthetic terminator.
- Cancellation: send the `session/cancel` notification `{ sessionId }` (not a request). Before
  sending, resolve every parked permission request for the session as
  `{ outcome: { outcome: "cancelled" } }` (see §6). The prompt is expected to resolve with
  `stopReason: "cancelled"`; that stop reason is the authoritative end.
- **Ordering anomaly (known harness bug)**: some harnesses resolve `session/prompt` before their
  final `session/update` notifications flush. Mitigation, not protocol invention:
  1. On resolution, the transport stays open. Any update arriving afterwards is attributed to the
     just-ended turn (`turn = lastTurn`, `late: true`), persisted as a normal `update` entry,
     forwarded with ACP `_meta` (`obsidian-chat/turn`, `obsidian-chat/late`), and rendered into that
     turn's card if it is still current — otherwise as a generic "late ACP update" row in that
     turn's raw view. It is never dropped and never reclassified as a new turn.
  2. Attribution to the just-ended turn lasts `LATE_ATTRIBUTION_WINDOW_MS = 2_000`; an update that
     arrives after the next prompt started is marked `orphan: true` and kept in the same turn's raw
     record.
  3. Before starting a new prompt, drain the per-session update queue (`UPDATE_QUEUE_DRAIN_MS =
     250`).
  4. The shell never fabricates completion and never discards late updates.
  - The store's internal turn-boundary entry is named `turn`, **not** `turn_end`; `turn_end` is the
    deleted SSE envelope and the plan's grep gate must not match a record kind. The protocol
    boundary remains the `session/prompt` response.
- That an in-flight turn survives view close is a session-store responsibility (record is appended
  by the session owner, not the view).

## 5. Updates → render model

`session/update` notifications are mapped by the pure `plugin/src/acp/session-update.ts` into the
render model. The mapping MUST be total over the protocol's update kinds:

- `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` → text/reasoning chunks.
- `tool_call`, `tool_call_update` → one tool-call view keyed by `toolCallId`, merging changed fields
  only (ACP updates send partial objects). Fields carried through unchanged: `title` (required in
  ACP), `name`, `kind`, `status`, `content`, `locations`, `rawInput`, `rawOutput`.
- `plan`, `plan_update`, `plan_removed` → plan view (entries/removal verbatim; no fabricated plan).
- `usage_update` → usage view.
- `session_info_update` → session title/metadata state (no transcript content).
- `current_mode_update`, `config_option_update`, `available_commands_update` → declared-control
  state, not transcript content.
- `compaction_update`, `compaction_summary_chunk` (unstable in ACP v1) and any future/unknown kind →
  a generic raw entry with the update kind and a bounded payload. Never dropped. The total mapping
  is over the SDK's 15-kind `SessionUpdate` union plus an explicit fallback.

There is **no tool-name-to-verb/icon dictionary** and no harness-specific branch anywhere in this
mapping. Icons may be chosen from ACP's fixed `ToolKind` enum only. Labels are the harness's
`title` verbatim, or its `name` verbatim when title is absent.

## 6. Permissions

- `session/request_permission` arrives from the agent with `{ sessionId, toolCall, options[] }`.
- The shell parks the request, routes it to the session's owning device, and renders the card from
  the real `toolCall` (title, kind, content variants, locations).
- It renders **one action per offered option** (label = the option's `name`; styling may use
  `kind`), and answers exactly:
  `{ outcome: { outcome: "selected", optionId: <offered id> } }`.
- The shell never answers on its own, never invents an option, never maintains a persistent
  allow/deny table, and never inspects the tool call to decide whether it may run.
- On explicit cancel, session teardown, device disconnect, or transport loss, every parked request
  is answered `{ outcome: { outcome: "cancelled" } }` before the session ends. When at least one was
  parked, a transcript error explains why the cards disappeared.
- An optional operational approval timeout (10 minutes) resolves a parked request as
  `cancelled` with reason `timeout`; it is a cancellation, never an approval, and adds no fifth
  permission state.

## 7. Filesystem capabilities

Handled by `plugin/src/vault/acp-fs.ts` over the shared `VaultService`:

- `fs/read_text_file { path, line?, limit? }` → `{ content }`. `path` is absolute (schema
  requirement); resolve the vault base from `FileSystemAdapter.getBasePath()` before policy mapping.
  `line` is 1-based; `limit` is a line count. Read through the Vault API (never direct disk I/O);
  for a note open in an editor, return the editor's current text (including unsaved edits).
- `fs/write_text_file { path, content }` → `{}`. Create missing parent folders (each missing
  segment); create or overwrite through the Vault API; refresh open editors with
  `Editor.refresh()` and previews with `MarkdownPreviewView.rerender(true)` (never `setValue`);
  capture the best-effort pre-write snapshot on the first write to that path in the session.
- Any path-policy failure returns a JSON-RPC error whose message distinguishes `outside vault`,
  `blacklisted`, `config-protected`, and `malformed`; zero vault operations occur. Paths are never
  clamped or redirected.
- `terminal/*` handlers are not registered and the capability is `false`.

## 8. Modes and config options

- Active mode: `session/set_mode { sessionId, modeId }` using an id from the declared modes.
- Config option: `session/set_config_option` using ACP's tagged shapes — select options as
  `{ sessionId, configId, value: <valueId> }`; boolean options as
  `{ sessionId, configId, type: "boolean", value: <bool> }`. Values and ids are forwarded unchanged.
- The shell may replay the last selected value per option id into a new session as an opaque
  preference; it never interprets the value.

## 9. Error, timeout and teardown rules

- Attach timeouts: initialize and session creation each have a bounded timeout; failure surfaces a
  named error and does not spawn a second process. Turn-boundary constants:
  `LATE_ATTRIBUTION_WINDOW_MS = 2_000`, `UPDATE_QUEUE_DRAIN_MS = 250`,
  `CANCEL_RESPONSE_TIMEOUT_MS = 5_000` (implementation constants, not protocol semantics).
- Harness exit: pending prompt is rejected (interrupted, never completed), parked permissions are
  cancelled, the connection state moves to reconnecting, and the child is respawned with bounded
  exponential backoff. A deliberate stop does not respawn.
- Resume/load failure: enters the explicit continuity choice; never a silent new session.
- Auth rejection (remote): distinct error, no retry as a network fault.
- All errors are visible in the UI (connection details and/or transcript) and never include tokens,
  credentials, or file content.

## 10. Conformance checks (plan gates)

- No `turn_end`, `Last-Event-ID`, `text/event-stream`, `EventSource`, or custom envelope in the new
  shell modules. (The store's internal turn-boundary entry is `turn`; `turn_end` must not appear as
  a code identifier anywhere.)
- No top-level `child_process`/`fs`/`path` import in shared modules; desktop-only requires are lazy
  and guarded by `Platform.isDesktopApp`.
- The mock ACP agent fixture drives every update kind in §5, including an unknown kind, and the
  render model contains all of them.

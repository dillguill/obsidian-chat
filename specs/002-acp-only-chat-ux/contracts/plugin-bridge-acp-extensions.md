# Contract Addendum: Plugin ↔ Bridge — Mode, Config Options, Available Commands

**Extends**: `specs/001-acp-mcp-migration/contracts/plugin-bridge-acp.md` (same parties, same
auth, same reconnect/replay model — this document only adds to that contract's method table, it
doesn't replace any of it).

**Why an addendum, not an edit to the 001 contract**: 001's contract is a shipped artifact of a
prior feature; this feature is the first to need these fields/methods, so its own additions are
recorded here rather than silently rewriting a previous feature's contract file.

## What already works, unchanged (confirmed by reading acp-bridge.mjs during planning)

`GET /sessions/:id/events` (SSE) already relays the harness's full `session/update` payload
regardless of its `sessionUpdate` discriminant — it does not special-case on update type today
and needs no change. This means `current_mode_update`, `config_option_update`, and
`available_commands_update` already reach the plugin over the existing event stream; only the
plugin's handling of those discriminant values is new (see `acp/client.ts` in plan.md's Project
Structure).

## What's new

### `POST /sessions` response — include initial mode/config state

Today's handler (`acp-bridge.mjs:180`) does:

```js
const { sessionId } = await ctx.request("session/new", { cwd, mcpServers });
return sendJson(res, 200, { sessionId });
```

discarding everything else `session/new` returned. This must become:

```js
const { sessionId, modes, configOptions } = await ctx.request("session/new", { cwd, mcpServers });
return sendJson(res, 200, { sessionId, modes, configOptions });
```

`modes` and `configOptions` are passed through verbatim (whatever shape the harness's ACP
response actually has — `SessionModeState` / `Array<SessionConfigOption>`) — the bridge does not
interpret or transform them, consistent with staying harness-agnostic (Constitution III).

### `POST /sessions/:id/mode` (new) → `session/set_mode`

| | |
|---|---|
| Request body | `{ "modeId": string }` |
| Bridge action | `await ctx.request("session/set_mode", { sessionId, modeId })` |
| Response | Whatever `SetSessionModeResponse` the harness returns, passed through verbatim |
| Auth/ownership | Same device-ownership check already used by the existing `/prompt` and `/cancel` routes (403 if `s.deviceId !== deviceId`) |

### `POST /sessions/:id/config-option` (new) → `session/set_config_option`

| | |
|---|---|
| Request body | `{ "optionId": string, "value": string \| boolean }` |
| Bridge action | `await ctx.request("session/set_config_option", { sessionId, optionId, value })` |
| Response | Whatever `SetSessionConfigOptionResponse` the harness returns (includes the updated `configOptions` array), passed through verbatim |
| Auth/ownership | Same pattern as above |

Both new routes follow the existing file's error convention: `HARNESS_UNAVAILABLE` → 503,
unknown/foreign session → 404/403, uncaught → 500.

## Out of scope for this addendum

- Any change to `harness/src/mcp-rules-proxy.mjs` — not touched by this feature (research.md R1).
- Any change to how `mcpServers` is constructed — already correct today.

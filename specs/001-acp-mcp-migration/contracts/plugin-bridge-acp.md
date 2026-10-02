# Contract: Plugin ↔ Bridge (ACP over HTTP/SSE)

**Parties**: Obsidian plugin (ACP client) ↔ host bridge (ACP relay)

**Protocol base**: ACP v1 methods, carried over an HTTP/SSE transport owned by the bridge (see
research.md R2 — this is a project-owned transport binding, not a claim of ACP's own
not-yet-stable remote transport RFD).

## Authentication

- Every request MUST include a per-device bearer token, issued out-of-band (existing `tokens.json`
  mechanism carried forward from the current gateway).
- An invalid or missing token MUST be rejected with an auth error before any ACP method is
  processed (FR-004).

## Methods (ACP v1 surface used by this feature)

| Method | Direction | Purpose |
|---|---|---|
| `session/new` | plugin → bridge | Start a new session against the currently configured harness |
| `session/prompt` | plugin → bridge | Send a user message/turn into an existing session |
| `session/update` | bridge → plugin | Streamed notification: partial/complete assistant output, tool-call/permission events |
| `session/cancel` | plugin → bridge | Cancel the in-flight turn for a session |

The plugin MUST NOT send or interpret any method, field, or event that identifies which harness or
model provider is behind the bridge (Principle II) — the contract surface is harness-agnostic by
construction; harness identity is never part of the payload.

## Reconnect / replay

- Each `session/update` the bridge emits carries a monotonically increasing per-session sequence
  number.
- On reconnect, the plugin MAY include the last sequence number it successfully processed; the
  bridge MUST replay any `session/update` events after that sequence number that occurred while
  disconnected, and MUST NOT replay events at or before it (FR-005).
- If the plugin cannot supply a last-seen sequence number (e.g. fresh install), the bridge MUST
  treat the session as needing a full current-state resend rather than silently resuming from an
  unknown point.

## Error surfacing

- If the bridge cannot reach the configured harness process (crashed, host offline reachable only
  via failed connection, etc.), it MUST return a distinct connectivity/availability error rather
  than timing out silently, so the plugin can render a clear error state (FR-012).

## Out of scope for this contract

- Transport-level details of how the bridge spawns the harness (see
  `contracts/bridge-harness-spawn.md`).
- Vault tool call semantics (see `contracts/harness-mcp-vault.md`).

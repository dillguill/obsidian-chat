# Phase 1 Data Model: ACP/MCP Standards Migration

These are the conceptual entities this feature introduces or changes. None of them are new
persistent database records — they map onto in-memory bridge/proxy state, host-side config files,
and existing vault notes.

## Session

Represents one ongoing ACP conversation between a plugin device and the configured harness.

| Field | Description |
|---|---|
| `sessionId` | ACP-assigned identifier, stable across reconnects for the life of the conversation |
| `deviceId` | Which authenticated plugin device owns this session |
| `state` | `active` \| `streaming` \| `cancelled` \| `ended` |
| `noteRef` | Path of the vault note this session is persisted to (sessions-as-notes, plugin-owned) |

**Relationships**: A Session belongs to exactly one Device and is served by exactly one Harness
instance (the one currently configured on the host). A Session may have zero or more pending
Approval Requests at a time.

**Validation / rules**:
- A `sessionId` MUST NOT be reused across two different Devices' conversations (isolation, per
  spec Edge Cases).
- Ending a Session (harness completes, or user closes it) MUST finalize its `noteRef` note.

## Harness Config

Host-side configuration selecting which ACP agent process the bridge spawns and which model
provider that agent uses. Not a runtime entity — a config file/value on the host.

| Field | Description |
|---|---|
| `command` | Local command + args to spawn (e.g. `opencode acp`, the Claude Code ACP entry point, `gemini --acp`, a Goose ACP provider invocation) |
| `providerConfig` | Opaque, harness-owned provider settings (API keys, base URL, model) — the bridge and plugin never read or branch on this |

**Validation / rules**:
- Changing `command` or `providerConfig` MUST NOT require any change to plugin code, bridge code,
  or the MCP proxy (Principle II, FR-006, FR-013).
- Exactly one Harness Config is active at a time (per spec Assumptions — no multi-harness routing).

## Bridge Connection

Represents one authenticated plugin device's transport-level link to the bridge.

| Field | Description |
|---|---|
| `deviceId` | Identity established via per-device auth token |
| `lastDeliveredSeq` | Sequence marker for the last stream chunk successfully delivered to this device, used for replay-on-reconnect |
| `status` | `connected` \| `disconnected` |

**Relationships**: A Bridge Connection carries zero or more active Sessions for its Device.

**Validation / rules**:
- On reconnect, the bridge MUST resume delivery from `lastDeliveredSeq` without re-sending
  already-delivered content and without dropping content produced while disconnected (FR-005).
- An unauthenticated connection attempt MUST be rejected before any Session data is exposed
  (FR-004).

## Vault Tool Call

One request, originating from the harness, to read, search, or write vault content — issued as an
MCP tool call and passed through the MCP proxy to LRA's built-in MCP server.

| Field | Description |
|---|---|
| `tool` | The MCP tool name being invoked (read/search/create/edit/delete/etc., as exposed by LRA's MCP server) |
| `targetPath` | Vault-relative path(s) the call touches |
| `kind` | `read` \| `write` |

**Validation / rules**:
- A call whose `targetPath` falls under a blacklisted folder (`settings.blacklistFolders`, the
  existing hard access-control gate — see `plugin/src/retrieval/index.ts`'s `isExcluded()`) MUST
  be rejected by the MCP proxy before it reaches LRA (FR-008).
- **Correction from earlier drafts**: `.chat/rules.md` is not an access-control mechanism in the
  existing product — it is advisory instruction text (like `AGENTS.md`), nearest-folder-wins,
  injected into the model's context (see `plugin/src/ui/chat-view.ts`'s
  `readNearestFolderRules`/`assembleGrounding`). The proxy does not enforce it; it continues to
  reach the harness as context content, independent of the proxy's allow/deny decision.
- A `write` call is additionally subject to the active Approval Request flow before it is allowed
  to reach LRA, unless the current approval mode is Auto and the call matches a previously granted
  allow rule.

## Approval Request

A pending decision point surfaced to the user when a Vault Tool Call of kind `write` requires
confirmation under the session's active approval mode.

| Field | Description |
|---|---|
| `sessionId` | Session this request belongs to |
| `mode` | `auto` \| `review` \| `plan` (snapshot of the mode active when the request was raised) |
| `proposedChange` | Description/diff of the write being proposed |
| `decisionState` | `pending` \| `approved` \| `denied` \| `plan-only` (never applied) |

**Relationships**: Belongs to one Session; corresponds to exactly one Vault Tool Call of kind
`write`.

**Validation / rules**:
- `decisionState` MUST remain `pending` (not lost, not auto-resolved) across a connection drop and
  later reconnect of the owning device (FR-010, spec Edge Cases).
- A write MUST NOT be applied to the vault while `decisionState` is `pending` or `plan-only`.
- In `plan` mode, `decisionState` MUST resolve to `plan-only` and the underlying write MUST NOT
  execute, regardless of any later user action within that same request.

## State Transitions Summary

```text
Session:         active -> streaming -> active -> ... -> ended
                                     \-> cancelled

Bridge Connection: connected <-> disconnected (transitions do not end Sessions)

Approval Request:  pending -> approved   (Vault Tool Call proceeds)
                   pending -> denied     (Vault Tool Call discarded)
                   pending -> plan-only  (Vault Tool Call never issued to LRA)
```

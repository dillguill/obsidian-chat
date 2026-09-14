# Phase 1 Data Model: ACP-Only Chat UX Completion

Entities are plugin-side view/state shapes built from real ACP schema types (see research.md) —
none of these are new wire formats; they're what the plugin already receives, named and typed.

## Session

The one persistent record of a conversation, unchanged in kind from today, only in what feeds it.

| Field | Type | Notes |
|---|---|---|
| `sessionId` | `string` | From the bridge's `session/new` response. |
| `sessionPath` | `string` | Vault-relative note path; empty until the first turn creates it. |
| `history` | `ChatMessage[]` | User/assistant turns, used both for rendering and for writing the session note body. |

No `model`/`provider` field — dropped per research.md R10; the plugin doesn't know this in the
ACP world.

## Approval Prompt

One pending or resolved decision for one proposed vault-write tool call. Independently
resolvable from any other prompt on screen (research.md R3).

| Field | Type | Notes |
|---|---|---|
| `requestId` | `string` | From the bridge's `permission_request` event. |
| `action` | `string` | `toolCall.title ?? toolCall.kind`. |
| `path` | `string` | `toolCall.locations?.[0]?.path`. |
| `diff` | `string[]` | Parsed from `toolCall.content` (`ToolCallContent[]` — real Diff/Content/Terminal variants, not raw JSON). |
| `options` | `PermissionOption[]` | The harness's actual offered options (`optionId` + `kind`). |
| `status` | `"pending" \| "approved" \| "rejected"` | Drives the card's rendered state. |
| `remember` | `boolean` | If set on resolution, persists into `settings.toolAllowlist[action]`. |

**State transitions**: `pending` → (`approved` | `rejected`) by the user picking a `PermissionOption`
of the matching kind, sent via the bridge's approval-resolution endpoint. `approved` may further
transition to having its Undo Snapshot consumed (see below) — this doesn't change `status`, it's
a separate, always-available action for the rest of the session.

## Undo Snapshot

Captured *before* an approval response is sent, so it always reflects pre-write state.

| Field | Type | Notes |
|---|---|---|
| `path` | `string` | Same as the Approval Prompt's `path`. |
| `previousContent` | `string \| null` | File content read just before approving; `null` means the file didn't exist (undo = delete it). |

Kept for the lifetime of the chat view instance (i.e. "rest of the session," per research.md R4)
— not persisted across a session reload.

## Agent Mode

Read-only mirror of ACP's `SessionModeState`; the plugin never invents values here.

| Field | Type | Notes |
|---|---|---|
| `currentModeId` | `SessionModeId` (`string`) | |
| `availableModes` | `SessionMode[]` | Each with at least `id`/`name`; harness-defined, harness-ordered. |

Updated on `session/new`'s response and live via `current_mode_update`. Changed by calling
`session/set_mode`. If `availableModes` is empty or absent, the mode control does not render
(FR-008).

## Thinking Level

Read-only mirror of one `SessionConfigOption` where `category === "thought_level"` (or a
name-pattern fallback match — `/think|reasoning|effort/i` — for a harness that omits `category`,
which is optional in the schema).

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Option label. |
| `currentValue` | `string \| boolean` | |
| `options` | `SessionConfigSelectOptions` | Flattened for menu rendering (groups supported). |

Updated on `session/new`'s response and live via `config_option_update`. Changed by calling
`session/set_config_option`. Absent → no thinking control rendered.

## Reasoning Block

One inferred burst of `agent_thought_chunk` text (research.md R8) — purely a client-side render
concept, not something the protocol names.

| Field | Type | Notes |
|---|---|---|
| `text` | `string` | Accumulated text for this burst. |
| `phase` | `"streaming" \| "collapsed" \| "expanded"` | `streaming` while chunks are arriving; becomes `collapsed` the instant something else interrupts it (a message chunk or a tool call); toggles between `collapsed`/`expanded` on header click thereafter. |
| `startedAt` | `number` (ms) | For the live "Thinking Ns…" label. |
| `durationSeconds` | `number \| undefined` | Frozen once `phase` leaves `streaming`, for the "Thought for Ns" label. |

A turn may render zero or more of these in sequence; each is independent (no shared "thread" id
needed — sequence order in the transcript is the thread).

## Available Command

Read-only mirror of one `AvailableCommand`.

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | e.g. `research-codebase`; rendered with a leading `/`. |
| `description` | `string` | Shown as the menu hint. |
| `input` | `UnstructuredCommandInput \| null` | Free text typed after the command name, passed through verbatim. |

Merged at render time with the two fixed local entries (`/clear`, `/help`) — never overwrites
them; a harness command literally named `clear` or `help` would just appear as a second,
distinguishable entry (edge case, not expected in practice, not specially handled).

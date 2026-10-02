# Phase 0 Research: ACP-Only Chat UX Completion

No `NEEDS CLARIFICATION` markers were left in the Technical Context — every decision below was
resolved during an extended brainstorming pass by directly inspecting the vendored ACP SDK
(`node_modules/@agentclientprotocol/sdk`) and by reading real prior-art source (Claudian, cloned
locally) rather than assuming. This document consolidates those findings.

## R1: Does ACP support a client-attached MCP server for Obsidian-specific tools?

- **Decision**: No new MCP server is built. The existing `harness/src/acp-bridge.mjs` already
  attaches a vault MCP proxy via ACP's standard `mcpServers` field on `session/new`
  (`config.mcpVaultProxyUrl`, confirmed at acp-bridge.mjs:177-180) — this already works today and
  needs no change for this feature.
- **Rationale**: `NewSessionRequest`/`LoadSessionRequest` in the SDK schema
  (`schema/types.gen.d.ts:4728` area) define `McpServer` (http/sse/stdio/acp variants) as a
  first-class, standard mechanism for a client to hand the harness additional tools per session.
  This is exactly the mechanism the bridge already uses.
- **Alternatives considered**: Building a bespoke Obsidian-tools MCP server (frontmatter/tags/
  canvas-specific tools) — rejected after reading Claudian's actual source: it doesn't build any
  such tools either, it just points the coding agent's generic file tools at the vault directory,
  since frontmatter/tags are plain text to a generic file tool. `obsidian-mcp-tools`
  (jacksteamdev) already exists as a mature, separate plugin for anything genuinely beyond plain
  file text (semantic search, Templater) — deferred as an optional future addition, not built here.

## R2: How should Obsidian-specific conventions (wikilinks, callouts, frontmatter shape) reach a harness?

- **Decision**: Host-side skill installation. `kepano/obsidian-skills` installed into whichever
  configured harness supports the Agent Skills spec (confirmed: Claude Code, opencode).
- **Rationale**: Matches how Claudian itself handles conventions — via Skills, not custom tool
  code or plugin-injected prompt text.
- **Alternatives considered**: Plugin-injected advisory context (same pattern as the existing
  `vault-rules.md` injection) — would work uniformly across harnesses regardless of Agent Skills
  support, but adds plugin code for something host configuration already solves for the
  harnesses actually in scope. Deferred, not built, unless a non-skill-aware harness turns out to
  matter in practice.

## R3: How should write-tool approval/diff be presented?

- **Decision**: One inline, non-blocking card per tool call in the transcript. Approve/Reject
  only, no inline-edit-then-apply. No batch/"approve all" grouping control.
- **Rationale**: `RequestPermissionResponse`'s `outcome` can only select one of the harness's
  offered `PermissionOption`s (schema: `PermissionOptionKind = "allow_once" | "allow_always" |
  "reject_once" | "reject_always"`, confirmed at `schema/types.gen.d.ts:637`) — there is no field
  for returning edited content, so inline editing cannot be implemented as a protocol response
  regardless of UI design. Checked both Claudian (word-level diff preview, approve/reject, no
  edit) and Obsidian Copilot Agent (Approve/Approve-for-Session/Reject, strictly per-call, no
  batch control) — neither comparable does inline editing or batching either, confirming this
  isn't a plugin limitation being under-built, it's the validated pattern.
- **Alternatives considered**: Reject-and-auto-resend-as-new-turn to approximate editing —
  rejected as needless fragility (a second round-trip, no guarantee the harness applies the
  edited text verbatim) for a capability neither comparable tool offers. A grouped
  "batch card + approve-all" for multi-file turns — rejected; no comparable does this, and ACP
  has no protocol-level grouping between independent `permission_request` events to build it on
  cleanly anyway (each arrives as its own event with no shared "turn" id).

## R4: How should Undo work?

- **Decision**: Snapshot the target file's content immediately before responding "allow" to a
  mutating call; Undo stays available for any approved write for the rest of the session (not
  just the most recent one).
- **Rationale**: Matches Obsidian Copilot Agent's documented model ("undo capability for any
  applied vault write within the active session").

## R5: How should agent mode be controlled?

- **Decision**: No plugin-owned mode concept. Render whatever `SessionModeState.availableModes`
  the connected harness declares (from `session/new`'s response, kept live via
  `current_mode_update`), switched via `session/set_mode`.
- **Rationale**: `SessionModeState` (`currentModeId` + `availableModes: SessionMode[]`) is a
  first-class ACP primitive (`schema/types.gen.d.ts:2561`), separate from and more specific than
  the generic `SessionConfigOption` category mechanism — this is the same primitive Claude Code's
  own mode switcher is built on. The plugin's permission-request handling becomes unconditional
  (always show the approval card); if a harness's active mode means it won't ask, the plugin
  simply never receives that `request_permission` call — no plugin-side "auto mode" branch needed.
- **Alternatives considered**: A plugin-owned `auto`/`review`/`plan` enum translated into
  behavior locally (today's `settings.approvalMode`) — rejected; it duplicates policy the harness
  already owns and can't reflect a harness-specific mode the plugin doesn't know about.
- **Note (opencode specifically)**: opencode's own permission system
  (`opencode.json`'s `permission` block, e.g. `{"*": "allow"}`, or its `--auto`/TUI toggle) is
  more granular than what the plugin would otherwise build, and is host configuration, not
  plugin/bridge code. Whether opencode's ACP layer surfaces this as one of its `availableModes`
  is unconfirmed from documentation alone and should be verified empirically once connected
  during implementation — flagged as a task-time verification, not a spec ambiguity, since the
  plugin's behavior (render whatever `availableModes` says) is correct either way.

## R6: How should thinking/reasoning level be controlled?

- **Decision**: A `SessionConfigOption` with `category: "thought_level"` (schema:
  `SessionConfigOptionCategory = "mode" | "model" | "model_config" | "thought_level" | string`,
  `schema/types.gen.d.ts:2664`), delivered via `NewSessionResponse.configOptions`, live via
  `config_option_update`, changed via `session/set_config_option`. Rendered as a plain pick-one
  menu (not a fuzzy-search modal — reserved for option lists that can be large, like models).
- **Rationale**: Same "no plugin-hardcoded enum" reasoning as R5; confirmed this is a genuinely
  separate protocol object from `SessionMode`, not the same mechanism reused.

## R7: How should the "/" command list work?

- **Decision**: Driven by ACP's `available_commands_update` session/update
  (`AvailableCommand[]`: `name`, `description`, free-text `input`; schema:
  `schema/types.gen.d.ts:3782`), with only `/clear` and `/help` kept as fixed local entries.
  `/web` (today's only other hardcoded command, calling the local BYOK tool path) is dropped.
- **Rationale**: Matches how Claudian and Obsidian Copilot both work — commands/skills surfaced
  by the underlying coding agent, not reimplemented by the Obsidian-side plugin.

## R8: How should the reasoning/thinking display look and behave?

- **Decision**: Adopt Claudian's actual accordion component directly (read from
  `src/features/chat/rendering/ThinkingBlockRenderer.ts` and
  `src/style/components/thinking.css` in the real repo, not a description of it): a clickable
  header with a live-ticking "Thinking Ns..." label while streaming, auto-collapses on burst end
  to a frozen "Thought for Ns" label, click to re-expand inline (no popup/overlay). Reopening a
  saved session renders pre-collapsed. Multiple bursts in one turn = multiple sequential blocks.
- **Rationale**: `agent_thought_chunk` is a plain `ContentChunk` with no segment/message id
  (confirmed in schema — it shares the exact shape of `agent_message_chunk`), so burst boundaries
  are inferred client-side by adjacency (a burst closes when interrupted by a message chunk or a
  tool call), not a native protocol field. This differs from Claudian's own boundary detection,
  which is exact because it wraps the Claude Agent SDK directly (which does send explicit
  thinking-block start/stop signals) — noted as a known, harmless difference in mechanism, not
  outcome.

## R9: Does the bridge already relay everything needed for R5–R7, or does it need changes?

- **Decision**: Two small additions are needed to `harness/src/acp-bridge.mjs` (not zero, as
  earlier assumed during brainstorming before this verification pass): the `POST /sessions`
  handler must forward `configOptions`/mode state from `session/new`'s full response (today it
  destructures only `{ sessionId }`, discarding the rest — acp-bridge.mjs:180), and two new
  routes are needed for `session/set_mode` and `session/set_config_option` (no equivalent route
  exists today — confirmed by reading the full HTTP route table in acp-bridge.mjs).
- **Rationale**: Directly read the file rather than assume; this caught a real gap before
  implementation started. `session_update` relay itself needs **no** change — it already
  forwards the harness's full update object regardless of its `sessionUpdate` discriminant
  (acp-bridge.mjs:106-108: `publish(sessionId, "session_update", update)`), so
  `current_mode_update`, `config_option_update`, and `available_commands_update` already arrive
  at the plugin today; they're just unhandled there. This is documented precisely in
  `contracts/plugin-bridge-acp-extensions.md`.

## R10: What happens to the pre-existing "sessions don't save" bug?

- **Decision**: Fixed as a direct side effect of R-scope-cut (BYOK removal), not as a separately
  engineered fix.
- **Rationale**: `chat-view.ts`'s `persistSession()` calls
  `getActiveProvider(this.plugin.settings).model`/`.name` unconditionally when building session
  frontmatter (lines ~792-793). `getActiveProvider` returns `undefined` when `settings.providers`
  is empty — the exact target configuration (ACP-only, zero BYOK providers) — so this throws
  before the file write happens, caught by the caller's try/catch and surfaced only as a
  "Couldn't save session" Notice. Once BYOK is removed, `getActiveProvider` no longer exists, so
  this line is replaced by simply dropping the `model`/`provider` frontmatter fields (the plugin
  isn't supposed to know the model/provider name in the ACP world per FR-006 of
  specs/001-acp-mcp-migration) — no substitute lookup is needed.

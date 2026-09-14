# Implementation Plan: ACP-Only Chat UX Completion

**Branch**: `002-acp-only-chat-ux` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-acp-only-chat-ux/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Finish what specs/001-acp-mcp-migration started (FR-001/FR-006/FR-011 were never fully carried
out) by deleting the plugin's entire BYOK/local-tool-execution stack, leaving ACP as the only
path. On top of that ACP-only foundation, re-plumb three UX surfaces onto real, already-vendored
ACP primitives instead of plugin-hardcoded concepts: write approval becomes an inline
per-call card (no batching, no inline edit — validated against Claudian and Obsidian Copilot
Agent), agent mode and thinking level become fully harness-declared (`SessionMode`,
`SessionConfigOption`), and the "/" command list becomes harness-declared
(`AvailableCommand`). Reasoning display adopts Claudian's actual accordion pattern. A real,
currently-live bug is fixed as a side effect of the BYOK deletion: session notes fail to save
today for anyone running ACP-only with zero BYOK providers configured, because
`persistSession()` unconditionally calls into BYOK-only provider lookup.

## Technical Context

**Language/Version**: TypeScript 5.5 (plugin only — this feature touches no harness/bridge
language choice), Obsidian's bundled runtime; `harness/src/acp-bridge.mjs` stays Node.js ≥20 ESM
(unchanged toolchain, small additions only — see Project Structure).

**Primary Dependencies**: `@agentclientprotocol/sdk` (already a dependency; this feature is the
first to consume its `SessionMode`, `SessionConfigOption`, `AvailableCommand`, and the real
`ToolCallContent` Diff/Content/Terminal variants — all confirmed present in the vendored SDK
during planning, not assumed), Obsidian Plugin API, esbuild (existing build).

**Storage**: Unchanged — vault content as Markdown notes via existing Obsidian vault APIs, session
notes in the user's configured folder.

**Testing**: No automated test framework exists in this repo (consistent with
specs/001-acp-mcp-migration's plan). `tsc --noEmit` as a compile-time gate, plus
`quickstart.md`'s manual scenarios as the acceptance check.

**Target Platform**: Obsidian plugin webview, desktop and mobile.

**Project Type**: Client (Obsidian plugin) is where nearly all of this feature lives. Two small,
targeted additions to the existing host-side bridge are required (see Project Structure) — this
is not a new project or component, it's extending the one bridge component the constitution
already permits.

**Performance Goals**: No regression vs. today's ACP path. Approval-card render and
mode/thinking-picker interactions are local UI state changes with no added network round trip
beyond the ACP calls the feature already needs to make.

**Constraints**: MUST NOT reintroduce any BYOK/local-tool-execution code path (Constitution IV).
MUST NOT hardcode a fixed set of modes or thinking levels (Constitution II). MUST NOT introduce a
new custom component beyond the two the constitution already names — the bridge and the rules
proxy (Constitution III); the bridge additions below extend its existing, already-permitted role
(session lifecycle relay), they are not a new component.

**Scale/Scope**: Personal-use, single vault, single harness/bridge connection at a time (per
specs/001-acp-mcp-migration's existing assumption, carried forward unchanged).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Standards Over Custom Protocols | Every new plugin behavior (mode switching, thinking-level switching, dynamic commands, diff parsing) is driven by real, named ACP schema types already vendored in this repo (`SessionMode`, `SessionConfigOption`, `AvailableCommand`, `ToolCallContent`) — confirmed against `node_modules/@agentclientprotocol/sdk` during planning. No new wire protocol. | PASS |
| II. Provider Agnosticism | This feature deletes the plugin's last remaining provider-specific code (`chat/anthropic.ts`, `openai-compat.ts`, `models.ts`) and removes the plugin's own hardcoded mode/thinking-level enums in favor of harness-declared values. | PASS |
| III. Minimal Custom Glue | No new custom component. The two bridge additions (relay `configOptions`/mode state on `session/new`; add `session/set_mode` and `session/set_config_option` routes) extend the ACP bridge's existing, already-permitted job (ACP relay) — they don't add a third component, and they stay harness-agnostic (pure pass-through of standard ACP methods, no harness-specific branching). | PASS |
| IV. Delete Over Accumulate | This feature's single largest change is deletion: `chat/anthropic.ts`, `openai-compat.ts`, `models.ts`, `runtime.ts`, `engine.ts`, `ground.ts`, `tools/contract.ts`, `tools/runner.ts`, Tavily/web-search code, and the BYOK-only fields of `settings.ts`, removed outright rather than kept behind a flag. | PASS |
| V. Simplicity / YAGNI | Two features considered and explicitly rejected after checking real prior art: a plugin-owned "batch approve-all" UI (neither Claudian nor Obsidian Copilot Agent do this — dropped), and a custom Obsidian-specific MCP tool server (Claudian just uses generic file tools; existing `mcpServers` wiring already covers this — nothing built). | PASS |

Initial gate result: **PASS**. Re-evaluated after Phase 1 design below.

## Project Structure

### Documentation (this feature)

```text
specs/002-acp-only-chat-ux/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
plugin/                                  # Obsidian plugin — ACP-only after this feature
├── src/
│   ├── acp/
│   │   └── client.ts                    # EXTENDED: session mode (SessionMode/set_mode/
│   │                                     #   current_mode_update), config options
│   │                                     #   (SessionConfigOption/set_config_option/
│   │                                     #   config_option_update), available commands
│   │                                     #   (AvailableCommand/available_commands_update),
│   │                                     #   real ToolCallContent diff parsing
│   ├── chat/
│   │   ├── types.ts                     # TRIMMED: StreamEvent/ChatMessage stay; ChatRequest/
│   │   │                                 #   ChatRuntime/ToolDefinition/RetrievedNote removed
│   │   ├── anthropic.ts                 # REMOVED
│   │   ├── openai-compat.ts             # REMOVED
│   │   ├── models.ts                    # REMOVED
│   │   ├── runtime.ts                   # REMOVED
│   │   ├── engine.ts                    # REMOVED
│   │   └── ground.ts                    # REMOVED
│   ├── tools/                           # REMOVED entirely (contract.ts, runner.ts)
│   ├── search/                          # REMOVED entirely (tavily.ts) — no other caller
│   ├── retrieval/
│   │   └── index.ts                     # TRIMMED: VaultIndex keeps ensureLoaded/getAll/read
│   │                                     #   (still used by @mention via attachMentions);
│   │                                     #   createNote/editNote/renameMove/createFolder/
│   │                                     #   setProperty/manageTags/deleteFile removed —
│   │                                     #   confirmed zero callers outside tools/contract.ts
│   ├── ui/
│   │   ├── chat-view.ts                 # MODIFIED: dynamic mode/thinking/command pickers,
│   │   │                                 #   new inline approval-card wiring, thinking
│   │   │                                 #   accordion, mobile toolbar CSS hook, persistSession
│   │   │                                 #   frontmatter fix (drop model/provider fields)
│   │   ├── approval.ts                  # REPLACED by an inline, non-modal card renderer
│   │   │                                 #   (same responsibility — render one WritePreview,
│   │   │                                 #   resolve an ApprovalDecision — new rendering only)
│   │   └── acp-picker-menu.ts            # NEW: small shared helper for the plain pick-one
│   │                                     #   Menu used by both the mode and thinking-level
│   │                                     #   pickers (reuses the existing Menu/addItem/
│   │                                     #   showAtPosition pattern already proven by
│   │                                     #   openAttachMenu — no new UI primitive)
│   └── settings.ts                      # TRIMMED: remove providers/model-picker/pinned-
│                                         #   models/per-provider thinking+vision toggles/
│                                         #   grounding-mode/max-tool-rounds/token-budget/
│                                         #   Tools-modal/approvalMode/ThinkingLevel; keep
│                                         #   chatFolder, blacklistFolders, injectVaultRules,
│                                         #   gateway config, toolAllowlist
└── styles.css                            # MODIFIED: thinking-accordion styles (adapted from
                                          #   Claudian's thinking.css), mobile toolbar spacing
                                          #   fix, inline approval-card styles

harness/                                 # Two small, targeted additions — not a new component
└── src/
    └── acp-bridge.mjs                   # EXTENDED: (1) POST /sessions response includes the
                                          #   harness's initial `modes`/`configOptions` from
                                          #   session/new's response (today only `sessionId` is
                                          #   forwarded); (2) two new routes,
                                          #   POST /sessions/:id/mode -> session/set_mode and
                                          #   POST /sessions/:id/config-option ->
                                          #   session/set_config_option. No change needed to
                                          #   session_update relay — it already forwards the
                                          #   whole update object regardless of its
                                          #   sessionUpdate discriminant, so
                                          #   current_mode_update/config_option_update/
                                          #   available_commands_update already reach the
                                          #   plugin today, just unhandled on that end.
```

**Structure Decision**: Reuse the existing `plugin/` + `harness/` layout from
specs/001-acp-mcp-migration; no new top-level project. This feature is plugin-dominant (nearly
every file touched lives under `plugin/src/`) with two small, additive changes to the existing
bridge. No changes to `harness/src/mcp-rules-proxy.mjs` — confirmed during planning that its
existing job (blacklist/rules pass-through, already attached to every session via `mcpServers`)
already covers everything this feature's Obsidian-tooling requirements need.

## Complexity Tracking

*No entries — Constitution Check has no violations to justify (see table above, all PASS).*

## Post-Design Constitution Check

*Re-evaluated after Phase 1 design (data-model.md, contracts/, quickstart.md).*

| Principle | Post-design status | Notes |
|---|---|---|
| I. Standards Over Custom Protocols | PASS | `contracts/plugin-bridge-acp-extensions.md` adds only pass-through relaying of standard ACP methods/fields (`session/set_mode`, `session/set_config_option`, `modes`/`configOptions` on `session/new`) — no new wire shape invented, no interpretation of harness-specific content by the bridge. |
| II. Provider Agnosticism | PASS | `data-model.md`'s Session entity has no `model`/`provider` field; Agent Mode and Thinking Level entities are explicitly harness-declared mirrors with no plugin-side default/fallback value. |
| III. Minimal Custom Glue | PASS | The contract addendum confirms the bridge additions are two small routes plus a response-field fix to the *existing* `/sessions` handler — not a new component, and `mcp-rules-proxy.mjs` is untouched. |
| IV. Delete Over Accumulate | PASS | `quickstart.md`'s regression check greps for every removed module/export and requires zero remaining references before the feature is considered done. |
| V. Simplicity / YAGNI | PASS | data-model.md's Approval Prompt has no batch/group entity — confirmed each prompt is independently modeled, matching the R3 decision to not build a grouping concept the protocol doesn't support cleanly anyway. |

Final gate result: **PASS**.

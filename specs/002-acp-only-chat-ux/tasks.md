---

description: "Task list for ACP-Only Chat UX Completion"
---

# Tasks: ACP-Only Chat UX Completion

**Input**: Design documents from `/specs/002-acp-only-chat-ux/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not included — no automated test framework exists in this repo (research.md, matching
specs/001-acp-mcp-migration's precedent). Acceptance is `quickstart.md`'s manual walkthrough,
referenced at each story's checkpoint below.

**Organization**: Tasks are grouped by user story from spec.md (priorities P1/P1/P2/P2/P3/P3).

---

## Status reconciliation (2026-09-13)

This table is authoritative; the `[ ]` boxes below were left as written to avoid churn. Status was established by reading the shipped code and running the checks noted, then re-verified during `specs/003-workspace-parity`.

| Task | Status | Evidence / note |
|---|---|---|
| T001 baseline build | **done** | `npx tsc -p tsconfig.json --noEmit` clean and `node esbuild.config.mjs production` exit 0, re-run at every step of 003. |
| T002 delete BYOK chat modules | **done, one deviation** | No `chat/anthropic`, `chat/openai-compat`, `chat/models`, `chat/runtime`, `chat/engine`. `chat/ground.ts` was **retained** — it is the home of `extractWikilinks()`, which the `@mention` force-attach path still uses (`chat-view.ts:11`). Only `chat/{ground,tool-input,types}.ts` remain. |
| T003 delete `tools/` | **done** | No `plugin/src/tools/`. |
| T004 delete `search/tavily.ts` + settings | **done** | No `plugin/src/search/`; no Tavily anywhere in settings. |
| T005 delete `ui/tools-modal.ts` | **done** | Not present in `plugin/src/ui/`. |
| T006 trim `VaultIndex` | **done** | grep for `createNote/ editNote/ renameMove/ createFolder/ setProperty/ manageTags/ deleteFile` in `retrieval/index.ts` → no matches. |
| T007 trim `chat/types.ts` | **done** | No `ChatRequest`/`ChatRuntime`/`ToolDefinition`/`JsonSchema`. File now also carries 003's `ToolStatus`/`ActivityItem`/`PlanEntry`/`UsageInfo`. |
| T008 trim `settings.ts` | **done** | Settings are `gateway`, `chatFolder`, `blacklistFolders`, `injectVaultRules`, `toolAllowlist`, `acpConfigOverrides`, `host`, plus 003's `uiDensity`/`sendShortcut`. No providers/grounding/approval-mode/Tavily fields. |
| T009 rewrite `approval.ts` | **done** | Exports `renderApprovalCard`, `WritePreview`, `ApprovalDecision`; no `ApprovalRequester`. |
| T010 rewrite `main.ts` | **done, one deviation** | No tool runner or Tavily wiring. **Inline edit was not carried over at all** — `ui/inline-edit.ts` no longer exists and there is no command for it. Selection→chat landed instead in 003 (W3.1/W3.3). |
| T011 rewrite the send path | **done** | `sendViaAcp` is the only send path; no `sendViaProvider`/`prefersGateway`/`ChatEngine`/`enabledToolDefinitions`; `persistSession` writes no `model`/`provider` frontmatter. |
| T012 resolve remaining compile errors | **done** | tsc clean. |
| T013 US1 end-to-end | **code complete; manual pass pending** | The exchange + persistence path exists and the bridge leg was exercised live in the P0 probe (003 §10), but the plugin-UI walkthrough has not been run since the plugin was reinstalled. Folded into T031. |
| T014 `toolCallContentLines` export | **done** | Exported from `acp/client.ts`; parses Diff/Content/Terminal. 003 additionally gates it to diff-shaped payloads only. |
| T015 inline approval card | **done** | `renderApprovalCard` — Approve/Reject, "remember this action", no batch control. |
| T016 Undo | **done** | Snapshot captured before sending `allow`; `onUndo` restores (or trashes a file that did not exist). 003 adds session-wide snapshots + Undo all. |
| T017 render card from `handlePermissionRequest` | **done** | Allowlist bypass preserved ahead of the card. |
| T018 approval-card styles | **done** | 11 `oc-approval*` rules in `styles.css`. |
| T019 bridge forwards `modes`/`configOptions` | **done** | `POST /sessions` returns `{ sessionId, modes, configOptions }`. |
| T020 bridge mode / config-option routes | **done** | `POST /sessions/:id/mode` and `/config-option` exist (the latter sends `configId` + `type:"boolean"` for booleans). |
| T021 client captures + handles + setters | **done** | `getModes/getConfigOptions`, `current_mode_update`, `config_option_update`, `setMode`, `setConfigOption`. |
| T022 `acp-picker-menu.ts` | **done** | `openAcpPickerMenu` / `flattenSelectOptions` over a native `Menu`. |
| T023 wire toolbar, hide when absent | **done, with an intentional exception** | Model and agent-mode hide when the harness declares none. **Thinking stays visible-but-disabled**, so the toolbar does not jump when switching models — the user explicitly confirmed this behaviour (2026-09-13). |
| T024 thinking-accordion styles | **done** | `.oc-thought-*` block. |
| T025 reasoning-burst rendering | **done** | `addThoughtDelta`/`finalizeThought`: live ticker, collapses on interruption. |
| T026 stored reasoning collapsed | **done** | `renderStoredThought` sets `data-expanded="false"` (`chat-view.ts:1195`). |
| T027 `available_commands_update` | **done** | Client stores commands + notifies state listeners. |
| T028 slash menu merges harness commands | **done** | `LOCAL_COMMANDS` = `/clear`, `/help` only; `/web` removed; `allSlashCommands()` merges the harness list. |
| T029 mobile toolbar CSS | **done, superseded** | Landed, then replaced in 003 W2.2 by a measured compact mode that hides labels only when the row actually wraps. |
| T030 regression grep | **done** | No code references to the deleted modules. One stale *comment* in `approval.ts` still named `tools/contract.ts`/`tools/runner.ts`; reworded 2026-09-13. |
| T031 full quickstart walkthrough | **PENDING** | Requires a real session against the bridge with Obsidian reloaded. Now also covers the 003 additions (activity groups, queue/steer, context chips, changes card, connection banner) — see `specs/003-workspace-parity/plan.md` §1.6/§2.6/§3.8/§7.14 for the per-area checks. |

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1–US6, per spec.md)

## Important cross-story note

Almost every task below touches `plugin/src/ui/chat-view.ts` — it's the single hub file for
sending, streaming, approval, mode/thinking, slash commands, and reasoning display today. Despite
each story being independently *testable* (per spec.md's Independent Test criteria), true
concurrent multi-person parallelism across US2–US5 is limited by that shared file. Implement in
priority order (US1 → US2 → US3 → US4 → US5 → US6) rather than attempting to parallelize story
phases against each other; `[P]` markers below are scoped to parallelism *within* a phase only.

---

## Phase 1: Setup

**Purpose**: Confirm a clean starting point before deleting anything.

- [ ] T001 Confirm the current baseline builds clean: `npx tsc -noEmit -skipLibCheck` and `node plugin/esbuild.config.mjs` (or repo's existing build script) both succeed with zero errors, and `git status` is clean, before any deletion begins.

**Checkpoint**: Known-good baseline confirmed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Remove the BYOK/local-execution stack and re-plumb the shared files so the plugin
has exactly one path (ACP) left to build every user story on top of. This phase carries out
FR-001/FR-002 and most of the mechanical work spec.md's US1 depends on — nothing in Phase 3+ can
be implemented cleanly while the deleted modules and their call sites still exist.

**⚠️ CRITICAL**: No user story phase can begin until this phase is complete.

- [ ] T002 Delete `plugin/src/chat/anthropic.ts`, `plugin/src/chat/openai-compat.ts`, `plugin/src/chat/models.ts`, `plugin/src/chat/runtime.ts`, `plugin/src/chat/engine.ts`, `plugin/src/chat/ground.ts`
- [ ] T003 Delete `plugin/src/tools/contract.ts`, `plugin/src/tools/runner.ts` (and the `plugin/src/tools/` directory if now empty)
- [ ] T004 Delete `plugin/src/search/tavily.ts` (and the `plugin/src/search/` directory if now empty) and remove the "Web search (Tavily)" settings section
- [ ] T005 [P] Delete `plugin/src/ui/tools-modal.ts` (only consumer was the removed Tools-configuration setting) — confirm no other importer first
- [ ] T006 [P] Trim `plugin/src/retrieval/index.ts`'s `VaultIndex`: remove `createNote`/`editNote`/`renameMove`/`createFolder`/`setProperty`/`manageTags`/`deleteFile` (confirmed zero callers outside the now-deleted `tools/contract.ts` adapter); keep `ensureLoaded`/`getAll`/`read` (still used by `@mention` via `attachMentions`)
- [ ] T007 [P] Trim `plugin/src/chat/types.ts`: remove `ChatRequest`, `ChatRuntime`, `ToolDefinition`, `JsonSchema`, `RetrievedNote` (BYOK-only); keep `StreamEvent`, `ChatMessage`, `ImageAttachment`, `ToolCall`, `Role`
- [ ] T008 Trim `plugin/src/settings.ts`: remove `ProviderType`, `ProviderPreset`, `PROVIDER_PRESETS`, `ProviderConfig`, `RuntimeKind`, `presetFor`, `runtimeKind`, `isAnthropicType`, `normalizeProviderType`, `getActiveProvider`, `ThinkingLevel`, `ALL_THINKING_LEVELS`, `thinkingLevelsFor`, `hasThinkingLevel`, `hasVision`, `setThinkingLevel`, and the settings fields `providers`, `activeProviderId`, `pinnedModels`, `groundingMode`, `approvalMode`, `mode` (`ChatMode`), `maxToolRounds`, `tokenBudget`, `enabledTools`, `tavily`, `thinkingLevel`; remove the corresponding settings-tab UI sections (Providers, model picker, grounding dropdown, Tools "Configure…" button, per-provider Advanced thinking/vision toggles); keep `chatFolder`, `blacklistFolders`, `injectVaultRules`, `gateway` (`GatewayConfig`), `toolAllowlist`
- [ ] T009 Rewrite `plugin/src/ui/approval.ts`: delete `createApprovalRequester`/`ApprovalRequester`-dependent local-approval wiring (tied to the now-deleted `tools/runner.ts`); leave the file's remaining shape as a placeholder for the new inline-card renderer built in US2 (T015) — do not attempt the new UI here, just remove what no longer compiles
- [ ] T010 Rewrite `plugin/src/main.ts`: remove `VaultIndex`/`ToolRunner`/Tavily wiring (`this.index`, `this.tools`, `createToolRunner`, `createTavilyProvider` import) tied to deleted modules; keep plugin registration, ribbon icon, commands, and inline-edit wiring — confirm `runInlineEdit` doesn't itself depend on anything deleted (check `plugin/src/ui/inline-edit.ts` before removing `this.index`/`this.tools`, since it may need read-only vault access kept)
- [ ] T011 Rewrite the send path in `plugin/src/ui/chat-view.ts`: remove `sendViaProvider`, `prefersGateway`, `ChatEngine` usage, `enabledToolDefinitions`, `getActiveProvider` references, and the BYOK branch of `attachMentions`'s index usage (keep the read-only `@mention` lookup path); make `sendViaAcp` the only send path; fix `persistSession()` to drop the `model`/`provider` frontmatter fields entirely (data-model.md Session, research.md R10) instead of calling `getActiveProvider(...)`
- [ ] T012 Fix any remaining compile errors in `plugin/src/acp/client.ts` and elsewhere caused by the `chat/types.ts` trim (T007) — re-run `tsc --noEmit` and resolve every error before moving on

**Checkpoint**: `npx tsc -noEmit -skipLibCheck` passes with zero errors; the plugin loads with no
console errors; a bare send → streamed reply → saved session note round trip works manually with
zero BYOK providers configured. (This *is* spec.md US1's Independent Test — Phase 3 below is the
short confirmation pass, not additional building.)

---

## Phase 3: User Story 1 - Chat works end to end with no direct provider configured (Priority: P1) 🎯 MVP

**Goal**: Confirm the ACP-only foundation built in Phase 2 actually delivers US1's promised
outcome, since nearly all of US1's substance was necessarily built while removing what blocked it.

**Independent Test**: With zero BYOK providers configured, send a message, confirm a streamed
reply renders, and confirm a session note exists afterward with no error notice.

### Implementation for User Story 1

- [ ] T013 [US1] Run `quickstart.md`'s US1 section end to end; if either check fails, fix the specific gap in `plugin/src/ui/chat-view.ts`'s `sendViaAcp`/`persistSession` (not a new file — this closes any gap Phase 2 missed)

**Checkpoint**: User Story 1 fully functional and independently verified.

---

## Phase 4: User Story 2 - Approve, reject, or undo a proposed vault change (Priority: P1)

**Goal**: Replace blocking per-write modals with an inline, independently-resolvable approval
card per tool call, with real diff content and session-lifetime undo.

**Independent Test**: Trigger a note edit, see an inline diff card, approve it, confirm it
applies, undo it, confirm the note reverts; trigger two writes in one turn and resolve them in
either order independently.

### Implementation for User Story 2

- [ ] T014 [US2] Extend `plugin/src/acp/client.ts`: add a `toolCallContentLines(content: ToolCallContent[])` export that parses the real Diff/Content/Terminal variants into displayable diff lines (data-model.md Approval Prompt `diff` field) — no more raw-JSON fallback
- [ ] T015 [US2] Rewrite `plugin/src/ui/approval.ts` (or a new `plugin/src/ui/approval-card.ts`, replacing `approval.ts`'s remaining content from T009) to render one non-blocking inline card per `WritePreview`/permission request in the transcript: Approve/Reject buttons only (no inline edit, per research.md R3), a "remember this action" checkbox, and no batch/approve-all control (data-model.md Approval Prompt)
- [ ] T016 [US2] Wire Undo in `plugin/src/ui/chat-view.ts`'s `handlePermissionRequest`: read the target file's current content via the vault immediately before sending an "allow" response (data-model.md Undo Snapshot), and surface an Undo action on the card's settled state that restores it (or deletes the file if it didn't previously exist), available for the rest of the session per any approved write
- [ ] T017 [US2] Update `plugin/src/ui/chat-view.ts`'s `handlePermissionRequest` to render the new card (T015) instead of `ApprovalModal`, keeping the existing `settings.toolAllowlist` bypass-check unchanged
- [ ] T018 [P] [US2] Add/replace the approval-card styles in `plugin/styles.css` (remove the old `.oc-approval`/modal-specific rules, add inline-card rules: item, diff, actions, applied/undone/denied states)

**Checkpoint**: `quickstart.md` US2 scenarios pass; User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Agent mode and thinking level reflect the connected harness (Priority: P2)

**Goal**: Replace the plugin's own hardcoded mode/thinking concepts with live, harness-declared
`SessionMode`/`SessionConfigOption` data end to end (bridge + plugin).

**Independent Test**: Open the mode/thinking controls and see only what the connected harness
actually declares; switch harnesses (or harness config) and see the controls update with no
plugin change; connect to a harness declaring neither, and see neither control appear.

### Implementation for User Story 3

- [ ] T019 [US3] Extend `harness/src/acp-bridge.mjs`'s `POST /sessions` handler to destructure and forward `modes`/`configOptions` from `session/new`'s full response, not just `sessionId` (contracts/plugin-bridge-acp-extensions.md)
- [ ] T020 [US3] Add two new routes to `harness/src/acp-bridge.mjs`: `POST /sessions/:id/mode` → `session/set_mode`, and `POST /sessions/:id/config-option` → `session/set_config_option`, following the existing device-ownership and error-handling conventions in that file (contracts/plugin-bridge-acp-extensions.md)
- [ ] T021 [P] [US3] Extend `plugin/src/acp/client.ts`: capture `modes`/`configOptions` from `connect()`'s response; handle `current_mode_update` and `config_option_update` in `mapSessionUpdate`/`dispatch` (today falling into the `default` case, unhandled); add `setMode(modeId)` and `setConfigOption(optionId, value)` methods calling the new bridge routes from T020
- [ ] T022 [US3] Create `plugin/src/ui/acp-picker-menu.ts`: a small shared helper rendering a plain pick-one `Menu` (reusing the existing `Menu`/`addItem`/`showAtPosition` pattern already proven by `openAttachMenu` — no new UI primitive), for use by both the mode and thinking-level pickers
- [ ] T023 [US3] Wire `plugin/src/ui/chat-view.ts`'s agent-mode and thinking-level toolbar buttons to T021's client state and T022's picker; hide each control entirely when its corresponding harness-declared list is empty (FR-008); remove any leftover reference to the deleted `approvalMode`/`ThinkingLevel` settings

**Checkpoint**: `quickstart.md` US3 scenarios pass.

---

## Phase 6: User Story 4 - Follow the assistant's reasoning (Priority: P2)

**Goal**: Adopt Claudian's accordion pattern for reasoning display, threaded per burst.

**Independent Test**: Watch reasoning stream live with a ticking label, see it auto-collapse when
it ends, re-expand it, see multiple bursts in one turn as separate blocks, and see collapsed
blocks when reopening a past session.

### Implementation for User Story 4

- [ ] T024 [US4] Add thinking-accordion styles to `plugin/styles.css`, adapted directly from Claudian's `src/style/components/thinking.css` (header, live/muted states, tree-branch-style indent) per research.md R8
- [ ] T025 [US4] Implement Reasoning Block rendering in `plugin/src/ui/chat-view.ts` (data-model.md Reasoning Block): on each `reasoning` `StreamEvent`, append to the currently-open block if one exists, or start a new one with a live-ticking "Thinking Ns…" header; close the current block (freeze to "Thought for Ns", collapse) the moment a `token` or `tool_call` event interrupts it; clicking a closed header toggles expand/collapse
- [ ] T026 [US4] Ensure `plugin/src/ui/chat-view.ts`'s `loadSession` path renders any saved reasoning blocks pre-collapsed (not auto-expanded) when reopening a session note

**Checkpoint**: `quickstart.md` US4 scenarios pass.

---

## Phase 7: User Story 5 - Use whatever commands the connected harness offers (Priority: P3)

**Goal**: Replace the hardcoded `/clear /web /help` menu with one driven by the harness's
declared `AvailableCommand` list, plus the two fixed local entries.

**Independent Test**: Connect to a harness exposing a custom command, type "/", see it listed
alongside `/clear` and `/help`; confirm the list updates if the harness's set changes mid-session.

### Implementation for User Story 5

- [ ] T027 [US5] Extend `plugin/src/acp/client.ts` to handle `available_commands_update`, exposing the current `AvailableCommand[]` (data-model.md Available Command)
- [ ] T028 [US5] Rewrite the slash-command menu in `plugin/src/ui/chat-view.ts` (`COMMANDS`, `updateSlashMenu`, `runSlashCommand`) to merge T027's dynamic list with the two fixed local entries `/clear` and `/help`; remove `/web` and its `startWebSearch` handler (the deleted Tavily/tool-execution path)

**Checkpoint**: `quickstart.md` US5 scenarios pass.

---

## Phase 8: User Story 6 - Use the toolbar comfortably on a phone (Priority: P3)

**Goal**: Fix toolbar spacing/truncation on narrow viewports without changing which controls exist.

**Independent Test**: On a phone-width viewport, every toolbar control is visible and tappable
with no overlap/cutoff; the same controls exist as on desktop.

### Implementation for User Story 6

- [ ] T029 [P] [US6] Add mobile toolbar CSS to `plugin/styles.css`: `min-width: 0` plus ellipsis-truncated labels with a viewport-relative `max-width` on the model/mode/thinking toolbar buttons, so none crowd or overflow at phone widths

**Checkpoint**: `quickstart.md` US6 scenarios pass. All user stories now independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across the whole feature.

- [ ] T030 [P] Run the regression-check grep from `quickstart.md` (`chat/anthropic`, `chat/openai-compat`, `chat/models`, `chat/runtime`, `chat/engine`, `chat/ground`, `tools/contract`, `tools/runner`, `search/tavily`, across `plugin/src`) and confirm zero remaining references
- [ ] T031 Run the full `quickstart.md` walkthrough (US1–US6) end to end in one sitting as a final acceptance pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS every user story phase (the deletions and rewiring in Phase 2 are prerequisites for every file touched afterward).
- **User Stories (Phases 3–8)**: All depend on Foundational completion. Implement in priority order (US1 → US2 → US3 → US4 → US5 → US6) — see "Important cross-story note" above for why this codebase doesn't support true concurrent story parallelism despite each being independently testable.
- **Polish (Phase 9)**: Depends on all desired user stories being complete.

### Within Each Phase

- Phase 2's deletions (T002–T005) can happen in any order/parallel; the rewiring tasks (T008–T012) depend on the deletions being done first and on each other in roughly the listed order (settings.ts before main.ts/chat-view.ts, since those import from it).
- Phase 5's T019/T020 (bridge) and T021 (plugin) touch different repos/processes and can be done in parallel; T022 (picker helper) has no dependency and can be done in parallel with either; T023 depends on T021 and T022 both being done.

### Parallel Opportunities

- T005, T006, T007 (Phase 2) — different files, no shared dependency.
- T018 (Phase 4), T029 (Phase 8) — pure CSS additions, independent of any other in-progress task once their phase's structural work exists.
- T021, T022 (Phase 5) — different files (plugin client vs. new picker helper), can proceed together.
- T030 (Phase 9) — independent of T031.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — this is the bulk of the real work and risk (deleting the BYOK stack cleanly).
3. Complete Phase 3: User Story 1 (a short confirmation pass on top of Phase 2).
4. **STOP and VALIDATE**: run `quickstart.md` US1 manually with zero BYOK providers configured — this is the state the plugin is actually used in today, and the state that currently has a silent session-save failure.

### Incremental Delivery

1. Setup + Foundational + US1 → a working, ACP-only plugin with the session-save bug fixed (MVP).
2. Add US2 (approval/diff/undo) → verify independently → this is the highest-risk remaining UX surface (write safety).
3. Add US3 (dynamic mode/thinking) → verify independently → requires the bridge changes (T019/T020), plan accordingly if bridge and plugin work happen at different times.
4. Add US4 (reasoning display) → verify independently → purely additive, no dependency on US2/US3.
5. Add US5 (dynamic commands) → verify independently → purely additive.
6. Add US6 (mobile spacing) → verify independently → purely additive, lowest risk.
7. Phase 9 polish pass across all six.

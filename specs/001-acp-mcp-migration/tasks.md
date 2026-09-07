---
description: "Task list for ACP/MCP Standards Migration"
---

# Tasks: ACP/MCP Standards Migration

**Input**: Design documents from `/specs/001-acp-mcp-migration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not requested in the spec, and no test framework exists in this repo yet (see plan.md
Technical Context). Verification instead uses `tsc --noEmit` type checking plus the manual
`quickstart.md` scenarios cited per task below.

**Organization**: Tasks are grouped by user story (spec.md priorities) to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5, per spec.md)

## Path Conventions

This is the existing `plugin/` (Obsidian plugin, npm workspace) + `harness/` (always-on host,
npm workspace) layout — see plan.md "Project Structure". No new top-level project.

---

## Phase 1: Setup

**Purpose**: Add the new standards-based dependencies alongside the existing code (nothing is
removed yet — removal happens in the Cutover phase once replacements are verified, per
Constitution Principle IV / FR-011).

- [ ] T001 Add `@agentclientprotocol/sdk` as a dependency in `plugin/package.json`
- [ ] T002 [P] Add an ACP TypeScript SDK dependency (agent-side) and an MCP TypeScript client SDK dependency in `harness/package.json`
- [ ] T003 [P] Create `harness/harness.config.json` (git-ignored template + `.example` committed) holding the Harness Config shape from data-model.md: `{ "command": [...], "providerConfig": {} }`, with `providerConfig` left opaque/pass-through
- [ ] T004 [P] Document how to enable the Local REST API plugin's built-in MCP server (`/mcp/`, v5.0+) and where its API key lives, in `harness/README.md` (new file if none exists)

**Checkpoint**: Dependencies installed, config shape defined — no runtime behavior changed yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The bridge and plugin ACP client must exist and pass basic messages before any user
story can be built on top of them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 Implement the ACP-facing subprocess spawn in `harness/src/acp-bridge.mjs`: read `harness.config.json`, spawn `command` as a child process, and speak ACP v1 over its stdio (contracts/bridge-harness-spawn.md) — no per-harness branching logic
- [ ] T006 Implement per-device bearer-token authentication in `harness/src/acp-bridge.mjs`, reusing the existing `harness/tokens.json` format (FR-004)
- [ ] T007 Implement the HTTP/SSE transport in `harness/src/acp-bridge.mjs` exposing `session/new`, `session/prompt`, `session/update`, `session/cancel` per contracts/plugin-bridge-acp.md
- [ ] T008 [P] Implement a per-session, sequence-numbered replay buffer in `harness/src/acp-bridge.mjs` so a reconnecting device can resume from its last-seen sequence number without duplication or loss (FR-005, data-model.md Bridge Connection)
- [ ] T009 Implement the plugin-side ACP client in `plugin/src/acp/client.ts` using `@agentclientprotocol/sdk`: `session/new`, `session/prompt`, subscribing to `session/update`, and `session/cancel`
- [ ] T010 [P] [US1] Implement connectivity/availability error surfacing in `plugin/src/acp/client.ts` when the bridge or harness is unreachable, instead of an indefinite wait (FR-012)
- [ ] T011 [P] Implement reconnect handling in `plugin/src/acp/client.ts`: track the last-seen sequence number per session and request replay from the bridge on reconnect (uses T008)

**Checkpoint**: A minimal prompt sent from the plugin can reach a spawned harness and a streamed
reply can return, end to end, over the bridge. User story work can now begin.

---

## Phase 3: User Story 1 - Chat from the phone through a locally-configured harness (Priority: P1) 🎯 MVP

**Goal**: Sending a chat message from the plugin reaches the configured harness and streams back,
with working cancel and reconnect — matching current behavior with no perceptible regression.

**Independent Test**: Send a prompt from the plugin, confirm a streamed reply renders; cancel
mid-stream and confirm it stops promptly; drop and restore connectivity mid-stream and confirm no
duplicated or lost content (quickstart.md Scenario 1).

### Implementation for User Story 1

- [ ] T012 [US1] Replace the transport call in `plugin/src/chat/engine.ts` with `plugin/src/acp/client.ts`'s `session/prompt`, removing its dependency on `plugin/src/chat/gateway.ts`
- [ ] T013 [US1] Wire `session/update` streaming events into the existing rendering path in `plugin/src/ui/chat-view.ts`
- [ ] T014 [US1] Wire the existing cancel UI action in `plugin/src/ui/chat-view.ts` to `plugin/src/acp/client.ts`'s `session/cancel`
- [ ] T015 [US1] Manually validate quickstart.md Scenario 1 (core round trip, cancel, reconnect) end to end against one configured harness

**Checkpoint**: User Story 1 is fully functional and independently testable — core chat works
end-to-end over ACP.

---

## Phase 4: User Story 2 - Swap the underlying harness without touching the plugin (Priority: P1)

**Goal**: An operator can change the configured harness or model provider on the host alone, with
zero plugin or bridge code changes, and chat keeps working.

**Independent Test**: Point `harness.config.json` at a different supported harness (or change only
`providerConfig`), restart host-side processes only, and confirm chat still works from the plugin
(quickstart.md Scenario 2).

### Implementation for User Story 2

- [ ] T016 [US2] Add config validation and a clear startup error in `harness/src/acp-bridge.mjs` when `harness.config.json`'s `command` is missing or fails to spawn (still generic — no per-harness special-casing)
- [ ] T017 [US2] Document the exact `command` value for each of the four supported harnesses (opencode, Claude Code, Gemini CLI, Goose) in `harness/README.md`, confirming each is invoked identically through the same bridge code path
- [ ] T018 [US2] Manually validate quickstart.md Scenario 2 by switching between at least two of the four supported harnesses and confirming no plugin or bridge code changed

**Checkpoint**: User Stories 1 and 2 both work independently — chat works, and harness/provider
identity is proven to be config-only.

---

## Phase 5: User Story 3 - Vault-grounded conversations keep working (Priority: P2)

**Goal**: `@mention` and vault-search-driven grounding keep working, routed through MCP instead of
plugin-local retrieval or custom harness tool code, with exclusions still enforced.

**Independent Test**: `@mention` a note and confirm its content is used; ask a question requiring
vault search and confirm the right note is found via an MCP tool call; confirm a blacklisted /
`.chat/rules.md`-denied path is never surfaced (quickstart.md Scenario 3).

### Implementation for User Story 3

- [ ] T019 [US3] Implement `harness/src/mcp-rules-proxy.mjs` as a pass-through MCP server in front of LRA's `/mcp/` endpoint (contracts/harness-mcp-vault.md) — forwards every tool call and response unmodified by default
- [ ] T020 [US3] Port the existing folder-blacklist configuration read into `harness/src/mcp-rules-proxy.mjs`
- [ ] T021 [US3] Port the existing nearest-wins `.chat/rules.md` resolution logic into `harness/src/mcp-rules-proxy.mjs`
- [ ] T022 [US3] Reject MCP tool calls whose target path is blacklisted or denied by `.chat/rules.md` in `harness/src/mcp-rules-proxy.mjs`, returning an MCP-level error instead of forwarding to LRA (FR-008)
- [ ] T023 [P] [US3] Document pointing the configured harness's MCP client at `mcp-rules-proxy.mjs`'s endpoint (not LRA directly) in `harness/README.md`
- [ ] T024 [US3] Ensure `@mention`-selected note content is still attached to the outgoing ACP prompt in `plugin/src/chat/ground.ts`, independent of MCP (mentions remain a plugin-side, explicit-inclusion mechanism per research.md R7 framing)
- [ ] T025 [US3] Retire the plugin-local automatic grounding path in `plugin/src/retrieval/cascade.ts` / `plugin/src/retrieval/index.ts` as used from `plugin/src/ui/chat-view.ts` and `plugin/src/tools/runner.ts` for "auto mode" — grounding now happens via the harness's MCP `search_vault` calls, not plugin-local BM25; keep `VaultIndex` only if still needed for `@mention` autocomplete suggestions in `plugin/src/ui/mention.ts`
- [ ] T026 [US3] Manually validate quickstart.md Scenario 3, including the excluded-path denial case

**Checkpoint**: User Stories 1–3 all work independently — vault grounding is standards-based and
exclusions are enforced.

---

## Phase 6: User Story 4 - Approval-gated actions on the vault still protect the user (Priority: P2)

**Goal**: Auto/Review/Plan approval modes keep gating vault writes correctly, now driven by ACP
permission-request events instead of the old custom protocol, and survive reconnects.

**Independent Test**: For each approval mode, ask the assistant to write to the vault and confirm
the plugin's behavior (apply / prompt-then-apply / plan-only) matches the mode, including across a
backgrounding/reconnect cycle while a prompt is pending (quickstart.md Scenario 4).

### Implementation for User Story 4

- [ ] T027 [US4] Map incoming ACP tool-call permission-request events to the Approval Request model (data-model.md) in `plugin/src/acp/client.ts` (research.md R6)
- [ ] T028 [US4] Update `plugin/src/ui/approval.ts` to render prompts sourced from ACP permission-request events (including the proposed diff) instead of the old custom `/jobs`-based approval data
- [ ] T029 [US4] Implement Auto/Review/Plan handling against ACP permission requests in `plugin/src/acp/client.ts`: Auto auto-responds for previously-allowed scope, Review always waits for the user, Plan surfaces the proposal and never lets the underlying write execute
- [ ] T030 [US4] Ensure a pending Approval Request's `decisionState` (data-model.md) survives a dropped/reconnected `plugin/src/acp/client.ts` connection, reusing the replay/reconnect handling from T008/T011
- [ ] T031 [US4] Manually validate quickstart.md Scenario 4 for all three approval modes, including the backgrounding/reconnect case

**Checkpoint**: User Stories 1–4 all work independently — writes remain safely gated.

---

## Phase 7: User Story 5 - Sessions remain visible and organized as vault notes (Priority: P3)

**Goal**: Each conversation continues to be persisted as a note in the configured sessions folder,
now driven by ACP session lifecycle events.

**Independent Test**: Complete a chat exchange and confirm a session note is created/updated;
reopen it and confirm the conversation can be resumed with prior context (quickstart.md Scenario 5).

### Implementation for User Story 5

- [ ] T032 [US5] Update `plugin/src/session/store.ts` to observe ACP session lifecycle events (`session/new`, `session/update`, session end) from `plugin/src/acp/client.ts` instead of the old custom protocol's events
- [ ] T033 [US5] Confirm session note create/update in `plugin/src/session/store.ts` still writes through the existing LRA-backed vault write path, unchanged by this migration
- [ ] T034 [US5] Manually validate quickstart.md Scenario 5 (session note created/updated, conversation resumable)

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Cutover & Polish

**Purpose**: Remove the superseded custom stack now that standards-based replacements are verified
(Constitution Principle IV, FR-011), and confirm nothing regressed.

- [ ] T035 Delete `harness/src/gateway.mjs`, `harness/src/relay-worker.mjs`, `harness/src/lra-tools.mjs`, and `harness/src/echo-worker.mjs`
- [ ] T036 [P] Delete `plugin/src/chat/gateway.ts` and any tool-execution code in `plugin/src/tools/runner.ts` / `plugin/src/tools/contract.ts` fully superseded by MCP tool calls (keep only what's still needed for plugin-local UI concerns, if anything)
- [ ] T037 [P] Remove now-unused `/jobs`-related routes, scripts, and references in `package.json` and `harness/package.json` (e.g. the `gateway` npm script)
- [ ] T038 [P] Update `PLAN.md` / `README.md` to describe the ACP/MCP architecture in place of the removed custom-stack description
- [ ] T039 Run `tsc --noEmit` across `plugin/` and `harness/` and fix any type errors introduced by the removals
- [ ] T040 Manually validate quickstart.md Scenario 6 (grep the repo for `gateway.mjs`, `agent-worker`, `relay-worker.mjs`, `lra-tools.mjs`, `retrieve.mjs`, `rules.mjs`, `/jobs` and confirm no remaining references in active source)

**Checkpoint**: SC-005 and SC-006 satisfied — old stack is gone, all prior UX capabilities verified present.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories (T005–T011 must exist
  before any story's tasks can run against a real bridge/client).
- **User Stories (Phases 3–7)**: All depend on Foundational completion.
  - US1 and US2 (both P1) have no dependency on each other but US2's validation (T018) is easiest
    once US1 (T012–T015) is working, since it reuses the same round trip.
  - US3, US4, US5 each build on US1's working chat loop but are independently testable once it
    exists — they do not depend on each other.
- **Cutover & Polish (Phase 8)**: Depends on all five user stories being verified working, since
  deletion (T035–T037) removes the code paths they replace.

### Within Each User Story

- Bridge/proxy-side tasks generally precede plugin-side wiring that consumes them (e.g. T019–T022
  before T023; T027 before T028–T029).
- Each story ends with a manual quickstart.md validation task.

### Parallel Opportunities

- T002, T003, T004 (Setup) can run in parallel.
- T008, T010, T011 (Foundational) touch different concerns and can run in parallel once T005–T007
  land.
- Once Foundational is done, US1 and US2 can be staffed in parallel; US3, US4, US5 can each start
  in parallel as soon as US1's round trip (T012–T014) is in place, since they touch different files.
- T036, T037, T038 (Cutover) can run in parallel.

---

## Parallel Example: Foundational Phase

```bash
# After T005-T007 land, run these together:
Task: "Implement per-session replay buffer in harness/src/acp-bridge.mjs"
Task: "Implement connectivity error surfacing in plugin/src/acp/client.ts"
Task: "Implement reconnect handling in plugin/src/acp/client.ts"
```

## Parallel Example: Cutover Phase

```bash
Task: "Delete plugin/src/chat/gateway.ts and superseded tool-execution code"
Task: "Remove /jobs-related routes/scripts from package.json and harness/package.json"
Task: "Update PLAN.md/README.md to describe the ACP/MCP architecture"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (blocks everything)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run quickstart.md Scenario 1 independently
5. This is the minimum needed to prove the ACP seam works at all before investing in US2–US5

### Incremental Delivery

1. Setup + Foundational → bridge and ACP client exist
2. US1 → core chat works (MVP)
3. US2 → prove harness/provider agnosticism
4. US3 → vault grounding via MCP, exclusions enforced
5. US4 → approval safety preserved
6. US5 → sessions-as-notes preserved
7. Cutover & Polish → delete the old stack, confirm nothing regressed

Each story adds value without breaking the previous ones; the old custom stack is only removed at
the very end, once every capability it provided has a verified replacement.

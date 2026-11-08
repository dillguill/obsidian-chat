---
description: "Task list for ACP Shell (specs/004-acp-shell)"
---

# Tasks: ACP Shell

**Input**: Design documents from `/specs/004-acp-shell/`

**Prerequisites**: plan.md (approved), spec.md (approved), research.md, data-model.md, contracts/,
quickstart.md, constitution v2.0.0 (ratified 2026-11-07)

**Tests**: Included. The plan's gates require automated suites for every story; tests are listed first
in each story phase and must fail before implementation (TDD). Test files use the repo convention
`node --test 'src/**/*.test.ts'` with Node type stripping; shared fixtures live under
`plugin/test/fixtures/`.

**Organization**: Tasks are grouped by user story. Delivery order follows the plan's risk sequence
across phases: US1 (P1 shell) → US2 (P2 vault + P3 MCP tools) → US3 (P3 listener) → US4 (approvals)
→ US5 (controls) → US6 (P5 renderer/UI) → US7 (P4 continuity) → US8 (P6 remote reliability) → US9
(P6 import/deletion). Story priority still drives scope: US1 alone is the desktop MVP. The plan's
P1–P6 gates do **not** run in numeric order in this file (P5/T087 precedes P4/T097); the explicit
gate map is in the Notes section at the end.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: the user story (US1…US9); setup/foundational/polish tasks have no story label
- Every task names an exact file path

## Path Conventions

- Single project: `plugin/src/`, `plugin/test/`
- ACP/shared logic: `plugin/src/acp/`, `plugin/src/shell/`
- Vault/Native: `plugin/src/vault/`
- Session record/continuity: `plugin/src/session/`
- UI: `plugin/src/ui/`
- Entry/settings: `plugin/src/main.ts`, `plugin/src/settings.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, toolchain, module skeleton, and the test doubles every story relies on.

- [X] T001 Add `ws@^8.18.0` + `@types/ws@^8.5.13` to `plugin/package.json`, remove the stale `extraneous` `harness` stanza from `package-lock.json`, and run `npm install`
- [X] T002 [P] Change `moduleResolution` to `"bundler"` in `plugin/tsconfig.json` (ACP SDK `experimental/*` export-map imports)
- [X] T003 [P] Update `plugin/esbuild.config.mjs`: bundle `ws`, externalize `bufferutil`/`utf-8-validate`, keep `obsidian`/`electron`/Node built-ins external
- [X] T004 [P] Create the module skeleton per plan: `plugin/src/{shell,acp,vault,session}/`, `plugin/test/fixtures/`, and placeholder files; no behavior yet
- [X] T005 [P] Make the test glob cross-platform (`node --test "src/**/*.test.ts"`) in `plugin/package.json` and add `plugin/test/fixtures/` to the repo layout
- [X] T006 [P] Implement the in-process mock ACP agent fixture in `plugin/test/fixtures/mock-agent.ts` (SDK `agent()` app: initialize, session/new|resume|load, prompt, cancel, permission, scripted updates incl. an unknown kind)
- [X] T007 [P] Implement the mock harness child in `plugin/test/fixtures/mock-harness.ts` over `ndJsonStream`, with flags for normal/cancel/late-update/crash scenarios
- [X] T008 [P] Implement the fake `VaultService` + `DataAdapter`-shaped store fixture in `plugin/test/fixtures/fake-vault.ts` (read/write/exists/list/append + metadata stubs)
- [X] T009 [P] Add the conformance check script `plugin/scripts/check-conformance.mjs` for the plan's greps (no `turn_end`/`EventSource`/SSE, no name dictionary, no duplicate listeners/policy, no provider branches) and wire it as an npm script (FR-042/FR-043…FR-070)
- [X] T010 [P] Add a temp-directory store test helper in `plugin/test/fixtures/temp-store.ts` (append/truncate/corrupt-line helpers)

**Checkpoint**: toolchain and test doubles ready; no product behavior yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared models, vault service, store, transports, and listener scaffolding. No story can
be tested end-to-end until this phase completes.

**⚠️ CRITICAL**: No user-story implementation tasks may begin until this phase is complete.

- [X] T011 Implement the transport-agnostic client seam and render-model types in `plugin/src/acp/types.ts` (FR-043/FR-045/FR-049)
- [X] T012 [P] Implement the total `session/update` → render-model mapper in `plugin/src/acp/session-update.ts`; unknown kinds map to a generic raw entry; no name dictionary (FR-043/FR-045/FR-049)
- [X] T013 [P] Implement the permission option model in `plugin/src/acp/permissions.ts` (offered options verbatim; selected/cancelled outcomes; no invented options) (FR-034/FR-037)
- [X] T014 [P] Implement declared control normalization in `plugin/src/acp/controls.ts` (modes, every config option by declared name/type, commands) (FR-039/FR-040/FR-041)
- [X] T015 [P] Implement pure path policy in `plugin/src/vault/path-policy.ts` (absolute/relative/`..`/NUL, blacklist, `.obsidian/`, store folder, `.trash/`; verdict reasons) (FR-021/FR-022)
- [X] T016 [P] Write the path-policy matrix test in `plugin/src/vault/path-policy.test.ts` (FR-021/SC-004)
- [X] T017 Implement the shared `VaultService` interface and Obsidian-backed implementation in `plugin/src/vault/service.ts` (read incl. open-editor text, write/parents/editor refresh, path policy, metadata surface) (FR-018…FR-024)
- [X] T018 [P] Implement scored search in `plugin/src/vault/search.ts` (small BM25 over the existing document cache; no new dependency) (FR-027)
- [X] T019 [P] Implement metadata queries in `plugin/src/vault/metadata.ts` (backlinks via `resolvedLinks` inversion, links, tags, headings, note metadata) (FR-027)
- [X] T020 Implement the record/entry types and validation in `plugin/src/session/record.ts` (header + `prompt`/`update`/`permission_request`/`permission_response`/`turn`/`resume`/`meta`/`error`; no `turn_end`) (FR-053/FR-055)
- [X] T021 [P] Implement the append-only JSONL store in `plugin/src/session/store.ts` (adapter append, sequence, degraded-tail repair, header scan) (FR-053/FR-057)
- [X] T022 [P] Write the store round-trip/crash/sequence tests in `plugin/src/session/store.test.ts` (FR-057/SC-013)
- [X] T023 Implement attach config/connection state types in `plugin/src/shell/types.ts`
- [X] T024 [P] Implement the transport interface/factory in `plugin/src/shell/transport.ts`
- [X] T025 [P] Implement the local stdio transport in `plugin/src/shell/local-transport.ts` (`ndJsonStream`, desktop lazy require, spawn/respawn/backoff, stderr tail) (FR-001/FR-003)
- [X] T026 Implement the shell ACP client core in `plugin/src/shell/acp-client.ts` (initialize explicit + capability cache, session/new|resume|load, prompt turn boundary, cancel, permission parking, fs handler registration) (FR-007…FR-015/FR-018…FR-025)
- [X] T027 [P] Implement device credentials/pairing/revocation helpers in `plugin/src/shell/device-auth.ts` (constant-time compare, never log) (FR-009/FR-010/FR-016/FR-017)
- [X] T028 [P] Implement the single-listener host skeleton in `plugin/src/shell/host-server.ts` (`http.createServer`, `/acp` upgrade, `/mcp` route, 404 elsewhere, bind default loopback) (FR-006/FR-008)
- [X] T029 [P] Implement the per-device relay agent factory skeleton in `plugin/src/shell/host-relay.ts` (SDK `agent()` + `AcpServer.prepareWebSocketUpgrade`, no behavior beyond initialize/session mapping yet) (FR-005/FR-008)
- [X] T030 Implement the shell settings block and plugin lifecycle skeleton in `plugin/src/settings.ts` and `plugin/src/main.ts` (host enable/command/port/interface, paired devices, store folder, blacklist; start/stop host; own the client and store) (FR-004/FR-006/FR-037/FR-056)

**Checkpoint**: foundation ready — the shared seams, store, vault service, transports, and listener
exist; stories can now be built and tested.

---

## Phase 3: User Story 1 — Host owns the harness and chats locally (Priority: P1) 🎯 MVP

**Goal**: A desktop user completes one real local turn against a spawned harness, with honest cancel,
crash, and missing-command outcomes, and the turn is written to the host-owned record.

**Independent Test**: Enable host with the mock harness command, send a prompt, confirm exactly one
child, initialize/session-new, streamed reply, one record with prompt + updates + `turn`; then repeat
with cancel, kill, and a bad command.

### Tests for User Story 1

- [X] T031 [P] [US1] In-process mock-agent one-turn test (initialize → session/new → prompt → updates → `turn`) in `plugin/src/shell/acp-client.test.ts`
- [X] T032 [P] [US1] Child-spawn smoke + crash-mid-turn + bad-command tests in `plugin/src/shell/local-transport.test.ts`
- [X] T033 [P] [US1] Cancel-resolves-cancelled and in-flight-turn-survives-view-close tests in `plugin/src/shell/acp-client.test.ts`

### Implementation for User Story 1

- [X] T034 [US1] Finish `plugin/src/shell/local-transport.ts`: quote-aware `splitCommand`, cwd from `FileSystemAdapter.getBasePath()`, Windows `.cmd` exception, bounded respawn, deliberate-stop no-respawn (FR-001/FR-002/FR-003)
- [X] T035 [US1] Finish `plugin/src/shell/acp-client.ts` connect/initialize/session-new/prompt/cancel and the late-update attribution window (`late`, `_meta`; constants 2,000/250/5,000 ms) (FR-007…FR-015)
- [X] T036 [US1] Wire record creation and turn-boundary appends in `plugin/src/session/store.ts` from the client lifecycle; never a synthetic `turn_end` (FR-010/FR-053)
- [X] T037 [US1] Wire host start/stop, harness command/port, and crash state in `plugin/src/main.ts` and `plugin/src/settings.ts` (FR-003/FR-007)
- [X] T038 [US1] Add the minimal shell send/stream/cancel path in `plugin/src/ui/shell-view.ts` (transcript + composer; no tool vocabulary yet) (FR-053/FR-073) — **retargeted during realignment**: the shell UI is `shell-view.ts`, not a rebuild of legacy `chat-view.ts`
- [X] T039 [US1] Add the attach/health indicator and configuration-error surface in `plugin/src/ui/shell-view.ts` and `plugin/src/shell/runtime.ts` (FR-071); the connection-details rebuild stays with T085 (`connection-info.ts` is retained, not deleted)
- [X] T040 [US1] Run the plan P1 gate: typecheck, production build, `npm test`, and the conformance greps; record results in the PR/branch notes

**Checkpoint**: local one-turn MVP works against the mock and the child; cancel/crash/bad-command are honest.

---

## Phase 4: User Story 2 — Native vault access and read-only Obsidian tools (Priority: P1)

**Goal**: The harness reads/writes notes through ACP fs under the shared policy, and can search the
vault, follow backlinks, and inspect metadata through the read-only MCP server.

**Independent Test**: A mock harness reads an existing note, writes a new nested note, attempts an
escape/blacklisted/`.obsidian/` path, then calls each MCP tool; expected content/results and refusals
with zero unsafe I/O.

### Tests for User Story 2

- [X] T041 [P] [US2] ACP fs read/write/parents/editor-refresh/snapshot tests in `plugin/src/vault/acp-fs.test.ts` (FR-018…FR-021)
- [X] T042 [P] [US2] MCP six-tool + read-only + loopback/token + `mcpCapabilities.http`-off tests in `plugin/src/vault/mcp-server.test.ts` (FR-026…FR-033)
- [X] T043 [P] [US2] Shared-policy equivalence test: same path verdicts from ACP fs and MCP tools in `plugin/src/vault/path-policy.test.ts` (FR-023/FR-029)

### Implementation for User Story 2

- [X] T044 [US2] Implement `fs/read_text_file` and `fs/write_text_file` handlers in `plugin/src/vault/acp-fs.ts` over `VaultService` (FR-018/FR-019)
- [X] T045 [US2] Implement the best-effort pre-write snapshot and host-side undo surface in `plugin/src/vault/service.ts` and `plugin/src/ui/approval.ts` (FR-021/FR-022)
- [X] T046 [US2] Finish editor refresh and metadata invalidation in `plugin/src/vault/service.ts` (`Editor.refresh()`, `MarkdownPreviewView.rerender(true)`; never `setValue`) (FR-019)
- [X] T047 [US2] Implement the six read-only MCP tools in `plugin/src/vault/mcp-server.ts` (search/backlinks/links/tags/outline/metadata; annotations; bounds; error codes) (FR-026…FR-033)
- [X] T048 [US2] Mount the MCP endpoint on the host listener and pass the per-session token/entry in `plugin/src/shell/host-server.ts` and `plugin/src/shell/acp-client.ts` (FR-026/FR-031)
- [X] T049 [US2] Gate the MCP entry on `agentCapabilities.mcpCapabilities.http`; when false send `mcpServers: []` and surface tools-unavailable (FR-026/FR-031)
- [X] T050 [US2] Implement the generic permission card (one action per offered option; no approve/reject invention) in `plugin/src/ui/approval.ts` and wire parking in `plugin/src/shell/acp-client.ts` (FR-034…FR-038)
- [X] T051 [US2] Remove the persistent tool allowlist and any shell-side permission policy from `plugin/src/settings.ts` and the legacy chat view; rely only on harness-offered always-allow options (FR-037)
- [X] T052 [US2] Run the plan P2 gate over `plugin/src/vault/` and `plugin/src/shell/`: fs/policy/MCP suites, zero unsafe I/O, shared-service proof

**Checkpoint**: US1 + US2 deliver the desktop shell with native vault read/write and read-only search/backlinks.

---

## Phase 5: User Story 3 — Remote device attaches to the host over the VPN (Priority: P1)

**Goal**: A paired device attaches over ACP/WebSocket to the host, browses the host's stored sessions,
completes a turn, and cancels; it spawns nothing, serves no vault, and keeps no local history.

**Independent Test**: Start the host with a mock harness, attach a fake device over `ws://` on an
ephemeral port, complete a turn, list/load a stored session, cancel; then close the host and confirm
unreachable/no fallback.

### Tests for User Story 3

- [X] T053 [P] [US3] Host-listener auth-before-upgrade + one-turn WS integration test in `plugin/src/shell/host-server.test.ts` (FR-008…FR-014)
- [X] T054 [P] [US3] Remote client attach/session-list/load/reconnect-basic tests in `plugin/src/shell/remote-transport.test.ts` (FR-009…FR-015)
- [X] T055 [US3] Local-host UI attach-over-loopback test in `plugin/src/shell/host-server.test.ts` (FR-005/FR-012)

### Implementation for User Story 3

- [X] T056 [US3] Finish the WebSocket server in `plugin/src/shell/host-server.ts` (`ws` noServer + upgrade, maxPayload 8 MiB, heartbeat, token before upgrade) (FR-008/FR-009)
- [X] T057 [US3] Implement the per-device relay in `plugin/src/shell/host-relay.ts` (bridge in `plugin/src/shell/host-bridge.ts`): initialize capabilities, session/new mapping, prompt/update forwarding, cancel, mode/config forward (FR-011/FR-014)
- [X] T058 [US3] Implement standard `session/list` from the record and `session/load` replay with `_meta` seq/`sinceSeq` in `plugin/src/shell/host-bridge.ts` and `plugin/src/session/store.ts` (FR-011/FR-014)
- [X] T059 [US3] Implement the remote transport client in `plugin/src/shell/remote-transport.ts` (`createWebSocketStream`, token query, no spawn/listener) (FR-009/FR-012)
- [X] T060 [US3] Route the host's own chat view through the loopback WebSocket with a per-run local token in `plugin/src/shell/host-core.ts`, `plugin/src/shell/runtime.ts`, and `plugin/src/main.ts` (FR-005/FR-008)
- [X] T061 [US3] Wire the remote chat view + store-backed session list in `plugin/src/ui/shell-view.ts`, `plugin/src/ui/session-list.ts`, and `plugin/src/main.ts` (FR-011/FR-051)
- [X] T062 [US3] Surface unreachable/auth/config states and no-fallback behavior in `plugin/src/ui/connection-info.ts` and `plugin/src/ui/shell-view.ts` (FR-015/FR-016)
- [X] T063 [US3] Run the plan P3 gate using `plugin/src/shell/host-server.test.ts`: one listener/two endpoints, auth-before-upgrade, remote one-turn, no remote process/listener/store — **automated P3 gate passed** (tsc, 90 tests, conformance, production build); the real-harness manual check stays in T118

**Checkpoint**: remote attach works over the VPN model; host history is browsable/resumable.

---

## Phase 6: User Story 4 — Approvals stay inline and owner-routed (Priority: P2)

**Goal**: Permission requests render from the real tool call, offer exactly the harness's options,
route only to the owning device, and resolve cancelled on teardown/disconnect — never auto-approved.

**Independent Test**: Trigger a permission on device A while B is connected; A sees the card, B does
not; answer on A; kill the connection and confirm cancelled + visible explanation.

### Tests for User Story 4

- [X] T064 [P] [US4] Owner-only routing + second-device denial tests in `plugin/src/shell/host-relay.test.ts` (FR-035) — covers relay device binding and the real `HostBridge` routing: only the owning device sees the request; other devices cannot prompt/load/list that session
- [X] T065 [P] [US4] Cancel/teardown/disconnect/timeout → cancelled tests in `plugin/src/shell/acp-client.test.ts` and `plugin/src/ui/approval.test.ts` (FR-034/FR-036) — the mock agent records the exact response; cancel/loss/timeout all resolve `{ outcome: "cancelled" }` and never an approval
- [X] T066 [US4] One-action-per-offered-option and exact optionId response tests in `plugin/src/ui/approval.test.ts` (FR-034) — pure card model: verbatim title, every content variant, locations, options unchanged and in order; empty options produce no invented actions

### Implementation for User Story 4

- [X] T067 [US4] Implement permission parking/routing per owning device in `plugin/src/shell/host-bridge.ts` and `plugin/src/shell/acp-client.ts`; cancel all parked on teardown/loss (FR-035/FR-036) — including the 10-minute operational approval timeout (cancelled, never approved) and device-unbind cancellation
- [X] T068 [US4] Render the real tool call + all offered options in `plugin/src/ui/approval.ts`; return the selected optionId verbatim (FR-034) — added the pure `permissionCardModel` (title/kind/status/content/locations/raw input) and clickable-by-path locations
- [X] T069 [US4] Add the visible "approvals were cancelled" transcript error on transport loss and a timeout cancellation reason in `plugin/src/ui/shell-view.ts` and `plugin/src/shell/acp-client.ts` (FR-036) — loss message names how many approvals were cancelled; timeout emits a dedicated permission error and a plain-language hint
- [X] T070 [US4] Run the plan P4-approval checks over `plugin/src/ui/approval.ts` and `plugin/src/shell/host-bridge.ts`: 0 auto-approvals (no persistent allow/deny table; grep-clean), owner-only (tests), exact offered option ids (tests), undo host-side only (documented in spec assumption #9 and `approval.ts`) — **gate passed**: tsc clean, 112 tests, conformance, production build

**Checkpoint**: approvals are safe per device and cannot be bypassed or auto-answered.

---

## Phase 7: User Story 5 — Declared controls only (Priority: P2)

**Goal**: Modes, every config option, and slash commands come from the harness; nothing is hardcoded
and switching harness stays configuration-only.

**Independent Test**: Harness A declares two modes, a select option, a boolean option, and a command;
harness B declares none. Controls match each exactly; change only the harness command and the shell
keeps working.

### Tests for User Story 5

- [X] T071 [P] [US5] Declared-control generation/forwarding tests in `plugin/src/acp/controls.test.ts` (FR-039…FR-041) — modes/every option/commands, unknown categories preserved, live updates reflected; forwarding shapes asserted in `acp-client.test.ts`
- [X] T072 [P] [US5] Render-empty-when-none and unknown-category-option tests in `plugin/src/ui/controls.test.ts` (FR-040) — empty declarations render nothing; unknown category is an ordinary working control; long lists use the picker; no fixed trio

### Implementation for User Story 5

- [X] T073 [US5] Finish `plugin/src/acp/controls.ts` normalization (modes + every option by name/type + commands; live updates) (FR-039) — `declaredControls()` returns exactly the declaration; client state updates from mode/config/command notifications
- [X] T074 [US5] Implement the generic composer control row in `plugin/src/ui/controls.ts` and the generic long-list picker in `plugin/src/ui/acp-select-suggest.ts`; the shell view renders no fixed model/thinking/agent controls (FR-040/FR-052). Legacy chat-view controls disappear with the view in T121. — wired into `shell-view.ts`; empty row when nothing is declared; commands insert their declared slash command
- [X] T075 [US5] Forward mode/config selections unchanged (tagged boolean/select shapes) and reapply per-session last values after resume in `plugin/src/shell/acp-client.ts` and `plugin/src/session/resume.ts` (FR-041/FR-065) — forwarding tested verbatim; `reapplyControls()` resends only last selected declared values and is used by the reconnect path (the US7 resume ladder will call the same helper)
- [X] T076 [US5] Remove `acpConfigOverrides`/fixed-control settings and the migration shim from `plugin/src/settings.ts` and `plugin/src/main.ts` (FR-040); delete `plugin/src/chat/model-prefs.ts` with the legacy view in T121 once the settings fields are gone — settings fields + Models UI + migration shim removed now; deleted `chat/model-prefs.ts`, `ui/acp-model-suggest.ts`, `ui/acp-picker-menu.ts`, and stripped the legacy toolbar's model/thinking/agent code
- [X] T077 [US5] Run the plan P5-controls checks over `plugin/src/acp/controls.ts` and `plugin/src/ui/controls.ts`: 100% declared controls, 0 fixed troika, swap via command only — **gate passed**: 114 tests, tsc clean, conformance pass, production build 1,398,088 bytes; no fixed control labels/categories in the new shell; provider/harness branching absent (command is the only harness input)

**Checkpoint**: the composer is a projection of the harness declaration, nothing more.

---

## Phase 8: User Story 6 — Faithful ACP renderer (Priority: P2)

**Goal**: Every update is visible in arrival order; tool cards come from ACP fields; unknown kinds and
per-turn raw records are always available; grouping is opt-in.

**Independent Test**: A mock harness emits every update kind plus one unknown, a multi-variant tool
call, locations, raw input/output; confirm all render in order, the card uses title/kind/status, and
the raw disclosure lists them.

### Tests for User Story 6

- [X] T078 [P] [US6] Renderer coverage: tool title/name/kind/status/content variants/locations/raw + unknown kinds in `plugin/src/ui/renderer.test.ts` (FR-043…FR-049) — all 8 content variants, title/name/kind fallback, late/duration, bounded raw; fixed-enum-only icons
- [X] T079 [P] [US6] Raw-view paging/bounds + per-turn disclosure tests in `plugin/src/ui/raw-view.test.ts` (FR-046/FR-048/FR-050) — page clamping, 16 KiB truncation marker, exact per-turn filtering, unknown kinds representable
- [X] T080 [P] [US6] Chronological-default/density-opt-in test in `plugin/src/ui/shell-view.test.ts` (FR-047) — chronological/expanded default; grouping only when explicitly chosen

### Implementation for User Story 6

- [X] T081 [US6] Implement the generic tool card and content-variant rendering in `plugin/src/ui/renderer.ts` (FR-044/FR-045) — one card per toolCallId, title verbatim, text/diff/terminal/image/audio/resource-link/resource/unknown
- [X] T082 [US6] Implement locations (clickable when resolvable) + lazy bounded raw input/output Details (16 KiB) in `plugin/src/ui/renderer.ts` and `plugin/src/ui/raw-bounds.ts` (FR-046)
- [X] T083 [US6] Implement generic unknown/experimental update rows and the per-turn "ACP updates" disclosure in `plugin/src/ui/renderer.ts` and `plugin/src/ui/raw-view.ts` (FR-043/FR-048) — raw notifications are collected on every event (including control kinds) and disclosed per turn; unknown kinds are never dropped
- [X] T084 [US6] Rebuild the transcript as chronological/expanded with an `activityDensity` setting (grouped opt-in) in `plugin/src/ui/shell-view.ts` and `plugin/src/settings.ts` (FR-047) — shell transcript rebuilt on the generic renderer; grouping is a collapsed opt-in group
- [X] T085 [US6] Add the session-wide raw record view to connection details in `plugin/src/ui/connection-info.ts` and `plugin/src/ui/raw-view.ts` (FR-048) — paged raw-record modal from connection info, local-only
- [X] T086 [US6] Extract the pure formatting helpers into `plugin/src/ui/format.ts` and inventory the legacy-helper deletions (activity/tool-input/types/session-suggest/acp-model-suggest/record-suggest/model-prefs); do not delete helpers still imported by the legacy view before T121 (FR-070) — `format.ts` extracted; activity/record-suggest/session-suggest/model-prefs/acp-model-suggest/acp-picker-menu deleted with T121; `chat/tool-input.ts` + `chat/types.ts` remain only for the legacy transport deleted in T110

- [X] T120 [US6] Port existing UX parity into the shell view: @mention index over `VaultService` search, current-note context, context chips, store-backed conversation list entry point, activity presentation, composer attachments/pickers, mobile layout, and the advisory vault-rules context (FR-051/FR-072/FR-073). *Added in the 2026-11-07 realignment; depends on T081/T084.* — mention/note/selection context chips, image attachments, store-backed History, grouped/chronological activity, mobile class + send behavior, advisory vault-rules injection; real-device parity pass remains in T118
- [X] T121 [US6] Retire the legacy chat view and UI-only helpers once T120 parity is green: delete `plugin/src/ui/chat-view.ts`, `plugin/src/ui/activity.ts`, `plugin/src/ui/record-suggest.ts`, `plugin/src/ui/session-suggest.ts`, `plugin/src/ui/acp-model-suggest.ts`, `plugin/src/chat/model-prefs.ts`, and `plugin/src/retrieval/index.ts`, plus any composer picker (`acp-picker-menu.ts`/`image-picker.ts`) that T120 replaced; remove `VaultIndex` from `plugin/src/main.ts`; switch the ribbon/commands to the shell view (FR-070/FR-073). Leave transport-coupled helpers (`chat/tool-input.ts`, `chat/types.ts`, `session/legacy-note.ts`) for T110. *Added in the 2026-11-07 realignment; depends on T120.* — deleted chat-view/activity/record-suggest/session-suggest/model-prefs/acp-model-suggest/acp-picker-menu/ground/retrieval-index; `mention.ts`/`image-picker.ts`/`markdown.ts`/`connection-info.ts` retained because the shell now uses them; main registers one chat surface
- [X] T122 [US6] Two views of the same session render one session-owned state (no duplicated turn, no second session), and a second prompt while a turn is in flight is rejected locally with a clear message; tests in `plugin/src/ui/shell-view.test.ts` and `plugin/src/session/recorder.test.ts` (FR-066/FR-067 + edge cases). *Added in the 2026-11-07 realignment.* — two recorders share one session-owned sequence (recorder test) and a second in-flight prompt is rejected locally (client test); two simultaneous views use the shared runtime client (manual T118)
- [X] T125 [US6] Human-facing conversation labels: a healthy/**resumable** conversation shows **no status tag**; do not leak internal single-word states (`imported`, `fresh-only`, `load-only`, `resume-capable`, `degraded`) into the session list, history, or connection details. Use plain language only for exceptions (e.g. “Old conversation — can’t reattach”, “Record repaired”) and centralize the labels in one helper so raw enums never reach the UI (FR-051/FR-071/FR-073). *Added 2026-11-07 at user request.* — `ui/labels.ts` + session-list wiring + tests; import/origin never shown as a tag
- [X] T087 [US6] Run the plan P5 UI gate from `plugin/esbuild.config.mjs` and `plugin/src/ui/renderer.test.ts`: all fixture kinds, 0 dictionaries, 0 fixed labels, one registered chat surface after T121, and measure the production bundle (the linux-arm64 esbuild binary now runs in this checkout) — **gate passed**: 131 tests, tsc clean, conformance pass, production build 1,243,630 bytes (legacy UI deletion removed ~155 KB); only the shell view is registered

**Checkpoint**: the transcript is a faithful protocol renderer, not a translation layer.

---

## Phase 9: User Story 7 — Reopening reattaches to the session (Priority: P2)

**Goal**: Reopening a conversation renders instantly from the record and reattaches via
resume → load → explicit digest/fresh; no silent new session.

**Independent Test**: Run turns, close/reopen, confirm context continues with no transcript
duplication; repeat for resume-capable, load-only, neither, fingerprint mismatch, and host restart.

### Tests for User Story 7

- [X] T088 [P] [US7] Resume-decision matrix + fingerprint refusal tests in `plugin/src/session/resume.test.ts` (FR-060/FR-063/FR-064) — resume/load/digest/fresh matrix, cwd/protocol/command refusals, whitespace-insensitive fingerprint, agent-version warning, unreachable harness, imported/no-content cases
- [X] T089 [P] [US7] Digest determinism/bounds/fixture snapshot test in `plugin/src/session/digest.test.ts` (FR-062) — byte-identical output, last 6 complete turns, 600/900-char caps, 8 tool lines, ≤30 files, ≤5 errors, 8 000-char cap, labelled content block, credential/image exclusion, full-replay cap
- [X] T090 [P] [US7] `session/load` reconciliation (no duplicate render/persist) test in `plugin/src/session/store.test.ts` (FR-061) — reattach replay is suppressed from recording; loading a stored conversation leaves the record byte-count unchanged (host-relay suite)

### Implementation for User Story 7

- [X] T091 [US7] Implement the resume ladder and registry reconciliation in `plugin/src/session/resume.ts` (resume-capable/load-only/digest-only/fresh-only; persisted `registry.json`) (FR-060/FR-063) — mandatory ladder, reasons/warnings, debounced host registry with record-wins reconciliation (drop/adopt)
- [X] T092 [US7] Implement the deterministic digest builder in `plugin/src/session/digest.ts` (6 turns; 600/900 chars; 8 tool lines; ≤30 files; ≤5 errors; 8,000-char cap; labelled ContentBlock) (FR-062) — plus bounded full-transcript replay and credential redaction
- [X] T093 [US7] Implement load-replay reconciliation in `plugin/src/session/store.ts` and `plugin/src/shell/acp-client.ts` (no re-persist; no duplicate transcript) (FR-061) — harness replay during reattach is suppressed; the host replays the record exactly once; client `attachSession` does not disturb the transcript
- [X] T094 [US7] Implement the explicit continuity choice UI (digest default / fresh / full replay) in `plugin/src/ui/shell-view.ts` and `plugin/src/ui/session-list.ts` (FR-062) — inline choice bar after opening a non-resumable conversation; no harness session is created until the user chooses; the chosen action is sent as standard prompt `_meta`
- [X] T095 [US7] Persist/reattach the host registry across reload/respawn in `plugin/src/session/resume.ts`, `plugin/src/shell/host-relay.ts`, and `plugin/src/main.ts` (FR-063) — `HostCore` owns `registry.json`, reconciles on harness attach, marks rows detached on stop/unbind; opening a stored session attempts reattach first
- [X] T096 [US7] Treat a changed agent version as a warning and command/cwd/protocol changes as a refusal in `plugin/src/session/resume.ts` (FR-064) — reasons name the mismatch; agent identity updates only warn
- [X] T097 [US7] Run the plan P4 gate over `plugin/src/session/resume.test.ts` and `plugin/src/session/digest.test.ts`: matrix, digest snapshot, load reconciliation, in-flight turn survives close — **gate passed**: 161 tests, tsc clean, conformance pass, production build 1,273,779 bytes; real-device continuity/manual check remains in T118
- [X] T123 [US7] Fault-path tests: a failed store write is surfaced without losing the live turn, and an externally deleted record disappears from the list without fabricating history (FR-057/FR-058 edge cases). *Added in the 2026-11-07 realignment.* — failing append rejects/surfaces and leaves earlier entries intact; a bridge write failure notifies the owning device; external deletion drops the conversation from the list

**Checkpoint**: conversations survive closing the app; the user is never silently given a new session.

---

## Phase 10: User Story 8 — Multiple devices, drops, reconnects (Priority: P3)

**Goal**: Concurrent paired devices stay isolated; a mid-turn VPN drop is visibly interrupted and
reconnects with replay and zero duplicate turns.

**Independent Test**: Two devices chat concurrently; drop one mid-stream; confirm interruption,
bounded reconnect, `sinceSeq` replay/dedupe, no duplicated prompt, and revocation.

### Tests for User Story 8

- [X] T098 [P] [US8] Two-device isolation + revocation tests in `plugin/src/shell/host-server.test.ts` (FR-013/FR-017) — two authenticated devices remain isolated; revoking one closes only its socket and unbinds its relay context; a removed credential is rejected with 401
- [X] T099 [P] [US8] Reconnect with `sinceSeq`/dedupe/no-duplicate-prompt tests in `plugin/src/shell/remote-transport.test.ts` and `plugin/src/shell/host-relay.test.ts` (FR-014/FR-015) — replay returns only later sequences, never resends a prompt; `SeqDedupe` renders each seq once with explicit reset for user-opened history

### Implementation for User Story 8

- [X] T100 [US8] Enforce per-device session ownership and 403/policy errors in `plugin/src/shell/host-bridge.ts` (FR-013) — prompt/load/cancel/close/mode/config all enforce ownership, including live prompts; second-device attempts fail with a policy error
- [X] T101 [US8] Implement bounded reconnect, replay buffer/full-replay fallback, and `obsidian-chat/seq` dedupe in `plugin/src/shell/remote-transport.ts` and `plugin/src/shell/host-bridge.ts` (FR-014/FR-015) — runtime reconnects 1 s → 15 s for 8 attempts using `sinceSeq`; host replay is capped at 20 000 entries with an explicit truncation notification; `SeqDedupe` suppresses replayed sequences
- [X] T102 [US8] Implement revocation closing open sockets and cancelling that device's pending approvals in `plugin/src/shell/device-auth.ts` and `plugin/src/shell/host-server.ts` (FR-017) — settings removal now closes the live socket without restart (`main.saveSettings` → runtime → host `closeDevice`); relay unbind cancels its parked approvals; next attach is rejected
- [X] T103 [US8] Run the plan P6 multi-device/reconnect checks in `plugin/src/shell/host-server.test.ts` and `plugin/src/shell/remote-transport.test.ts` (no duplicate turn, isolated sessions) — **gate passed**: 164 tests, tsc clean, conformance pass, production build 1,278,089 bytes; two-device isolation, revocation, sinceSeq replay, no duplicate prompt/turn verified

**Checkpoint**: the host is safely multi-device over an unreliable VPN.

---

## Phase 11: User Story 9 — Upgrade, import, and delete the legacy path (Priority: P3)

**Goal**: Existing settings/devices/notes survive the upgrade, old conversations are imported once,
and the legacy relay/client/note format/presentation dictionary are gone.

**Independent Test**: Start from old settings + a `chat/` folder with canonical and prose notes;
upgrade, confirm host settings/device codes preserved, every note imported with originals untouched,
and no legacy listener/module remains.

### Tests for User Story 9

- [X] T104 [P] [US9] Settings migration fixtures (host user, gateway user, fresh desktop, fresh mobile) in `plugin/src/settings.test.ts` (FR-068/FR-069) — pure `settings-model.ts` migration: host→local shell, gateway→remote shell, devices preserved, mobile defaults remote, explicit shell wins, idempotent
- [X] T105 [P] [US9] Legacy note import lossless/idempotent fixtures in `plugin/src/session/migrate.test.ts` (FR-059) — **pulled forward 2026-11-07** with T108 to restore history hidden by the early T109 store switch
- [X] T106 [P] [US9] Legacy-removal conformance test (no SSE/EventSource/`turn_end`/`AcpBridgeClient`/dictionary) in `plugin/scripts/check-conformance.mjs` (FR-070) — rewritten over the whole runtime surface: deleted modules must not exist; no forbidden identifiers/provider names; one listener, one spawn, loopback node imports only; no Markdown transcript writer; no note-folder or legacy settings

### Implementation for User Story 9

- [X] T107 [US9] Implement settings migration preserving host settings, device tokens, and blacklist; remove the gateway/note-writing **and note-folder/session-folder** settings (no folder configuration) in `plugin/src/settings.ts` (FR-068/FR-069) — settings model split into pure `settings-model.ts`; host/gateway/fixed-model/folder blocks removed from the UI; paired devices preserved; migration is idempotent and writes the clean shape
- [X] T108 [US9] Implement the legacy note import (canonical block + prose fallback; provenance; idempotent ledger) in `plugin/src/session/migrate.ts` (FR-059) — **pulled forward 2026-11-07**: vault-wide discovery by content/frontmatter (**no folder setting**), one-time scan marker, idempotent, originals untouched, skipped notes reported
- [X] T109 [US9] Switch history/UI to the store; remove chat-folder writing and the note-based resume path from the legacy chat view and `plugin/src/main.ts` (FR-054/FR-069) — **landed early** during the US1 storage fix; the legacy view is retired in T121 and no runtime Markdown transcript writer remains
- [X] T110 [US9] Delete `plugin/src/host/server.ts`, `plugin/src/host/jsonrpc.ts`, `plugin/src/host/vault-mcp.ts`, `plugin/src/acp/client.ts`, `plugin/src/session/legacy-note.ts` (after T108 import), `plugin/src/chat/tool-input.ts`, `plugin/src/chat/types.ts`, and any remaining SSE/`turn_end`/Last-Event-ID code (FR-070/FR-074). **Retain the JSONL `plugin/src/session/store.ts`** — it is the required host-owned record, not legacy. — deleted all listed modules plus `legacy-bridge.ts`, `retrieval/index.ts` and the retired legacy-UI helpers; legacy parsers moved into `session/migrate.ts`; the JSONL store is retained
- [X] T111 [US9] Update `README.md`, `docs/ARCHITECTURE.md`, `docs/ACP-SHELL.md` to the v2 architecture and record the deletions/import behavior, including that there is **no note-folder setting** and legacy notes are discovered by content (FR-070) — all three rewritten for the ACP shell (one child/one listener, JSONL store, no folder setting, continuity ladder, approvals, read-only MCP, deleted legacy); `HANDOFF.md` updated to the deploy/verify flow
- [X] T112 [US9] Run the P6 deletion/upgrade gate using `plugin/scripts/check-conformance.mjs`: single listener, one child, no legacy modules (including the retired legacy UI), import report, process/listener check — **automated gate passed**: conformance (50 runtime/22 test files), 155 tests, tsc clean, production build 1,280,073 bytes; live process/listener check remains in T118

**Checkpoint**: the branch is a clean ACP+MCP shell with no legacy path.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Hardening and final validation across stories.

- [ ] T113 [P] Run the automated checks in `specs/004-acp-shell/quickstart.md` plus `plugin/scripts/check-conformance.mjs`; fix findings
- [ ] T114 [P] Verify the mobile bundle from `plugin/esbuild.config.mjs` loads with no Node-only/host evaluation and no spawn/listener attempt
- [ ] T115 [P] Tune bounds/constants in `plugin/src/session/store.ts`, `plugin/src/ui/raw-bounds.ts`, and `plugin/src/shell/host-relay.ts` (entry 256 KiB, raw display 16 KiB, replay 20,000 entries, 50 MiB warning) and confirm tests
- [ ] T116 [P] Performance pass in `plugin/src/ui/renderer.ts` and `plugin/src/ui/shell-view.ts`: O(1) tool-card mutation, rAF text batching, lazy raw JSON, paged reopen/raw
- [ ] T117 [P] Security pass in `plugin/src/shell/device-auth.ts` and `plugin/src/session/store.ts`: constant-time tokens, redaction in logs/errors/store, loopback/token checks, no secrets in record
- [ ] T118 [P] Run the real-hardware manual scenarios S1–S11 from `specs/004-acp-shell/quickstart.md` (real harness + VPN + phone); record results
- [ ] T119 Final gate in `plugin/`: `npx tsc -noEmit -skipLibCheck`, production build, `npm test`, conformance greps all pass
- [ ] T124 [P] Edge-bounds verification: harness restart backoff, cancel resolution (`stopReason: cancelled`), approval timeout (10 min), reconnect budget (1 s → 15 s, 8 attempts per `contracts/host-transport.md`), wider-bind confirmation before non-loopback, `terminal: false`, and mobile host hidden/no-spawn (FR-003/FR-004/FR-006/FR-015). *Added in the 2026-11-07 realignment.*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup; **blocks every user story**.
- **US1 (Phase 3)**: after Foundational. No story dependency. This is the MVP.
- **US2 (Phase 4)**: after Foundational (uses US1's client/record for the end-to-end tests).
- **US3 (Phase 5)**: after US1/US2 (reuses the listener, vault service, and record).
- **US4 (Phase 6)**: after US3 (owner routing is meaningful with remote devices); the card itself also
  serves local sessions.
- **US5 (Phase 7)**: after US1 (composer exists); independent of US3/US4.
- **US6 (Phase 8)**: after US2 (tool cards need fs/permission shapes) and US1; independent of US3.
  Includes T120 (UX parity), T121 (legacy-UI retirement), T122 (two-view/fault-path).
- **US7 (Phase 9)**: after US1 + US6 (continuity UI sits in the renderer) and the record/store;
  includes T123 (store fault paths).
- **US8 (Phase 10)**: after US3 (remote transport/relay).
- **US9 (Phase 11)**: last — it deletes the code the earlier phases kept temporarily.
- **Polish (Phase 12)**: after all desired stories; includes T124 (edge bounds).

### User Story Dependencies (graph)

```text
Setup → Foundational → US1 → US2 → US3 → US4
                            ├──────────────→ US5
                            └──→ US6 → US7
US3 ──────────────────────→ US8
All stories ──────────────→ US9 (deletion) → Polish
```

US5 and US6 can run in parallel after US1/US2; US7 and US8 can run in parallel after US3/US6; T120/
T121/T122 belong to US6 and must finish before its checkpoint; T123 belongs to US7; T124 is polish.
US9 remains the final deletion phase.

### Within Each Story

Tests fail first → models/shared types → services → UI/wiring → gate. [P] tasks touch different
files and may run together.

### Parallel Opportunities

- Setup: T002–T010 in parallel after T001.
- Foundational: T012–T016, T018–T019, T021–T022, T024–T025, T027–T029 in parallel; T017/T020/T026/T030
  are the integration spine.
- Per story: all test tasks marked [P] can be written in parallel; implementation tasks marked [P]
  touch disjoint files.
- Cross-story: US5 and US6 after US1/US2; US7 and US8 after their dependencies.
- Different teammates can own disjoint modules (`shell/`, `vault/`, `session/`, `ui/`) once
  Foundational lands, subject to the plan's write scopes.

## Parallel Example: User Story 2

```text
# Tests first (parallel, different files):
T041 vault/acp-fs.test.ts
T042 vault/mcp-server.test.ts
T043 vault/path-policy.test.ts (shared-policy case)
# Independent implementation slices (parallel):
T044 vault/acp-fs.ts + T047 vault/mcp-server.ts + T049 capability gate
```

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 US1.
2. Run T040 gate; demo one local turn against a real harness.
3. Do **not** delete or rewrite legacy code yet; it stays until US9.

### Incremental delivery

1. US1: local one-turn MVP.
2. US2: native vault fs + read-only MCP search/backlinks (the product's Obsidian integration).
3. US3: remote over VPN (the user's multi-device model).
4. US4/US5/US6: approvals, declared controls, faithful renderer.
5. US7: continuity (the user's context-refill pain).
6. US8: multi-device reliability.
7. US9: import + deletion of the legacy path; polish and real-hardware validation.

### Notes

- Commit after each task or task group; keep tests green at every checkpoint.
- No code should be deleted before its replacement passes the story gate. The legacy UI is retired
  earlier (T121) only after T120 parity is green; US9 remains the final transport/note deletion phase.
- Do not reintroduce a custom envelope, name→verb dictionary, hardcoded control set, note-based
  history writer, or a second process/listener at any point.
- Gate map (explicit; in-file order is not numeric): P1 → T040; P2 → T052; P3 → T042/T043 (MCP
  suites) + T052 (shared-service proof) + T063 (listener/remote); P4 → T097; P5 → T120/T121
  (parity/retirement) + T087 (gate); P6 → T103 (multi-device/reconnect) + T112 (deletion/upgrade) +
  T118 (manual quickstart); final → T119, with edge bounds at T124.
- T125 (added 2026-11-07) is the UI-label audit: resumable conversations must be untagged; internal
  enum words never appear to the user. It lands with the US6 session-list/history work.
- The 2026-11-07 realignment added T120–T124 and retargeted the shell UI tasks from `chat-view.ts`
  to `shell-view.ts`; legacy `chat-view.ts` is now a deletion target (T121), not a rebuild target.
- Later on 2026-11-07 the note-folder setting was removed: the store is fixed hidden
  `.chat/sessions/`, and legacy notes are discovered vault-wide by content. T107/T111 record that.

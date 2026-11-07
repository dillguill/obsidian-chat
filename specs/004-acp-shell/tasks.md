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

**Organization**: Tasks are grouped by user story. Delivery order is adjusted to the plan's risk
sequence (P1 shell → P2 vault → P3 listener/MCP → P4 continuity → P5 UI → P6 remote/deletion):
US1, US2, US3, US4, US5, US6, US7, US8, US9. Story priority still drives scope: US1 alone is the
desktop MVP; US3's tasks are P1 but deliberately follow the local loop because they depend on the
host transport. The plan's P1–P6 gates are checkpoints over these phases, in the same order.

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
- [X] T009 [P] Add the conformance check script `plugin/scripts/check-conformance.mjs` for the plan's greps (no `turn_end`/`EventSource`/SSE, no name dictionary, no duplicate listeners/policy, no provider branches) and wire it as an npm script
- [X] T010 [P] Add a temp-directory store test helper in `plugin/test/fixtures/temp-store.ts` (append/truncate/corrupt-line helpers)

**Checkpoint**: toolchain and test doubles ready; no product behavior yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared models, vault service, store, transports, and listener scaffolding. No story can
be tested end-to-end until this phase completes.

**⚠️ CRITICAL**: No user-story implementation tasks may begin until this phase is complete.

- [X] T011 Implement the transport-agnostic client seam and render-model types in `plugin/src/acp/types.ts` (FR-027)
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
- [X] T030 Implement the shell settings block and plugin lifecycle skeleton in `plugin/src/settings.ts` and `plugin/src/main.ts` (host enable/command/port/interface, paired devices, store folder, blacklist; start/stop host; own the client and store) (FR-004/FR-006/FR-037)

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

- [ ] T031 [P] [US1] In-process mock-agent one-turn test (initialize → session/new → prompt → updates → `turn`) in `plugin/src/shell/acp-client.test.ts`
- [ ] T032 [P] [US1] Child-spawn smoke + crash-mid-turn + bad-command tests in `plugin/src/shell/local-transport.test.ts`
- [ ] T033 [P] [US1] Cancel-resolves-cancelled and in-flight-turn-survives-view-close tests in `plugin/src/shell/acp-client.test.ts`

### Implementation for User Story 1

- [ ] T034 [US1] Finish `plugin/src/shell/local-transport.ts`: quote-aware `splitCommand`, cwd from `FileSystemAdapter.getBasePath()`, Windows `.cmd` exception, bounded respawn, deliberate-stop no-respawn (FR-001/FR-002/FR-003)
- [ ] T035 [US1] Finish `plugin/src/shell/acp-client.ts` connect/initialize/session-new/prompt/cancel and the late-update attribution window (`late`, `_meta`; constants 2,000/250/5,000 ms) (FR-007…FR-015)
- [ ] T036 [US1] Wire record creation and turn-boundary appends in `plugin/src/session/store.ts` from the client lifecycle; never a synthetic `turn_end` (FR-010/FR-053)
- [ ] T037 [US1] Wire host start/stop, harness command/port, and crash state in `plugin/src/main.ts` and `plugin/src/settings.ts` (FR-003/FR-007)
- [ ] T038 [US1] Add the minimal chat view send/stream/cancel path in `plugin/src/ui/chat-view.ts` (transcript + composer; no tool vocabulary yet) (FR-010/FR-042)
- [ ] T039 [US1] Add the attach/health indicator and configuration-error surface in `plugin/src/ui/connection-info.ts` and `plugin/src/main.ts` (FR-040)
- [ ] T040 [US1] Run the plan P1 gate: typecheck, production build, `npm test`, and the conformance greps; record results in the PR/branch notes

**Checkpoint**: local one-turn MVP works against the mock and the child; cancel/crash/bad-command are honest.

---

## Phase 4: User Story 2 — Native vault access and read-only Obsidian tools (Priority: P1)

**Goal**: The harness reads/writes notes through ACP fs under the shared policy, and can search the
vault, follow backlinks, and inspect metadata through the read-only MCP server.

**Independent Test**: A mock harness reads an existing note, writes a new nested note, attempts an
escape/blacklisted/`.obsidian/` path, then calls each MCP tool; expected content/results and refusals
with zero unsafe I/O.

### Tests for User Story 2

- [ ] T041 [P] [US2] ACP fs read/write/parents/editor-refresh/snapshot tests in `plugin/src/vault/acp-fs.test.ts` (FR-018…FR-021)
- [ ] T042 [P] [US2] MCP six-tool + read-only + loopback/token + `mcpCapabilities.http`-off tests in `plugin/src/vault/mcp-server.test.ts` (FR-026…FR-033)
- [ ] T043 [P] [US2] Shared-policy equivalence test: same path verdicts from ACP fs and MCP tools in `plugin/src/vault/path-policy.test.ts` (FR-023/FR-029)

### Implementation for User Story 2

- [ ] T044 [US2] Implement `fs/read_text_file` and `fs/write_text_file` handlers in `plugin/src/vault/acp-fs.ts` over `VaultService` (FR-018/FR-019)
- [ ] T045 [US2] Implement the best-effort pre-write snapshot and host-side undo surface in `plugin/src/vault/service.ts` and `plugin/src/ui/approval.ts` (FR-021/FR-022)
- [ ] T046 [US2] Finish editor refresh and metadata invalidation in `plugin/src/vault/service.ts` (`Editor.refresh()`, `MarkdownPreviewView.rerender(true)`; never `setValue`) (FR-019)
- [ ] T047 [US2] Implement the six read-only MCP tools in `plugin/src/vault/mcp-server.ts` (search/backlinks/links/tags/outline/metadata; annotations; bounds; error codes) (FR-026…FR-033)
- [ ] T048 [US2] Mount the MCP endpoint on the host listener and pass the per-session token/entry in `plugin/src/shell/host-server.ts` and `plugin/src/shell/acp-client.ts` (FR-026/FR-031)
- [ ] T049 [US2] Gate the MCP entry on `agentCapabilities.mcpCapabilities.http`; when false send `mcpServers: []` and surface tools-unavailable (FR-026/FR-031)
- [ ] T050 [US2] Implement the generic permission card (one action per offered option; no approve/reject invention) in `plugin/src/ui/approval.ts` and wire parking in `plugin/src/shell/acp-client.ts` (FR-034…FR-038)
- [ ] T051 [US2] Remove the persistent tool allowlist and any shell-side permission policy from `plugin/src/settings.ts` and `plugin/src/ui/chat-view.ts`; rely only on harness-offered always-allow options (FR-037)
- [ ] T052 [US2] Run the plan P2 gate over `plugin/src/vault/` and `plugin/src/shell/`: fs/policy/MCP suites, zero unsafe I/O, shared-service proof

**Checkpoint**: US1 + US2 deliver the desktop shell with native vault read/write and read-only search/backlinks.

---

## Phase 5: User Story 3 — Remote device attaches to the host over the VPN (Priority: P1)

**Goal**: A paired device attaches over ACP/WebSocket to the host, browses the host's stored sessions,
completes a turn, and cancels; it spawns nothing, serves no vault, and keeps no local history.

**Independent Test**: Start the host with a mock harness, attach a fake device over `ws://` on an
ephemeral port, complete a turn, list/load a stored session, cancel; then close the host and confirm
unreachable/no fallback.

### Tests for User Story 3

- [ ] T053 [P] [US3] Host-listener auth-before-upgrade + one-turn WS integration test in `plugin/src/shell/host-server.test.ts` (FR-008…FR-014)
- [ ] T054 [P] [US3] Remote client attach/session-list/load/reconnect-basic tests in `plugin/src/shell/remote-transport.test.ts` (FR-009…FR-015)
- [ ] T055 [P] [US3] Local-host UI attach-over-loopback test in `plugin/src/shell/host-server.test.ts` (FR-005/FR-012)

### Implementation for User Story 3

- [ ] T056 [US3] Finish the WebSocket server in `plugin/src/shell/host-server.ts` (`ws` noServer + upgrade, maxPayload 8 MiB, heartbeat, token before upgrade) (FR-008/FR-009)
- [ ] T057 [US3] Implement the per-device relay in `plugin/src/shell/host-relay.ts`: initialize capabilities, session/new mapping, prompt/update forwarding, cancel, mode/config forward (FR-011/FR-014)
- [ ] T058 [US3] Implement standard `session/list` from the record and `session/load` replay with `_meta` seq/`sinceSeq` in `plugin/src/shell/host-relay.ts` and `plugin/src/session/store.ts` (FR-011/FR-014)
- [ ] T059 [US3] Implement the remote transport client in `plugin/src/shell/remote-transport.ts` (`createWebSocketStream`, token query, no spawn/listener) (FR-009/FR-012)
- [ ] T060 [US3] Route the host's own chat view through the loopback WebSocket with a per-run local token in `plugin/src/main.ts` and `plugin/src/shell/host-server.ts` (FR-005/FR-008)
- [ ] T061 [US3] Wire the remote chat view + store-backed session list in `plugin/src/ui/chat-view.ts`, `plugin/src/ui/session-list.ts`, and `plugin/src/main.ts` (FR-011/FR-051)
- [ ] T062 [US3] Surface unreachable/auth/config states and no-fallback behavior in `plugin/src/ui/connection-info.ts` (FR-015/FR-016)
- [ ] T063 [US3] Run the plan P3 gate using `plugin/src/shell/host-server.test.ts`: one listener/two endpoints, auth-before-upgrade, remote one-turn, no remote process/listener/store

**Checkpoint**: remote attach works over the VPN model; host history is browsable/resumable.

---

## Phase 6: User Story 4 — Approvals stay inline and owner-routed (Priority: P2)

**Goal**: Permission requests render from the real tool call, offer exactly the harness's options,
route only to the owning device, and resolve cancelled on teardown/disconnect — never auto-approved.

**Independent Test**: Trigger a permission on device A while B is connected; A sees the card, B does
not; answer on A; kill the connection and confirm cancelled + visible explanation.

### Tests for User Story 4

- [ ] T064 [P] [US4] Owner-only routing + second-device denial tests in `plugin/src/shell/host-relay.test.ts` (FR-035)
- [ ] T065 [P] [US4] Cancel/teardown/disconnect/timeout → cancelled tests in `plugin/src/shell/acp-client.test.ts` and `plugin/src/ui/approval.test.ts` (FR-034/FR-036)
- [ ] T066 [P] [US4] One-action-per-offered-option and exact optionId response tests in `plugin/src/ui/approval.test.ts` (FR-034)

### Implementation for User Story 4

- [ ] T067 [US4] Implement permission parking/routing per owning device in `plugin/src/shell/host-relay.ts` and `plugin/src/shell/acp-client.ts`; cancel all parked on teardown/loss (FR-035/FR-036)
- [ ] T068 [US4] Render the real tool call + all offered options in `plugin/src/ui/approval.ts`; return the selected optionId verbatim (FR-034)
- [ ] T069 [US4] Add the visible "approvals were cancelled" transcript error on transport loss and a timeout cancellation reason in `plugin/src/ui/chat-view.ts` and `plugin/src/shell/acp-client.ts` (FR-036)
- [ ] T070 [US4] Run the plan P4-approval checks over `plugin/src/ui/approval.ts` and `plugin/src/shell/host-relay.ts`: 0 auto-approvals, owner-only, exact options, undo host-side only (documented remote limitation)

**Checkpoint**: approvals are safe per device and cannot be bypassed or auto-answered.

---

## Phase 7: User Story 5 — Declared controls only (Priority: P2)

**Goal**: Modes, every config option, and slash commands come from the harness; nothing is hardcoded
and switching harness stays configuration-only.

**Independent Test**: Harness A declares two modes, a select option, a boolean option, and a command;
harness B declares none. Controls match each exactly; change only the harness command and the shell
keeps working.

### Tests for User Story 5

- [ ] T071 [P] [US5] Declared-control generation/forwarding tests in `plugin/src/acp/controls.test.ts` (FR-039…FR-041)
- [ ] T072 [P] [US5] Render-empty-when-none and unknown-category-option tests in `plugin/src/ui/controls.test.ts` (FR-040)

### Implementation for User Story 5

- [ ] T073 [US5] Finish `plugin/src/acp/controls.ts` normalization (modes + every option by name/type + commands; live updates) (FR-039)
- [ ] T074 [US5] Implement the generic composer control row in `plugin/src/ui/controls.ts` and the generic long-list picker in `plugin/src/ui/acp-select-suggest.ts`; remove the fixed model/thinking/agent buttons (FR-040/FR-052)
- [ ] T075 [US5] Forward mode/config selections unchanged (tagged boolean/select shapes) and reapply per-session last values after resume in `plugin/src/shell/acp-client.ts` and `plugin/src/session/resume.ts` (FR-041/FR-065)
- [ ] T076 [US5] Remove `acpConfigOverrides`/fixed-control settings from `plugin/src/settings.ts` and `plugin/src/ui/chat-view.ts` (FR-040)
- [ ] T077 [US5] Run the plan P5-controls checks over `plugin/src/acp/controls.ts` and `plugin/src/ui/controls.ts`: 100% declared controls, 0 fixed troika, swap via command only

**Checkpoint**: the composer is a projection of the harness declaration, nothing more.

---

## Phase 8: User Story 6 — Faithful ACP renderer (Priority: P2)

**Goal**: Every update is visible in arrival order; tool cards come from ACP fields; unknown kinds and
per-turn raw records are always available; grouping is opt-in.

**Independent Test**: A mock harness emits every update kind plus one unknown, a multi-variant tool
call, locations, raw input/output; confirm all render in order, the card uses title/kind/status, and
the raw disclosure lists them.

### Tests for User Story 6

- [ ] T078 [P] [US6] Renderer coverage: tool title/name/kind/status/content variants/locations/raw + unknown kinds in `plugin/src/ui/renderer.test.ts` (FR-043…FR-049)
- [ ] T079 [P] [US6] Raw-view paging/bounds + per-turn disclosure tests in `plugin/src/ui/raw-view.test.ts` (FR-046/FR-048/FR-050)
- [ ] T080 [P] [US6] Chronological-default/density-opt-in test in `plugin/src/ui/chat-view.test.ts` (FR-047)

### Implementation for User Story 6

- [ ] T081 [US6] Implement the generic tool card and content-variant rendering in `plugin/src/ui/renderer.ts` (FR-044/FR-045)
- [ ] T082 [US6] Implement locations (clickable when resolvable) + lazy bounded raw input/output Details (16 KiB) in `plugin/src/ui/renderer.ts` and `plugin/src/ui/raw-bounds.ts` (FR-046)
- [ ] T083 [US6] Implement generic unknown/experimental update rows and the per-turn "ACP updates" disclosure in `plugin/src/ui/renderer.ts` and `plugin/src/ui/raw-view.ts` (FR-043/FR-048)
- [ ] T084 [US6] Rebuild the transcript as chronological/expanded with an `activityDensity` setting (grouped opt-in) in `plugin/src/ui/chat-view.ts` and `plugin/src/settings.ts` (FR-047)
- [ ] T085 [US6] Add the session-wide raw record view to connection details in `plugin/src/ui/connection-info.ts` and `plugin/src/ui/raw-view.ts` (FR-048)
- [ ] T086 [US6] Delete `plugin/src/ui/activity.ts`, `plugin/src/chat/tool-input.ts`, `plugin/src/ui/session-suggest.ts`, `plugin/src/ui/acp-model-suggest.ts`, and the old `plugin/src/chat/types.ts`; keep only pure formatting in `plugin/src/ui/format.ts` (FR-070)
- [ ] T087 [US6] Run the plan P5 UI gate from `plugin/esbuild.config.mjs` and `plugin/src/ui/renderer.test.ts`: all fixture kinds, 0 dictionaries, 0 fixed labels, bundle measurement on a real machine (esbuild cannot run in this container)

**Checkpoint**: the transcript is a faithful protocol renderer, not a translation layer.

---

## Phase 9: User Story 7 — Reopening reattaches to the session (Priority: P2)

**Goal**: Reopening a conversation renders instantly from the record and reattaches via
resume → load → explicit digest/fresh; no silent new session.

**Independent Test**: Run turns, close/reopen, confirm context continues with no transcript
duplication; repeat for resume-capable, load-only, neither, fingerprint mismatch, and host restart.

### Tests for User Story 7

- [ ] T088 [P] [US7] Resume-decision matrix + fingerprint refusal tests in `plugin/src/session/resume.test.ts` (FR-060/FR-063/FR-064)
- [ ] T089 [P] [US7] Digest determinism/bounds/fixture snapshot test in `plugin/src/session/digest.test.ts` (FR-062)
- [ ] T090 [P] [US7] `session/load` reconciliation (no duplicate render/persist) test in `plugin/src/session/store.test.ts` (FR-061)

### Implementation for User Story 7

- [ ] T091 [US7] Implement the resume ladder and registry reconciliation in `plugin/src/session/resume.ts` (resume-capable/load-only/digest-only/fresh-only; persisted `registry.json`) (FR-060/FR-063)
- [ ] T092 [US7] Implement the deterministic digest builder in `plugin/src/session/digest.ts` (6 turns; 600/900 chars; 8 tool lines; ≤30 files; ≤5 errors; 8,000-char cap; labelled ContentBlock) (FR-062)
- [ ] T093 [US7] Implement load-replay reconciliation in `plugin/src/session/store.ts` and `plugin/src/shell/acp-client.ts` (no re-persist; no duplicate transcript) (FR-061)
- [ ] T094 [US7] Implement the explicit continuity choice UI (digest default / fresh / full replay) in `plugin/src/ui/chat-view.ts` and `plugin/src/ui/session-list.ts` (FR-062)
- [ ] T095 [US7] Persist/reattach the host registry across reload/respawn in `plugin/src/session/resume.ts`, `plugin/src/shell/host-relay.ts`, and `plugin/src/main.ts` (FR-063)
- [ ] T096 [US7] Treat a changed agent version as a warning and command/cwd/protocol changes as a refusal in `plugin/src/session/resume.ts` (FR-064)
- [ ] T097 [US7] Run the plan P4 gate over `plugin/src/session/resume.test.ts` and `plugin/src/session/digest.test.ts`: matrix, digest snapshot, load reconciliation, in-flight turn survives close

**Checkpoint**: conversations survive closing the app; the user is never silently given a new session.

---

## Phase 10: User Story 8 — Multiple devices, drops, reconnects (Priority: P3)

**Goal**: Concurrent paired devices stay isolated; a mid-turn VPN drop is visibly interrupted and
reconnects with replay and zero duplicate turns.

**Independent Test**: Two devices chat concurrently; drop one mid-stream; confirm interruption,
bounded reconnect, `sinceSeq` replay/dedupe, no duplicated prompt, and revocation.

### Tests for User Story 8

- [ ] T098 [P] [US8] Two-device isolation + revocation tests in `plugin/src/shell/host-server.test.ts` (FR-013/FR-017)
- [ ] T099 [P] [US8] Reconnect with `sinceSeq`/dedupe/no-duplicate-prompt tests in `plugin/src/shell/remote-transport.test.ts` and `plugin/src/shell/host-relay.test.ts` (FR-014/FR-015)

### Implementation for User Story 8

- [ ] T100 [US8] Enforce per-device session ownership and 403/policy errors in `plugin/src/shell/host-relay.ts` (FR-013)
- [ ] T101 [US8] Implement bounded reconnect, replay buffer/full-replay fallback, and `obsidian-chat/seq` dedupe in `plugin/src/shell/remote-transport.ts` and `plugin/src/shell/host-relay.ts` (FR-014/FR-015)
- [ ] T102 [US8] Implement revocation closing open sockets and cancelling that device's pending approvals in `plugin/src/shell/device-auth.ts` and `plugin/src/shell/host-server.ts` (FR-017)
- [ ] T103 [US8] Run the plan P6 multi-device/reconnect checks in `plugin/src/shell/host-server.test.ts` and `plugin/src/shell/remote-transport.test.ts` (no duplicate turn, isolated sessions)

**Checkpoint**: the host is safely multi-device over an unreliable VPN.

---

## Phase 11: User Story 9 — Upgrade, import, and delete the legacy path (Priority: P3)

**Goal**: Existing settings/devices/notes survive the upgrade, old conversations are imported once,
and the legacy relay/client/note format/presentation dictionary are gone.

**Independent Test**: Start from old settings + a `chat/` folder with canonical and prose notes;
upgrade, confirm host settings/device codes preserved, every note imported with originals untouched,
and no legacy listener/module remains.

### Tests for User Story 9

- [ ] T104 [P] [US9] Settings migration fixtures (host user, gateway user, fresh desktop, fresh mobile) in `plugin/src/settings.test.ts` (FR-037/FR-038/FR-068/FR-069)
- [ ] T105 [P] [US9] Legacy note import lossless/idempotent fixtures in `plugin/src/session/migrate.test.ts` (FR-059)
- [ ] T106 [P] [US9] Legacy-removal conformance test (no SSE/EventSource/`turn_end`/`AcpBridgeClient`/dictionary) in `plugin/scripts/check-conformance.mjs` (FR-070)

### Implementation for User Story 9

- [ ] T107 [US9] Implement settings migration preserving host settings, device tokens, session folder discovery, and blacklist; remove gateway/note-writing settings in `plugin/src/settings.ts` (FR-037/FR-038/FR-069)
- [ ] T108 [US9] Implement the legacy note import (canonical block + prose fallback; provenance; idempotent ledger) in `plugin/src/session/migrate.ts` (FR-059)
- [ ] T109 [US9] Switch history/UI to the store; remove chat-folder writing and the note-based resume path from `plugin/src/ui/chat-view.ts` and `plugin/src/main.ts` (FR-054/FR-069)
- [ ] T110 [US9] Delete `plugin/src/host/server.ts`, `plugin/src/host/jsonrpc.ts`, `plugin/src/host/vault-mcp.ts`, `plugin/src/acp/client.ts`, the old note format in `plugin/src/session/store.ts`, and any remaining SSE/`turn_end`/Last-Event-ID code (FR-070)
- [ ] T111 [US9] Update `README.md`, `docs/ARCHITECTURE.md`, `docs/ACP-SHELL.md` to the v2 architecture and record the deletions/import behavior (FR-070)
- [ ] T112 [US9] Run the P6 deletion/upgrade gate using `plugin/scripts/check-conformance.mjs`: single listener, one child, no legacy modules, import report, process/listener check

**Checkpoint**: the branch is a clean ACP+MCP shell with no legacy path.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Hardening and final validation across stories.

- [ ] T113 [P] Run the automated checks in `specs/004-acp-shell/quickstart.md` plus `plugin/scripts/check-conformance.mjs`; fix findings
- [ ] T114 [P] Verify the mobile bundle from `plugin/esbuild.config.mjs` loads with no Node-only/host evaluation and no spawn/listener attempt
- [ ] T115 [P] Tune bounds/constants in `plugin/src/session/store.ts`, `plugin/src/ui/raw-bounds.ts`, and `plugin/src/shell/host-relay.ts` (entry 256 KiB, raw display 16 KiB, replay 20,000 entries, 50 MiB warning) and confirm tests
- [ ] T116 [P] Performance pass in `plugin/src/ui/renderer.ts` and `plugin/src/ui/chat-view.ts`: O(1) tool-card mutation, rAF text batching, lazy raw JSON, paged reopen/raw
- [ ] T117 [P] Security pass in `plugin/src/shell/device-auth.ts` and `plugin/src/session/store.ts`: constant-time tokens, redaction in logs/errors/store, loopback/token checks, no secrets in record
- [ ] T118 [P] Run the real-hardware manual scenarios S1–S11 from `specs/004-acp-shell/quickstart.md` (real harness + VPN + phone); record results
- [ ] T119 Final gate in `plugin/`: `npx tsc -noEmit -skipLibCheck`, production build, `npm test`, conformance greps all pass

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
- **US7 (Phase 9)**: after US1 + US6 (continuity UI sits in the renderer) and the record/store.
- **US8 (Phase 10)**: after US3 (remote transport/relay).
- **US9 (Phase 11)**: last — it deletes the code the earlier phases kept temporarily.
- **Polish (Phase 12)**: after all desired stories.

### User Story Dependencies (graph)

```text
Setup → Foundational → US1 → US2 → US3 → US4
                            ├──────────────→ US5
                            └──→ US6 → US7
US3 ──────────────────────→ US8
All stories ──────────────→ US9 (deletion) → Polish
```

US5 and US6 can run in parallel after US1/US2; US7 and US8 can run in parallel after US3/US6; US9
must be last.

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
- No code should be deleted before its replacement passes the story gate (US9 is the deletion phase).
- Do not reintroduce a custom envelope, name→verb dictionary, hardcoded control set, note-based
  history writer, or a second process/listener at any point.
- The plan's P1–P6 gates map to T040 (P1), T052 (P2), T063 (P3), T097 (P4), T087 (P5 UI) and T112
  (P6), with the cleanup checks at T119.

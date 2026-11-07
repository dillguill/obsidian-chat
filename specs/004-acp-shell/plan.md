# Implementation Plan: ACP Shell

**Branch**: `004-acp-shell` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-acp-shell/spec.md` (approved 2026-11-07),
plus the constitution amendment at [constitution-amendment.md](./constitution-amendment.md), ratified 2026-11-07.

## Summary

Rebuild the plugin as a thin ACP shell around whatever ACP-compatible harness is attached. Obsidian
on the host desktop spawns one configured harness child over stdio; paired devices over the VPN
attach to that host through an ACP-over-WebSocket transport served by the plugin; the same host
process serves a read-only MCP vault tool server to the harness over loopback. Vault read/write and
approval gating use ACP's own client capabilities (`fs/read_text_file`, `fs/write_text_file`,
`session/request_permission`) executed by the host through a single shared VaultService that also
backs the MCP tools and the shell's mention index. Conversations are recorded in a host-owned,
append-only structured session log (JSONL); the chat UI is the only viewer. Reopening a conversation
reattaches through the ACP resume/load ladder with an explicit deterministic digest fallback, never a
silent new session. The transcript is rendered generically from ACP's own fields (no tool-name
dictionary), the composer is generated from harness-declared modes/config options, and every turn
keeps its raw protocol record one disclosure away. The old HTTP/SSE relay, custom client, note-based
history format, and presentation dictionary are deleted at the end of the branch.

The work is a greenfield module set on this branch: new `shell/`, `session/`, `vault/`, and rendered
`ui/` layers replace the current host/client/note/activity code rather than evolving it in place.

## Technical Context

**Language/Version**: TypeScript 5.5 (`target: ES2020`, `module: ESNext`,
`moduleResolution: "bundler"` required by the ACP SDK export map), bundled by esbuild 0.23 for the
Obsidian plugin. Runtime: Obsidian desktop (Electron, Node integration) and Obsidian mobile
(Capacitor WebView, no Node built-ins). Tests run on Node ≥ 22 with type stripping (`node --test`);
this checkout runs Node 24.22.

**Primary Dependencies**: `@agentclientprotocol/sdk` ^1.4.0 (installed). The shell uses the client
side (`client`/`ClientSideConnection`, `ndJsonStream`, `createWebSocketStream`) and the host uses the
SDK's **server transport** (`@agentclientprotocol/sdk/experimental/server`: `AcpServer.handleRequest`,
`AcpServer.prepareWebSocketUpgrade`, `agent()`/`createAgent`) instead of hand-rolling ACP server
dispatch; the deprecated `AgentSideConnection`/`ClientSideConnection` classes are not used. A
WebSocket server primitive is still required for the host listener: add **`ws@^8.18.0`** and
**`@types/ws@^8.5.13`** to `plugin` devDependencies, bundle `ws` (do not mark it external), lazy-
`require("ws")` only in the desktop-gated host module, mark `bufferutil`/`utf-8-validate` external
(optional native probes), and remove the stale `extraneous` `harness` stanza from
`package-lock.json:15–26` in the same change. `@modelcontextprotocol/sdk` ^1.30.0 is referenced only
by that stale lock entry and is **not installed**; keep the existing minimal tool-only MCP handler
shape (no new dependency). Toolchain prerequisite: `plugin/tsconfig.json` must move
`moduleResolution` from `"node"` to **`"bundler"`** (the SDK's `experimental/*` subpaths are
export-map entries with no directory on disk; TS 5.5 supports this). Obsidian Plugin API
(`Vault`, `MetadataCache`, `Workspace`, `FileSystemAdapter`, `Platform`, `Setting`, `Notice`,
`requestUrl`, `Menu`, `SuggestModal`). No provider SDKs, no HTTP framework, no database.

**Storage**: Host-owned append-only JSONL session records in a hidden vault configuration folder
(default `.chat/sessions/`, configurable via settings). One record per conversation with a header
(resume identity, harness fingerprint, protocol version, capability snapshot, last sequence, last
selected modes/config) and ordered entries for prompts, ACP updates, permissions, and turn
boundaries. Settings persist in the plugin's `data.json`. No Markdown session notes are written; the
legacy chat folder is read once for migration. The session index (id → title/updated/resume state)
is derived from record headers; the host maintains a persisted session registry for reattach.

**Testing**: `cd plugin && npm test` → `node --test 'src/**/*.test.ts'` (existing script, Node 24
type stripping). New suites: path policy; session-record append/read/crash-repair; transcript/raw
projection; continuity decisions (resume/load/digest/fresh + fingerprint refusal); declared-control
generation; MCP read-only tool behavior against a fake `VaultService`; store migration fixtures.
Transport coverage uses an **in-process mock ACP agent** (SDK `agent()` app connected directly to the
shell client — deterministic capability matrix, late-update anomaly, permission options, unknown
kinds) plus a **mock harness child process** for the stdio spawn path (one smoke turn + crash
mid-turn) and a **real host listener on an ephemeral port** with a `ws` client for auth-before-
upgrade, one turn, permission routing, second-device isolation, reconnect with `sinceSeq`, and
revocation. Manual validation for real harnesses and real VPN remains the quickstart.

**Target Platform**: Obsidian plugin, desktop (host + local shell) and mobile (remote shell only).
Host role and all process/MCP hosting are desktop-only.

**Project Type**: Single existing project — `plugin/` — rebuilt in new modules; no new package,
service, or companion process.

**Performance Goals**: No regression in time-to-first-token on the local path; attach ≤ ~2 s warm
(spawn + initialize + session/new); appending one update is O(1) and never rewrites the session
record; reopening a long session is bounded by the record size with lazy rendering of older
entries; UI never blocks on raw payload rendering (lazy disclosures, bounded strings). Bundle size
stays within the plugin's current envelope after the relay/client/old-store code is removed.

**Constraints**: Constitution v2.0.0 (ratified 2026-11-07) permits exactly one harness child on the
host desktop, an in-process read-only MCP server, a host-owned store, and one shared VaultService. Exactly one harness child; no other
process, daemon, or launchd job. One host listener, two endpoints, one auth boundary; loopback by
default; explicit confirmation for wider binds. ACP v1 only. Mobile must not evaluate Node built-ins
or spawn. Path confinement + blacklist + `.obsidian/` refusal are shared by ACP fs and MCP tools.
Writes go only through ACP fs + permission; MCP is read-only. Terminal capability `false`. Digest is
deterministic and model-free. No provider credentials anywhere in the shell.

**Scale/Scope**: Personal use — one host, one vault, one attached harness, a small number of paired
devices, multiple sessions per device, potentially long conversations (thousands of updates per
session). Store growth is linear in events per session; per-session records are bounded by user
history, not by a global database.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Constitution version**: `.specify/memory/constitution.md` **v2.0.0**, ratified 2026-11-07
(amendment record: [constitution-amendment.md](./constitution-amendment.md)).

The pre-amendment v1.1.0 failed this feature on two MUSTs: it forbade the plugin from spawning
subprocesses (the host model requires exactly one harness child), and it named only an external
HTTP/SSE bridge plus a rules-enforcement MCP proxy (this feature deletes both and runs an in-process
ACP host and a read-only MCP vault server instead). The amendment was a **gate prerequisite**, not a
plan-level override, and is now ratified. The check below is evaluated against the ratified v2.0.0
text.

| Principle | Check | Status |
|---|---|---|
| **I. Standards Over Custom Protocols** | Chat is ACP via the official SDK; vault tools are MCP over streamable HTTP; vault read/write are ACP `fs/*` + permission. No private envelope, no renamed subset. The former SSE relay is deleted (FR-070). | PASS (v2) |
| **II. Provider Agnosticism** | No model/provider field, list, default, SDK import, or branch anywhere in the shell; harness command is the only harness input (FR-002/FR-042). | PASS (v2) |
| **III. Minimal Custom Glue** | Exactly four named components: ACP client/host transport, read-only in-process MCP vault server, shared VaultService, host-owned session store. No proxy, no second vault implementation, no extra process (FR-001/008/024/026/029/030). | PASS (v2) |
| **IV. Delete Over Accumulate** | Legacy relay, custom client, note history format, `turn_end`/Last-Event-ID envelope, and tool-name dictionary are deleted on this branch, not flagged off (FR-070). | PASS (v2) |
| **V. Simplicity / YAGNI** | No write-capable MCP tools, no third-party MCP forwarding, no terminal, no multi-harness routing, no note export in v1 (FR-025/028/033; spec Open Decisions). | PASS (v2) |
| **Technology Constraints** | One harness child, desktop-only host, mobile never spawns, single listener/two endpoints/one auth boundary, no provider creds, vault only through VaultService, host-owned store, ACP v1 only (FR-001/004/006/008/026/053/072). | PASS (v2) |

Initial gate result: **PASS against v2.0.0, ratified 2026-11-07.** The amendment was reviewed and
approved by the vault owner before tasks; no plan-level override is being used.

## Project Structure

### Documentation (this feature)

```text
specs/004-acp-shell/
├── spec.md                        # approved feature spec
├── constitution-amendment.md      # v2.0.0 amendment record (ratified 2026-11-07)
├── plan.md                        # this file
├── research.md                    # Phase 0 output
├── data-model.md                  # Phase 1 output
├── quickstart.md                  # Phase 1 output
├── contracts/
│   ├── acp-shell.md               # shell ↔ harness ACP contract
│   ├── host-transport.md          # paired-device ACP-over-WebSocket contract
│   ├── vault-mcp.md               # read-only MCP vault tool contract
│   └── session-store.md           # JSONL record + resume/digest contract
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
plugin/
├── package.json                   # add ws@^8.18.0 + @types/ws@^8.5.13 (host only); remove stale lock stanza
├── tsconfig.json                  # moduleResolution "bundler" (ACP SDK export map; prerequisite)
├── esbuild.config.mjs             # single bundle, CJS, es2020, externals (obsidian, electron, node builtins)
└── src/
    ├── main.ts                    # MODIFIED: plugin lifecycle, host start/stop, shell client ownership,
    │                              #   view reattach, session-store ownership, settings migration
    ├── settings.ts                # MODIFIED: host/attach/devices/store/blacklist settings; remove
    │                              #   gateway/legacy host UI; validation + attach status
    ├── shell/                     # NEW: ACP client + transports + host endpoint
    │   ├── acp-client.ts          #   ACP client wiring (initialize, sessions, prompt/cancel,
    │   │                          #   permissions, fs handlers, declared state, update events)
    │   ├── transport.ts           #   transport interface/factory (local stdio | remote websocket)
    │   ├── local-transport.ts     #   desktop-only spawn of exactly one harness child
    │   ├── remote-transport.ts    #   ACP-over-WebSocket client for paired devices
    │   ├── host-server.ts         #   one listener: ws.WebSocketServer + SDK AcpServer + loopback /mcp
    │   ├── host-relay.ts          #   per-device AcpServer agent factory relaying onto harness sessions
    │   ├── device-auth.ts         #   paired-device credentials, revocation, per-run local UI token
    │   └── types.ts               #   attach config, connection/attach state, capability cache
    ├── acp/                       # NEW: shared, Obsidian-free ACP logic
    │   ├── types.ts               #   AcpChatClient seam + render-model types
    │   ├── session-update.ts      #   pure session/update → render model mapper (no name dictionary)
    │   ├── permissions.ts         #   permission request/response model (offered options verbatim)
    │   └── controls.ts            #   declared mode/config/command normalization (no hardcoded set)
    ├── vault/                     # NEW: the single VaultService and its protocol adapters
    │   ├── service.ts             #   path policy, blacklist, read/write, editor refresh, metadata
    │   ├── path-policy.ts         #   pure lexical confinement/.obsidian/blacklist policy
    │   ├── search.ts              #   small BM25 over the existing document cache (no new dependency)
    │   ├── metadata.ts            #   backlinks (resolvedLinks inversion), links, tags, headings, metadata
    │   ├── acp-fs.ts              #   fs/read_text_file + fs/write_text_file handlers → service
    │   └── mcp-server.ts          #   read-only MCP tool server over loopback → service
    ├── session/                   # NEW: host-owned conversation record
    │   ├── record.ts              #   entry/header types, validation, sequence rules
    │   ├── store.ts               #   append-only JSONL store, index, crash repair
    │   ├── digest.ts              #   deterministic bounded digest for the fallback path
    │   ├── resume.ts              #   resume ladder decision (resume/load/digest/fresh) + registry
    │   └── migrate.ts             #   legacy Markdown-note import (canonical block + prose fallback)
    ├── ui/                        # REBUILT: chat as a generic ACP renderer
    │   ├── chat-view.ts           #   transcript/composer shell; no tool vocabulary, no custom protocol
    │   ├── renderer.ts            #   update-kind renderer, generic tool card, content variants, raw row
    │   ├── controls.ts            #   composer controls generated from declared modes/config options
    │   ├── approval.ts            #   permission card with one action per offered option
    │   ├── session-list.ts        #   store-backed conversation list (title/time/resume state)
    │   ├── raw-view.ts            #   per-turn raw disclosure + connection raw log
    │   ├── format.ts              #   pure duration/diff formatting (kept from activity.ts, no dictionary)
    │   ├── raw-bounds.ts          #   bounded raw JSON display (replaces chat/tool-input.ts)
    │   ├── acp-select-suggest.ts  #   generic picker for any declared select with a long option list
    │   ├── markdown.ts            #   retained rendering helper (Obsidian MarkdownRenderer wrapper)
    │   ├── mention.ts             #   retained @mention picker (uses VaultService search)
    │   └── composer / mobile helpers retained or adapted as needed
    └── DELETED at branch end:
        ├── host/server.ts         #   legacy HTTP/SSE relay + MCP vault endpoint + approval parking
        ├── host/jsonrpc.ts        #   custom stdio JSON-RPC peer (replaced by SDK ndJsonStream)
        ├── host/vault-mcp.ts      #   replaced by vault/mcp-server.ts (read-only, shared service)
        ├── acp/client.ts          #   legacy AcpBridgeClient (SSE client)
        ├── session/store.ts       #   legacy Markdown note writer/parser (import-only during migration)
        ├── ui/activity.ts         #   tool-name → verb/icon dictionary (replaced by generic renderer)
        ├── chat/tool-input.ts     #   target derivation heuristics (replaced by raw-bounds)
        ├── chat/types.ts          #   old StreamEvent/ActivityItem model (replaced by record/render types)
        ├── ui/session-suggest.ts  #   note picker (replaced by store-backed session-list)
        ├── ui/acp-model-suggest.ts#   model-specific picker (replaced by generic select suggest)
        └── ui/connection-info.ts  #   SSE cursor/retry view (rebuilt for attach/store/raw)
```

**Structure Decision**: Reuse the single `plugin/` project and rebuild its internals in four module
groups — `shell/` (ACP + transports + host), `vault/` (one VaultService + adapters), `session/`
(host-owned record + continuity), `ui/` (generic renderer) — with `acp/` holding the pure shared
logic. Obsidian imports stay at the edges (`main.ts`, `settings.ts`, `shell/host-server.ts`,
`vault/service.ts`, `ui/`); `path-policy.ts`, `session/`, `acp/`, and the transports are
Obsidian-free where possible so they run under plain Node in tests. Mobile must be able to load the
bundle without evaluating Node-only modules.

## Phase Plan and Gates

### P1 — Shell core, session record, one local turn (foundation)

**Delivers**: `shell/acp-client.ts`, `shell/transport.ts`, `shell/local-transport.ts`,
`acp/types.ts`, `session/record.ts`, `session/store.ts`, minimal `main.ts`/`settings.ts` wiring, plus
the two test doubles: an in-process SDK `agent()` app and a `mock-harness` child. A turn runs
end-to-end locally against the mock: initialize → session/new → prompt → updates → stopReason,
appended to the session record. `plugin/tsconfig.json` moves to `moduleResolution: "bundler"` here
because it is required to import the SDK subpaths.

**Gate P1**:
- `cd plugin && npx tsc -noEmit -skipLibCheck` and the production build pass.
- `npm test` covers: one-turn lifecycle against the in-process mock agent and the child fixture;
  record append/read/sequence; prompt resolution ends the turn with no synthetic `turn_end`; the
  late-update anomaly is recorded with `late: true` and never dropped; cancel resolves as cancelled;
  record survives a simulated crash (last partial line ignored, earlier entries intact, next append
  isolated).
- Grep: no `turn_end`, no `Last-Event-ID`, no `EventSource` in the new shell; no top-level
  `child_process`/`fs` import in shared modules; no provider names in `shell/` or `acp/`.
- Honest status: local transport only, mock harness only; no real harness yet.

### P2 — Native vault environment (ACP fs + permissions + shared VaultService)

**Delivers**: `vault/path-policy.ts`, `vault/service.ts`, `vault/acp-fs.ts`, `vault/metadata.ts`,
`vault/search.ts`, permission handling in `shell/acp-client.ts` and `ui/approval.ts`, snapshot/undo
hooks, and a mock harness that issues fs and permission requests.

**Gate P2**:
- Path-policy unit suite covers: in-vault allowed; `..`/outside/relative/NUL refused; blacklisted
  folder and descendants refused; `.obsidian/` always refused; Windows-style paths normalized.
- Mock integration proves: `fs/read_text_file` returns vault content; `fs/write_text_file` creates
  parents, refreshes metadata, fires the pre-write snapshot hook; a policy violation returns an
  error with zero vault operations; permission options are answered only on user action with an
  offered id; cancel/teardown resolves parked requests cancelled.
- One shared `VaultService` instance is used by ACP fs, MCP, and the mention index (no second
  read/write/policy path).

### P3 — Native Obsidian tools over MCP + single listener

**Delivers**: `vault/mcp-server.ts` (read-only tools: search, backlinks, outgoing links, tags,
outline/headings, metadata), per-session MCP token, `shell/host-server.ts` single listener with the
ACP WebSocket endpoint and the loopback `/mcp` route, `session/new` advertising the MCP server entry.

**Gate P3**:
- MCP contract tests: initialize/`notifications/initialized`/ping/tools list/tools call over the
  stateless JSON transport; search, backlinks (derived from `resolvedLinks` inversion), links, tags,
  outline, metadata return correct fixture results; no write/delete/move tool exists; blacklist and
  `.obsidian/` are refused identically to the ACP path; unknown methods/tools return the specified
  error codes; a tool failure is a tool error, not a protocol failure; loopback + token required
  (401 otherwise); when the mock harness advertises `mcpCapabilities.http = false`, `mcpServers` is
  `[]` and the tools are marked unavailable rather than silently empty.
- Listener test: exactly one HTTP server, both endpoints reachable; MCP unreachable from non-loopback;
  ACP endpoint authenticated per device; no extra ports.
- Manual: a real harness configured with the shell's `mcpServers` entry can search notes and follow
  backlinks; writes still arrive as ACP fs + permission.

### P4 — Host-owned continuity and migration

**Delivers**: `session/resume.ts` (ladder + persisted registry), `session/digest.ts`,
`session/migrate.ts` (legacy notes → store), `main.ts` reattach flow, `ui/session-list.ts` store-backed
history, and the explicit Resume with digest / Start fresh / full-replay choice.

**Gate P4**:
- Resume decisions unit-tested for: resume-capable, load-only, neither, fingerprint mismatch, cwd
  mismatch, host restart, fresh-only session. No path silently creates a new session.
- `session/load` replay is reconciled against the record: no duplicated turn, no re-persisted replay.
- Digest is deterministic, bounded, labelled, and built only from the record; a snapshot test pins
  its output for a fixture session.
- Import test: fixtures for canonical-block notes and legacy prose notes import losslessly,
  idempotently, with originals untouched and malformed notes reported; imported entries carry
  `imported/synthetic` provenance and `harnessSessionId: null`.
- Fingerprint test: same command with different whitespace matches; changed command/cwd/protocol
  refuses; changed agent version warns; registry reconciliation drops/adopts rows as specified.
- Digest snapshot: last 6 complete turns, 600/900-char field caps, 8,000-char total, deterministic
  byte-identical output, delivered as one labelled content block.
- In-flight turn survives view close; reopening shows the full turn; two views share one session.
- "Start fresh" creates a new harness session **on the same conversation record** (history retained,
  recorded as a `resume` event with method `fresh`); it is not a new conversation/fork in v1.

### P5 — Faithful ACP renderer and declared-control composer

**Delivers**: `acp/session-update.ts`, `ui/renderer.ts`, `ui/controls.ts`, `ui/raw-view.ts`,
rebuilt `ui/chat-view.ts` (no `activity.ts`), approval card with offered options, activity-density
setting, per-turn raw disclosure, connection raw log.

**Gate P5**:
- Renderer unit tests: tool card uses title/name/kind/status/content/locations/raw input-output;
  text/diff/terminal/image/resource/resource-link variants each render; an unknown update kind
  renders a generic raw row; no update kind is dropped; no name→verb/icon mapping exists.
- Controls tests: generated from declared modes + every config option (select/boolean); no fixed
  model/thinking/agent trio; empty when nothing declared; selections forwarded unchanged.
- UI check with a mock harness emitting all fixture kinds: chronological expanded default, raw
  disclosures present, density setting changes presentation only; raw display capped at 16 KiB and
  stringified only on expand; late updates rendered as late rows.
- Grep/proof: `activity.ts` deleted; no tool-name dictionaries; no hardcoded control labels.
- Bundle check on a real dev machine (the container's esbuild binary is `@esbuild/darwin-arm64` and
  cannot run here): production build succeeds and the bundle stays within the plugin envelope; the
  ACP SDK pulls zod validation into the bundle, so this is measured, not assumed. If it fails, the
  fallback is a thin typed router over `ndJsonStream`/WS (documented trade-off), not a new protocol.

### P6 — Remote host, delete legacy, full verification

**Delivers**: `shell/remote-transport.ts` + `shell/host-relay.ts` + `shell/device-auth.ts` (or
equivalent) — paired devices attach over WebSocket, per-device sessions, reconnect/replay, revocation;
then deletion of the legacy modules listed above; full migration path; settings cleanup; docs.

**Gate P6**:
- WebSocket integration tests against the host server on an ephemeral port: auth-before-upgrade,
  paired attach, one-turn end-to-end, cancel, permission routing only to the owner, reconnect after
  drop with `sinceSeq` (no duplicate prompt/turn), two-device isolation, revocation; one
  `http.createServer`/`listen(`, `/acp` + `/mcp` only, `maxPayload` enforcement.
- Local UI path check: the host's own view attaches over the loopback WebSocket with a per-run local
  token; no second in-process client path exists.
- Mobile bundle check: loads without Node-only evaluation; no spawn attempts; host UI absent.
- Legacy-deletion check: `host/server.ts`, `host/jsonrpc.ts`, `host/vault-mcp.ts`, `acp/client.ts`,
  old `session/store.ts`, `ui/activity.ts` removed; no SSE/EventSource/turn_end/Last-Event-ID
  references remain outside docs/history; no name dictionaries remain.
- Process/listener check on a live host: exactly one listener, two endpoints, one harness child,
  no extra processes.
- Full quickstart manual pass on real hardware (real harness, VPN, phone) for the scenarios in
  [quickstart.md](./quickstart.md).

## Complexity Tracking

> Filled because the feature performs real architectural work that the amended constitution names;
> none of these is a plan-level override of a ratified MUST.

| Component / decision | Why needed | Simpler alternative rejected because |
|---|---|---|
| In-process MCP vault server (second protocol adapter) | The user explicitly needs native Obsidian search and backlinks for the agent; ACP fs can read/write but cannot search the vault semantically. MCP is the standard tool protocol and runs in the same process over loopback. | Dropping MCP would remove the user's named search/backlink requirement; routing tools through a bespoke ACP extension would be a custom protocol (Principle I). |
| ACP-over-WebSocket host endpoint | The user's model is "Obsidian spawns the harness; remote devices connect to that instance over the VPN"; ACP defines the chat/session stream, so the remote hop must carry ACP. | Reusing the legacy HTTP/SSE relay would keep a private envelope and a second protocol (Principle I/IV); an external bridge/daemon contradicts the single-process constraint. |
| Host-owned JSONL session store (instead of Markdown notes) | Conversations must survive restarts, resume by id, expose raw protocol history, and avoid the legacy base64-in-Markdown compromise; the user does not want a separate note view. | Markdown-only was the old compromise and required base64 canonical blobs, whole-note rewrites, and silently overwrote hand edits; log-only without a store was not a real option (no history). |
| Deterministic digest fallback | Some harnesses advertise neither resume nor load; a bounded, model-free digest prevents the user's "re-fill the entire context" pain without the shell calling a model. | Full transcript replay is unbounded and expensive; silently starting fresh loses continuity; a shell-side summary would require a model call (forbidden). |

## Legacy Removal (executed at branch end, recorded not omitted)

| Target | Replacement |
|---|---|
| `plugin/src/host/server.ts` (HTTP/SSE relay, approval parking, session registry, MCP route) | `shell/host-server.ts` (single listener, ACP WS + MCP routes), `session/resume.ts` registry |
| `plugin/src/host/jsonrpc.ts` (custom stdio JSON-RPC) | ACP SDK `ndJsonStream` in `shell/local-transport.ts` |
| `plugin/src/host/vault-mcp.ts` (writable vault MCP) | `vault/mcp-server.ts` (read-only, shared VaultService) |
| `plugin/src/acp/client.ts` (`AcpBridgeClient`, SSE, `turn_end`) | `shell/acp-client.ts` over SDK transports |
| `plugin/src/session/store.ts` (Markdown note writer/parser) | `session/record.ts` + `store.ts` (JSONL); import via `session/migrate.ts` |
| `plugin/src/ui/activity.ts` (name→verb/icon dictionary) | `acp/session-update.ts` + `ui/renderer.ts` (generic); keep only pure `formatDuration`/`diffStat` in `ui/format.ts` |
| `plugin/src/chat/tool-input.ts` (target/verb derivation) | `ui/raw-bounds.ts` (bounded raw JSON only) |
| `plugin/src/chat/types.ts` (StreamEvent/ActivityItem) | `session/record.ts` + `acp/types.ts` render model |
| `plugin/src/ui/session-suggest.ts` (note picker) | `ui/session-list.ts` (store-backed) |
| `plugin/src/ui/acp-model-suggest.ts` (model picker) | `ui/acp-select-suggest.ts` (generic declared select) |
| `plugin/src/ui/connection-info.ts` (SSE cursor/retry) | rebuilt for attach mode/listener/registry/raw record |
| `host`/`gateway` settings blocks, device-pair UI glue to SSE, `chatFolder` note writing | `shell`/`store`/`devices` settings; legacy folder used only for import |

## Verification Strategy

All commands from `plugin/`:

```bash
npm install                 # adds ws@^8.18.0 + @types/ws; removes the stale extraneous lock stanza
npx tsc -noEmit -skipLibCheck   # requires moduleResolution: "bundler" in plugin/tsconfig.json
node esbuild.config.mjs production
npm test
```

Required follow-up checks (grep/architecture):
- no `turn_end`, `Last-Event-ID`, `EventSource`, `text/event-stream` outside docs/history;
- no top-level `child_process`/`fs` in shared/mobile-loaded modules; only lazy desktop requires;
- no provider/harness-name branches in `shell/`, `acp/`, `vault/`, `session/`;
- no tool-name→verb/icon dictionary and no hardcoded control sets in `ui/`;
- one `http.createServer`/listener on the host; no other `listen(`;
- no second vault read/write/policy implementation outside `vault/service.ts` + `vault/path-policy.ts`;
- process check on a live host: one Obsidian process + one harness child.

Manual acceptance: [quickstart.md](./quickstart.md) covers local turn, native fs + refusal + editor
refresh, approvals, declared controls, faithful renderer/raw view, continuity (resume/load/neither),
remote over VPN, multi-device/reconnect, upgrade + note import + legacy removal, and MCP
search/backlinks.

## Post-Design Constitution Check

*Re-evaluated after Phase 1 design (data-model.md, contracts/, quickstart.md).*

| Principle | Post-design status | Notes |
|---|---|---|
| I. Standards Over Custom Protocols | PASS (v2) | `contracts/acp-shell.md` and `contracts/host-transport.md` specify only ACP v1 methods from the SDK schema; `contracts/vault-mcp.md` specifies only standard MCP over streamable HTTP. The host's server side uses the SDK's own server transport; ACP `_meta` is used only for sequence/replay metadata (standard extensibility), not a new method or envelope. No private protocol remains. |
| II. Provider Agnosticism | PASS (v2) | The data model's harness identity is command/fingerprint/cwd plus negotiated capabilities; there is no provider field, list, default, or SDK import anywhere in the shell/vault/session modules. |
| III. Minimal Custom Glue | PASS (v2) | Exactly four components appear across the contracts: ACP client/host transport, read-only in-process MCP vault server, shared `VaultService`, host-owned session store. The relay is a standard ACP proxy, the MCP server is read-only over the shared service, and no other process or component is introduced. |
| IV. Delete Over Accumulate | PASS (v2) | The Legacy Removal table is binding and is reflected in the P6 gate: relay, custom client, note-history writer/parser, `turn_end`/Last-Event-ID envelope, and activity dictionary are deleted; only the migration reader remains and it is scoped to `session/migrate.ts`. |
| V. Simplicity / YAGNI | PASS (v2) | Contracts explicitly exclude write-capable MCP tools, third-party MCP forwarding, terminal capability, session-history search, note export, multi-harness routing, and TLS beyond the VPN. |
| Technology Constraints | PASS (v2) | One listener with two endpoints and one auth boundary (`host-transport.md` §1–2); one harness child, desktop only; mobile advertises no fs/terminal and serves no MCP; vault access only through `VaultService`; host-owned append-only store; ACP v1 only; no credentials in store/logs. |

Final gate result: **PASS against v2.0.0 (ratified 2026-11-07).** No plan-level Complexity Tracking entry overrides a ratified MUST; the amendment is
the named prerequisite.

**Reconciliation note (research/design integration)**: `research.md` (R1–R11) and `data-model.md`
were produced independently and reconciled against this plan. Key accepted corrections: `ws@^8.18.0`
+ `@types/ws` must be added and bundled (not installed today); the ACP SDK's deprecated connection
classes are avoided in favour of `agent()` + `AcpServer`; `moduleResolution: "bundler"` is a
prerequisite; Obsidian has no public backlink API (derive from `resolvedLinks`) and no full-text
search API (implement a small scored search — the existing `retrieval/index.ts` is a raw cache, not
BM25); the store's internal turn-boundary entry is `turn`, not `turn_end`; the MCP SDK stays out
(minimal handler); bundle size cannot be measured in this container and is a real-machine gate.
`upstream research.md` remains the evidence source for every dependency claim above.

## What Ships Now vs Later

**Ships in this branch**: local host attach over stdio; native vault read/write + permissions +
snapshots + editor refresh; read-only MCP search/backlinks/links/tags/outline/metadata; single
listener with ACP-device + loopback-MCP endpoints; host-owned JSONL store + store-backed history UI;
resume ladder with explicit digest/fresh fallback; persisted host registry; faithful ACP renderer +
declared-control composer + raw views; remote ACP attach over VPN with per-device auth and
reconnect; upgrade import of legacy notes; deletion of the legacy path.

**Does not ship**: terminal capability; write-capable MCP tools; third-party MCP server forwarding;
session-history full-text search; Markdown export; multi-harness routing/profiles; offline remote
history; TLS beyond the VPN; cross-vault identity checks.

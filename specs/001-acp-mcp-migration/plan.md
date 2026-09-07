# Implementation Plan: ACP/MCP Standards Migration

**Branch**: `001-acp-mcp-migration` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-acp-mcp-migration/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Replace the project's custom gateway/agent-worker/relay-worker/tool-calling/retrieval/rules stack
with three standards-based seams: the plugin becomes an ACP client only, an always-on host runs a
thin harness-agnostic ACP bridge that spawns a configured ACP-speaking harness (opencode, Claude
Code, Gemini CLI, or Goose), and that harness reaches the vault through the Obsidian Local REST
API plugin's built-in MCP server (`/mcp/`) instead of bespoke tool-calling code. A small
rules-aware MCP proxy is the one additional custom component needed to keep folder-blacklist and
`.chat/rules.md` enforcement intact, since LRA's MCP server has no notion of those policies.
Existing plugin UX (chat UI, `@mention`, approval modes, sessions-as-notes) is preserved by
re-plumbing it onto ACP session events instead of the old custom `/jobs` protocol.

## Technical Context

**Language/Version**: TypeScript 5.5 (plugin, bridge, MCP proxy) targeting Node.js ≥20 (ESM) on
the host; Obsidian's bundled runtime on the plugin side.

**Primary Dependencies**: `@agentclientprotocol/sdk` (ACP client on the plugin, ACP-facing side
of the bridge), an MCP TypeScript client SDK on the harness/proxy side, Obsidian Plugin API,
esbuild (existing plugin build), Node's built-in `http`/`EventSource`-compatible SSE handling for
the bridge (no new framework required for a seam this small).

**Storage**: Vault content as Markdown notes, accessed exclusively through the Local REST API
plugin (`https://127.0.0.1:27124`) — no direct filesystem access and no new database. Bridge/proxy
process state (pending approvals, replay buffers, per-device tokens) is in-memory plus the
existing `tokens.json`-style file already used by the current gateway.

**Testing**: No test framework is currently established in this repo (no `tests/` directory,
no configured runner). This plan follows existing project convention: `tsc --noEmit` type
checking as a compile-time gate, plus the `quickstart.md` manual end-to-end validation scenarios
as the acceptance check for this feature. Introducing an automated test framework is out of scope
for this migration unless a specific regression can't otherwise be caught.

**Target Platform**: Obsidian plugin running in the Obsidian webview (desktop and mobile); bridge,
harness, MCP proxy, and Obsidian+LRA all running as long-lived processes on one always-on host
machine (existing macOS/launchd deployment), reachable from plugin devices over the existing
tailnet.

**Project Type**: Client (Obsidian plugin, ACP client) + host services (bridge, MCP proxy) —
matches the existing `plugin/` + `harness/` npm-workspaces layout already in this repo; no new
top-level project is introduced.

**Performance Goals**: No perceptible regression vs. the current custom gateway for
time-to-first-streamed-token or end-to-end turn latency (SC-001).

**Constraints**: Plugin runs in a webview and cannot spawn local subprocesses, so it can only ever
be an ACP client reached over the network — hence the bridge. Mobile connectivity is intermittent
(wifi↔cellular handoffs), so reconnect must not drop in-flight stream content or lose pending
approval state (FR-005, FR-010). Exactly one harness/provider is active on the host at a time
(no concurrent multi-harness routing in scope).

**Scale/Scope**: Personal-use, single vault, single always-on host, one active harness at a time,
small number of plugin devices (phone + desktop) connecting concurrently to independent sessions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Standards Over Custom Protocols | Plugin↔harness uses ACP; harness↔vault uses MCP (LRA's built-in server). No new bespoke wire protocol introduced. | PASS |
| II. Provider Agnosticism | Model/provider selection lives entirely in harness config; plugin and bridge never reference a provider SDK or name. | PASS |
| III. Minimal Custom Glue | Constitution v1.1.0 explicitly names two permitted custom components: the ACP bridge and a rules-enforcement MCP proxy (R5). No third custom component is introduced. | PASS |
| IV. Delete Over Accumulate | Plan removes gateway.mjs, agent-worker (never-built, so nothing to delete beyond its plan), relay-worker.mjs, lra-tools.mjs, retrieve.mjs, rules.mjs, and the `/jobs` protocol once their replacements are live (FR-011). | PASS |
| V. Simplicity / YAGNI | Pi/non-ACP harness adapter explicitly excluded (FR-014); no speculative multi-harness routing built. | PASS |

Initial gate result: **PASS**. (The R5 proxy was flagged as a Complexity Tracking deviation in an
earlier draft of this plan; Constitution v1.1.0 has since named it as a permitted exception to
Principle III directly, so it is no longer a deviation — see Complexity Tracking below for the
historical rationale.) Re-evaluated after Phase 1 design (see end of this document).

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
plugin/                        # Obsidian plugin — becomes an ACP client only
├── src/
│   ├── acp/                   # NEW: ACP client wiring (session/new, prompt, session/update, cancel)
│   ├── chat/                  # existing chat engine — re-plumbed onto acp/ instead of chat/gateway.ts
│   ├── session/               # existing sessions-as-notes persistence — observes ACP session events
│   ├── ui/                    # existing chat UI, approval.ts, mention.ts — reused, mapped onto ACP permission requests (R6)
│   └── tools/                 # existing tool contract/runner — reduced/removed once MCP covers tool execution
└── (chat/gateway.ts, tools/runner.ts, tools/contract.ts removed once ACP + MCP cover their role)

harness/                       # Always-on host: bridge + MCP proxy (replaces the old gateway stack)
├── src/
│   ├── acp-bridge.mjs         # NEW: spawns configured ACP harness, fronts it over HTTP/SSE, per-device auth, replay
│   ├── mcp-rules-proxy.mjs    # NEW: sits between harness and LRA's /mcp/, enforces blacklist + .chat/rules.md (R5)
│   ├── gateway.mjs            # REMOVED (FR-011)
│   ├── relay-worker.mjs       # REMOVED (FR-011)
│   ├── lra-tools.mjs          # REMOVED (FR-011) — superseded by LRA's built-in MCP server + mcp-rules-proxy.mjs
│   └── echo-worker.mjs        # REMOVED (job-worker model retired with /jobs)
└── tokens.json                # kept — per-device auth tokens, now consumed by acp-bridge.mjs

# retrieve.mjs and rules.mjs (referenced in the spec's removal list) do not exist as harness/src/
# production files. A file named retrieve.mjs does exist, but only as an inert research spike at
# spikes/g6-retrieval/retrieve.mjs (a standalone G6 experiment over a throwaway note copy) — it is
# not wired into gateway.mjs, lra-tools.mjs, or any runtime path, and is out of scope for FR-011.
# The production equivalents of retrieve.mjs/rules.mjs are, respectively, the plugin-local
# retrieval cascade (plugin/src/retrieval/cascade.ts, index.ts — retired per US3/T025) and the new
# mcp-rules-proxy.mjs. FR-011 is satisfied by retiring those and never building harness-side
# retrieve.mjs/rules.mjs equivalents, not by deleting the unrelated spike file.
```

**Structure Decision**: Reuse the existing `plugin/` + `harness/` npm-workspaces layout. No new
top-level project. The plugin gains an `acp/` module and loses its custom gateway/tool-execution
code; the harness workspace gains `acp-bridge.mjs` and `mcp-rules-proxy.mjs` and loses
`gateway.mjs`, `relay-worker.mjs`, `lra-tools.mjs`, and `echo-worker.mjs`. Vault access itself
requires no new code in this repo — it's satisfied by configuring the harness's MCP client to
point at the Local REST API plugin's existing `/mcp/` endpoint, proxied through
`mcp-rules-proxy.mjs`.

## Complexity Tracking

> **Historical record.** This deviation was resolved by amending the constitution (v1.1.0) to
> name the exception directly in Principle III, rather than relying on this table to override a
> MUST. Kept here as the rationale trail for that amendment.

| Violation (as originally assessed against Constitution v1.0.0) | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A second custom component (`mcp-rules-proxy.mjs`) beyond the ACP bridge, in tension with v1.0.0's "the only bespoke code this project owns is the ACP bridge" | FR-008 requires folder-blacklist and `.chat/rules.md` enforcement to keep working; LRA's built-in MCP server has no concept of either, so *something* project-specific must enforce them | Relying on harness-side prompt instructions alone (no code) was rejected: it's advisory, not an enforced boundary, and would regress a safety guarantee (`rules.mjs`) the current product already provides — an unacceptable regression, not a simplification |

## Post-Design Constitution Check

*Re-evaluated after Phase 1 design (data-model.md, contracts/, quickstart.md).*

| Principle | Post-design status | Notes |
|---|---|---|
| I. Standards Over Custom Protocols | PASS | Contracts (see `contracts/`) define only how existing standards (ACP session lifecycle, MCP tool calls) are configured/mapped — no new wire protocol is specified. |
| II. Provider Agnosticism | PASS | Data model's `HarnessConfig` entity holds provider selection; no entity in `data-model.md` models a provider-specific concept in the plugin or bridge. |
| III. Minimal Custom Glue | PASS | Design confirms the proxy is a pass-through filter, not a reimplementation of MCP or vault logic — it stays minimal in scope, matching the bound Constitution v1.1.0 places on it. |
| IV. Delete Over Accumulate | PASS | `quickstart.md` includes an explicit verification step that removed files are gone and no longer referenced. |
| V. Simplicity / YAGNI | PASS | No Pi/non-ACP adapter appears anywhere in data-model.md or contracts/. |

Final gate result: **PASS**.

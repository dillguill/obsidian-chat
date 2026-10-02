# Phase 0 Research: ACP/MCP Standards Migration

## R1: ACP TypeScript SDK

**Decision**: Use `@agentclientprotocol/sdk` (the current name; the package was renamed from
`@zed-industries/agent-client-protocol`) as the plugin's ACP client library and as the bridge's
ACP client-facing implementation.

**Rationale**: It is the official, actively maintained TypeScript SDK for ACP, exposing typed
`agent()`/`client()` entry points for both sides of the protocol. The stable package entry point
targets ACP v1, which is what this migration needs (session/new, session/prompt, session/update,
cancel) — ACP v2 is still a draft whose wire format may change incompatibly, so the plan pins to
v1 semantics and treats v2 adoption as a future, separate decision.

**Alternatives considered**: Hand-rolling a minimal JSON-RPC-over-stdio client to avoid a
dependency. Rejected — it would recreate exactly the kind of custom protocol code this migration
is meant to eliminate (violates Principle I).

## R2: ACP remote transport (bridge justification)

**Decision**: Confirm the bridge (plugin ↔ host relay over HTTP/SSE) is still necessary; do not
wait for or depend on ACP's native remote transport.

**Rationale**: ACP's "Streamable HTTP & WebSocket Transport" is an active RFD, not a finished
standard. Through mid-2026 it has undergone multiple incompatible revisions (per-request SSE →
single long-lived GET stream → split connection-scoped/session-scoped streams; a
"Durability and reliability expectations" section distinguishing v1 session-survival from v2
message-ID/resumability guarantees was only added in June 2026). Building directly against this
moving target would couple the bridge to a spec that keeps breaking. The bridge therefore owns
its own reconnect/replay contract now (FR-005) and can absorb the RFD once it stabilizes, without
that being a blocking dependency for this feature.

**Alternatives considered**: Wait for the RFD to stabilize before starting. Rejected — no fixed
timeline exists, and the spec's success criteria (SC-001) require chat to work now.

## R3: Harness ACP support (opencode, Claude Code, Gemini CLI, Goose)

**Decision**: All four named harnesses are confirmed to implement ACP today and are viable as
the bridge's spawn target, selected purely by which local command it launches:

- opencode: runs as an ACP agent via its own ACP subcommand.
- Claude Code: listed as a supported ACP agent.
- Gemini CLI: listed as a supported ACP agent.
- Goose: ships ACP provider support, documented as the recommended path for using
  Claude Code/ChatGPT-style subscriptions through Goose without per-token API costs.

**Rationale**: This validates FR-002/FR-013 — swapping the harness is genuinely a config-only
change (which local command the bridge spawns), because all four already speak ACP without any
adapter. It also validates the general architecture pattern: multi-agent "drive your CLI coding
tool from your phone" tools already exist in this ecosystem, confirming the approach isn't
speculative.

**Alternatives considered**: None needed — this is a factual confirmation step, not a choice
among alternatives.

## R4: MCP vault tool server

**Decision**: Use the Obsidian **Local REST API** plugin's built-in MCP server
(`https://127.0.0.1:27124/mcp/`, available since that plugin's v5.0) as the vault-tool MCP
endpoint the harness connects to, authenticated with the existing LRA API key. Do not write a
custom MCP server for basic vault CRUD/search.

**Rationale**: This is the single biggest scope reduction in the migration. The project already
depends on the Local REST API plugin (the current `lra-tools.mjs` calls it over HTTP), and running
Obsidian with LRA active on the always-on host is already the assumed deployment shape (it's how
sync-conflict-safe writes happen today — through Obsidian itself, not raw file I/O). Since LRA
now serves MCP directly, no bespoke vault-tool-calling code is needed at all: FR-007 is satisfied
by configuration (pointing the harness's MCP client at LRA's `/mcp/` endpoint), not by code this
project owns.

**Consequence requiring a follow-up decision (see R5)**: LRA's built-in MCP server has no concept
of this project's folder-blacklist or `.chat/rules.md` nearest-wins exclusion rules — it is a
generic vault MCP server, not aware of this product's grounding policy. FR-008 (exclusions must
still be enforced) is not satisfied by LRA's MCP server alone.

**Alternatives considered**:
- `obsidian-mcp-plugin` (aaronsb) — bundles the MCP server as its own Obsidian plugin with
  semantic operations. Rejected in favor of LRA's built-in MCP: the project already standardizes
  on LRA for the existing REST path, and introducing a second vault-access plugin would add
  surface area without a corresponding benefit now that LRA covers the need natively.
- `obsidian-mcp` (StevenStavrakis) / `mcpvault` — standalone MCP servers that read the vault
  directly from disk, bypassing Obsidian. Rejected — this reintroduces the sync-conflict risk
  (concurrent writes to files Obsidian/Obsidian Sync also has open) that the project already
  chose to avoid by routing writes through Obsidian's own REST API.

## R5: Enforcing folder exclusions / `.chat/rules.md` outside LRA's MCP server

**Decision**: Add one small, explicitly-scoped custom component — an MCP-proxying layer that sits
between the harness and LRA's `/mcp/` endpoint, filters/rejects tool calls against
excluded folders and `.chat/rules.md`, and otherwise passes calls through unchanged.

**Rationale**: Principle III limits this project's custom code to "the ACP bridge," but FR-008 is
a hard requirement carried over unchanged from the existing product, and no standard exists yet
for expressing per-folder MCP tool-call authorization. Enforcing exclusions purely via
harness-side prompt instructions ("don't touch this folder") is not a real control — it is
advisory and vulnerable to prompt injection or model error, and would regress the safety
guarantee the current custom `rules.mjs` provides today. A rules-aware proxy in front of an
otherwise-standard MCP server is the smallest addition that preserves the guarantee; it is
recorded as a justified deviation in Complexity Tracking rather than silently expanded scope.

**Alternatives considered**:
- Rely on harness prompt-level instructions only. Rejected — not an enforced boundary (see above).
- Fork/patch LRA itself to add exclusion awareness. Rejected — couples this project to
  maintaining a fork of third-party software for a project-specific policy; the proxy approach
  keeps LRA untouched and upgradeable.
- Push exclusion logic into the bridge instead of a separate proxy. Considered viable as an
  alternative packaging (same logic, hosted in the bridge process rather than a standalone proxy)
  — left as an implementation-time choice in Phase 1 design rather than a research decision,
  since it doesn't change the scope of custom code, only where it's deployed.

## R6: Approval-mode UX mapping onto ACP

**Decision**: Map the existing Auto/Review/Plan approval modes onto ACP's permission-request
flow: a harness's tool-call permission request (for a vault write) becomes the plugin-side
approval prompt; "Auto" pre-authorizes matching requests without prompting, "Review" always
prompts before the harness proceeds, and "Plan" surfaces the proposed action without allowing the
underlying write to execute.

**Rationale**: ACP already models tool-call permission requests as part of the protocol (this is
what harnesses like opencode expose today as their own permission/approval settings), so this is
a case of routing an existing plugin UX concept onto an existing protocol concept rather than
inventing new wire behavior — consistent with Principle I.

**Alternatives considered**: Keep approval logic entirely custom, downstream of ACP (i.e. the
plugin second-guesses every harness action regardless of what ACP reports). Rejected — this
duplicates a control the protocol already provides and risks the plugin and harness disagreeing
about what was actually about to happen.

## R7: Session-as-notes persistence

**Decision**: Keep session-to-note persistence as plugin-side logic that observes the ACP session
lifecycle (session/new, streamed updates, session end) and writes/updates the corresponding note
via the same LRA-backed path already used for other vault writes.

**Rationale**: This is presentation/persistence behavior specific to this product, not a protocol
concern — nothing in ACP or MCP models "represent this conversation as a note," so it correctly
stays plugin-side, unchanged in spirit from today, just re-plumbed to observe ACP events instead
of the old custom `/jobs` protocol's events.

**Alternatives considered**: Move session persistence into the harness or bridge. Rejected — it
is a vault-note-shaped, product-specific concern, and keeping it in the plugin keeps the
harness/bridge fully swappable (Principle III) without needing to know anything about "sessions
as notes."

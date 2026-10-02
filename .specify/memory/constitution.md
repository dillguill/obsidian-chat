<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0
- Modified principles: III. Minimal Custom Glue (added a named, bounded exception for a
  rules-enforcement MCP proxy; core intent — no sprawl of custom protocol code — unchanged)
- Added sections: none
- Removed sections: none
- Deferred/TODO placeholders: none
- Rationale: resolves a CRITICAL finding from /speckit-analyze on spec 001-acp-mcp-migration —
  the plan requires a small rules-enforcement proxy (mcp-rules-proxy.mjs) that Principle III's
  original unconditional wording did not permit; rather than let a plan-level Complexity Tracking
  table silently override a ratified MUST, the exception is now named explicitly in the principle
  itself, with a governance rule that any further exception requires the same process.
-->
# Obsidian Chat Constitution

## Core Principles

### I. Standards Over Custom Protocols
Every integration seam MUST be built on an existing open standard rather than a
bespoke protocol. Plugin-to-harness communication MUST use ACP (Agent Client
Protocol); harness-to-vault communication MUST use MCP (Model Context
Protocol). A new custom protocol MAY be proposed only when no existing
standard covers the seam, and MUST be justified in writing before
implementation begins.

### II. Provider Agnosticism
The model/provider (Anthropic, OpenRouter, DeepSeek, Ollama, etc.) is
configuration on the harness, never a compile-time or code-level dependency
of the plugin or the bridge. Neither the plugin nor the bridge MAY branch on,
hardcode, or import a specific provider's SDK. Switching providers MUST
require only a configuration change on the harness.

### III. Minimal Custom Glue
The bespoke code this project owns is limited to the ACP bridge (process
spawn, per-device auth, and transport relay — stdio ACP ↔ HTTP/SSE over the
tailnet) and exactly one named exception: a rules-enforcement MCP proxy
sitting between the harness and the vault's MCP server, whose sole job is
enforcing pre-existing folder/`.chat/rules.md`-based access exclusions and
coordinating approval-gating for vault writes. Both components MUST remain
harness-agnostic — they speak ACP/MCP only, and never encode assumptions
specific to one harness. Swapping the configured harness (opencode, Claude
Code, Gemini CLI, Goose, etc.) MUST require zero changes to the plugin, the
bridge, or the proxy — only a config change pointing the bridge at a
different ACP-speaking command. The rules-enforcement proxy MUST NOT
reimplement or duplicate any vault operation the MCP server already
provides — it may only allow, deny, or gate calls, never execute vault
operations itself. No custom component beyond these two is permitted
without a fresh constitutional amendment naming it explicitly, following
this same process — a plan's Complexity Tracking table MAY document a
deviation as rationale for such an amendment, but MUST NOT itself authorize
one.

### IV. Delete Over Accumulate
When a standards-based component (ACP client, MCP server) covers
functionality previously served by custom code, the custom code MUST be
removed in the same change, not kept behind a flag or as a fallback path.
Dead code and superseded custom protocols are liabilities, not safety nets.

### V. Simplicity / YAGNI
Support for a harness that does not natively speak ACP or MCP (e.g. a
Pi-style RPC harness) MUST NOT be built speculatively. An adapter for such a
harness is added only when that specific harness is an actual, named
requirement — not in anticipation of future demand.

## Technology Constraints

The plugin (Obsidian webview) is an ACP client only — it MUST NOT spawn
subprocesses or hold provider credentials. Provider keys and harness
configuration live exclusively on the host running the bridge and harness.
Vault access from the harness MUST go through MCP vault tools, not
ad hoc file I/O bypassing the vault abstraction.

## Governance

This constitution supersedes prior informal architecture notes (e.g.
SPIKES.md) where they conflict with the principles above; those
documents remain useful context but are not authoritative once superseded.
Amendments require a written rationale, an explicit version bump per the
policy below, and review of any in-flight specs/plans for compliance.

Versioning policy (semantic):
- MAJOR: backward-incompatible removal or redefinition of a principle.
- MINOR: a new principle or materially expanded guidance is added.
- PATCH: wording clarifications with no semantic change.

All feature specs and plans produced via Spec Kit MUST include a
Constitution Check step confirming alignment with these principles before
implementation proceeds.

**Version**: 1.1.0 | **Ratified**: 2026-09-06 | **Last Amended**: 2026-09-07

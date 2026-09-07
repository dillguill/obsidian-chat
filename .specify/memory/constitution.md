<!--
Sync Impact Report
- Version change: (none) → 1.0.0
- Modified principles: n/a (initial ratification)
- Added sections: Core Principles (I-V), Technology Constraints, Governance
- Removed sections: none
- Deferred/TODO placeholders: none
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
The only bespoke code this project owns is the ACP bridge: process spawn,
per-device auth, and transport relay (stdio ACP ↔ HTTP/SSE over the
tailnet). The bridge MUST remain harness-agnostic — it speaks ACP only, and
never encodes assumptions specific to one harness. Swapping the configured
harness (opencode, Claude Code, Gemini CLI, Goose, etc.) MUST require zero
changes to the plugin or the bridge, only a config change pointing the bridge
at a different ACP-speaking command.

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
PLAN.md, SPIKES.md) where they conflict with the principles above; those
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

**Version**: 1.0.0 | **Ratified**: 2026-09-06 | **Last Amended**: 2026-09-06

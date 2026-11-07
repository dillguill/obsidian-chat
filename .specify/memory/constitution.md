<!--
Sync Impact Report
- Version change: 1.1.0 → 2.0.0
- Modified principles:
  * I. Standards Over Custom Protocols — vault access is ACP fs/permission capabilities or the
    in-process read-only MCP tool server; no private envelope.
  * III. Minimal Custom Glue — names exactly four components: the ACP client/host transport, the
    read-only in-process MCP vault server, the shared VaultService, and the host-owned session
    store; removes the external HTTP/SSE bridge and the rules-enforcement MCP proxy exception.
  * IV. Delete Over Accumulate — names the legacy relay, custom ACP client, note-based history
    format, turn_end/Last-Event-ID envelope, and tool-name presentation dictionary that MUST be
    deleted.
  * V. Simplicity / YAGNI — write-capable MCP tools, third-party MCP forwarding, terminal
    capability, multi-harness routing, and session export are excluded until a named requirement.
- Modified section: Technology Constraints — the host-mode plugin MAY spawn exactly one configured
  harness child (the old "MUST NOT spawn subprocesses" rule described the external-bridge era);
  one listener with ACP + loopback MCP endpoints; host-owned append-only session store; mobile
  remote-only.
- Added sections: none
- Removed sections: none
- Deferred/TODO placeholders: none
- Rationale: specs/004-acp-shell reverses the external-bridge assumption and was approved by the
  user on 2026-11-07. Proposal and approval record:
  specs/004-acp-shell/constitution-amendment.md. Current source itself already violated v1.1.0's
  spawn rule (host mode runs the harness child in the plugin), so this amendment makes the
  constitution descriptive again rather than silently waiving it.
-->

# Obsidian Chat Constitution

## Core Principles

### I. Standards Over Custom Protocols
Every integration seam MUST be built on an existing open standard rather than a
bespoke protocol. Chat and session streaming between the shell and the harness
MUST use ACP (Agent Client Protocol). Vault access from the harness MUST use
either ACP's own filesystem/permission client capabilities, executed by the
host shell, or the standard MCP tools served in-process by the host plugin —
never a plugin-specific protocol. A new custom protocol MAY be proposed only
when no existing standard covers the seam, and MUST be justified in writing and
approved before implementation begins; a private envelope that merely renames
an existing standard's messages is never justified.

### II. Provider Agnosticism
The model/provider (Anthropic, OpenRouter, DeepSeek, Ollama, etc.) is
configuration on the harness, never a compile-time or code-level dependency of
the plugin or the shell. The shell MUST NOT branch on, hardcode, or import a
specific provider's SDK. Switching providers MUST require only a configuration
change on the harness.

### III. Minimal Custom Glue
The bespoke code this project owns is limited to these named components, all of
which MUST remain harness-agnostic and MUST speak only standards:

1. **ACP client and host transport** — the shell's ACP client (one configured
   harness child on the host desktop over stdio; the same client over a
   WebSocket transport for paired devices), including per-device authentication
   and the relay between a paired device's ACP connection and the host's
   harness. It MUST NOT implement an ACP agent or a private envelope.
2. **In-process MCP vault server** — a read-only MCP server running inside the
   Obsidian host process, reachable only over loopback and authenticated per
   session, exposing native Obsidian read/search tools (note search, backlinks,
   outgoing links, tags, headings/outline, metadata). It MUST NOT expose write
   operations.
3. **Shared VaultService** — the single in-process implementation of vault
   semantics: path normalization and policy, folder blacklist, `.obsidian/`
   protection, reads and writes with editor refresh, the search index, and the
   metadata-derived queries. The ACP filesystem handlers, the MCP tools, and the
   shell's own mention index MUST call this service; none may maintain a second
   implementation, index, or policy.
4. **Host-owned session store** — an append-only structured conversation record
   (one record per session) with the resume identity and the transcript/raw
   history it backs. The chat UI is its viewer. It MUST NOT become a second
   source of truth or a note format.

No process other than the configured harness child may be started by the
plugin, and the host plugin MUST run all four components in the Obsidian
runtime. MCP MUST NOT be used as a chat transport, and ACP MUST NOT be used as a
tool-server protocol. The former rules-enforcement MCP proxy, the HTTP/SSE
relay, the custom ACP client, and the note-based history format are deleted
(Principle IV); they are not exceptions that may be revived without a new
amendment.

Swapping the configured harness (opencode, Claude Code, Gemini CLI, Goose,
etc.) MUST require zero changes to these components — only a configuration
change pointing the shell at a different ACP-speaking command or endpoint.

### IV. Delete Over Accumulate
When a standards-based component (ACP client, MCP server) covers functionality
previously served by custom code, the custom code MUST be removed in the same
change, not kept behind a flag or as a fallback path. Dead code and superseded
custom protocols are liabilities, not safety nets. Specifically, the HTTP/SSE
relay, the custom `AcpBridgeClient`, the note-based session-history format, the
SSE `turn_end`/Last-Event-ID envelope, and the tool-name-to-verb/icon
presentation dictionary MUST be deleted when their replacements land; they MUST
NOT be retained for comparison or compatibility inside the shipped plugin.

### V. Simplicity / YAGNI
Support for a harness that does not natively speak ACP MUST NOT be built
speculatively. An adapter for such a harness is added only when that specific
harness is an actual, named requirement — not in anticipation of future demand.
Likewise, write-capable MCP tools, third-party MCP server forwarding, terminal
capability, multi-harness routing, and session export formats MUST NOT be built
until a named requirement exists.

## Technology Constraints

- **Host role**: desktop Obsidian only. The host-mode plugin MAY spawn exactly
  one configured ACP harness as a child process; it MUST NOT spawn any other
  process, daemon, or launchd job. Mobile MUST NOT spawn anything and operates
  as a remote shell only.
- **Remote role**: paired devices attach to the host's single authenticated ACP
  endpoint over the private network/VPN. The remote shell holds no provider
  credentials, serves no vault capability, and stores no local conversation
  history in v1.
- **Network surface**: exactly one host listener with two endpoints — the
  paired-device ACP endpoint and the loopback-only MCP endpoint. The host MUST
  default to loopback and MUST require explicit confirmation before binding on
  interfaces reachable beyond the private network.
- **Credentials**: provider keys and harness configuration live exclusively on
  the harness. The shell may hold only per-device attach tokens and per-session
  MCP tokens, never provider credentials, and MUST never log or render them.
- **Vault access**: only through the shared VaultService, behind ACP filesystem
  capabilities and the read-only MCP tools. No direct disk I/O, no second
  content index, no ad-hoc file I/O bypassing the vault abstraction.
- **Session record**: host-owned, append-only, structured; the chat UI is the
  only viewer in v1. Markdown session notes are not the history model.
- **Protocols**: ACP v1 only; the shell is always the ACP client and never an
  ACP agent. MCP only for the read-only vault tool server.

## Governance

This constitution supersedes prior informal architecture notes (e.g.
SPIKES.md) where they conflict with the principles above; those documents
remain useful context but are not authoritative once superseded. Amendments
require a written rationale, an explicit version bump per the policy below, and
review of any in-flight specs/plans for compliance.

Versioning policy (semantic):
- MAJOR: backward-incompatible removal or redefinition of a principle or of a
  named component.
- MINOR: a new principle or materially expanded guidance is added.
- PATCH: wording clarifications with no semantic change.

All feature specs and plans produced via Spec Kit MUST include a Constitution
Check step confirming alignment with these principles before implementation
proceeds.

**Version**: 2.0.0 | **Ratified**: 2026-09-06 | **Last Amended**: 2026-11-07 (amendment ratified 2026-11-07)

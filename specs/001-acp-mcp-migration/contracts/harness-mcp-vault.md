# Contract: Harness ↔ MCP Rules Proxy ↔ Local REST API MCP Server

**Parties**: harness (MCP client) ↔ `mcp-rules-proxy.mjs` (this project's only vault-facing custom
code) ↔ Obsidian Local REST API plugin's built-in MCP server (`https://127.0.0.1:27124/mcp/`)

**Protocol base**: standard MCP tool-call semantics as exposed by LRA's built-in MCP server
(read/search/create/edit/rename/delete/list/tag/property tools). The proxy speaks the same MCP
surface on both sides — it is a transparent filter, not a redefinition of the tool contract.

## Harness → Proxy

- The harness is configured (host-side config, not code) to point its MCP client at the proxy's
  endpoint instead of LRA's `/mcp/` directly.
- The harness issues standard MCP tool calls; it has no awareness of blacklists or
  `.chat/rules.md` — that policy is enforced downstream, not by the harness (research.md R5).

## Proxy → LRA

For every incoming tool call:

1. Resolve the call's target vault path(s).
2. Check the path against the current folder blacklist (`settings.blacklistFolders` — the
   existing hard access-control gate; **not** `.chat/rules.md`, which is advisory instruction text
   injected into the model's context elsewhere and is not an access boundary — see
   data-model.md's Vault Tool Call correction note).
   - If denied: the proxy MUST reject the call with an MCP-level error and MUST NOT forward it to
     LRA (FR-008). The denial reason SHOULD be legible enough for the harness to relay to the user
     ("this folder is excluded from tool access") without the proxy leaking implementation detail
     of the rules engine.
   - If allowed: the proxy forwards the call unmodified to LRA's `/mcp/` endpoint using the
     existing LRA API key, and returns LRA's response unmodified to the harness.
3. For calls of kind `write` (data-model.md Vault Tool Call), the proxy coordinates with the
   session's active Approval Request flow (see `contracts/plugin-bridge-acp.md` for how that
   surfaces to the user) before forwarding to LRA — a write MUST NOT reach LRA while its Approval
   Request is `pending` or resolves to `plan-only`.

## Non-goals

- The proxy MUST NOT reimplement or duplicate any vault operation LRA's MCP server already
  provides (no parallel read/write path) — its only job is allow/deny plus approval gating.
- The proxy MUST NOT be harness-specific; any ACP-speaking harness configured per
  `contracts/bridge-harness-spawn.md` uses the same proxy unmodified.

# Quickstart: Validating the ACP/MCP Standards Migration

This is a validation guide, not an implementation guide — it proves the feature works end-to-end
once built. See `data-model.md` and `contracts/` for the interfaces being exercised.

## Prerequisites

- Always-on host machine with:
  - Obsidian running with the Local REST API plugin enabled (v5.0+, built-in MCP at `/mcp/`) and
    its API key available.
  - The host bridge (`acp-bridge.mjs`) and `mcp-rules-proxy.mjs` running, per
    `contracts/bridge-harness-spawn.md` and `contracts/harness-mcp-vault.md`.
  - A Harness Config (data-model.md) pointing at one supported harness (opencode, Claude Code,
    Gemini CLI, or Goose), itself configured with a working model-provider credential.
- Obsidian plugin installed on at least one device (e.g. phone), configured with the bridge's
  address and a valid per-device token (`contracts/plugin-bridge-acp.md`).
- A vault with: at least one blacklisted folder, and a `.chat/rules.md` covering at least one
  subfolder, both already configured (existing feature, unchanged by this migration).

## Scenario 1 — Core chat round trip (User Story 1 / SC-001)

1. From the plugin, start a new chat and send a simple message ("say hello").
2. **Expect**: a streamed reply begins arriving promptly and completes, matching current
   responsiveness.
3. Send another message and cancel mid-stream.
4. **Expect**: streaming stops promptly; the plugin shows a cancelled state, not an error.
5. Mid-stream, disable and re-enable the device's network connection.
6. **Expect**: on reconnect, previously-delivered content is not duplicated and no content
   produced while disconnected is lost.

## Scenario 2 — Harness/provider swap (User Story 2 / SC-002)

1. With a session already working end-to-end, change the host's Harness Config to a different
   supported harness (or change only its provider config), and restart only the host-side
   processes.
2. **Expect**: without any plugin update or plugin-side settings change related to harness
   identity, a new chat message from the plugin still gets a valid streamed reply.

## Scenario 3 — Vault grounding via MCP (User Story 3 / SC-003)

1. `@mention` a specific note in a chat message.
2. **Expect**: the reply reflects that note's content.
3. Ask a question answerable only by searching the vault, without mentioning a note.
4. **Expect**: the harness performs a vault search (visible as a tool-call event) and the answer
   reflects the right note's content.
5. Ask a question that would require reading a note inside the blacklisted folder or a
   `.chat/rules.md`-denied subfolder.
6. **Expect**: the read is denied at the proxy (per `contracts/harness-mcp-vault.md`) and the
   denied content never appears in the reply.

## Scenario 4 — Approval-gated writes survive disconnects (User Story 4 / SC-004)

1. Set approval mode to Review. Ask the assistant to create or edit a note.
2. **Expect**: an approval prompt appears with enough detail (diff) to decide; the write is not
   applied yet.
3. Background the app (or drop connectivity) while the prompt is pending, then resume.
4. **Expect**: the same pending approval is still present and actionable — not lost, not
   auto-resolved.
5. Approve it.
6. **Expect**: the write is applied to the vault only now.
7. Repeat with approval mode Auto for a previously-allowed action.
8. **Expect**: it applies without an extra prompt.
9. Repeat with approval mode Plan.
10. **Expect**: a plan is shown; the underlying write never executes.

## Scenario 5 — Sessions persist as notes (User Story 5)

1. Complete a chat exchange from Scenario 1.
2. **Expect**: a note appears (or updates) in the configured sessions folder reflecting that
   exchange.
3. Reopen that note/session from the plugin and continue the conversation.
4. **Expect**: prior context is available to the continued conversation.

## Scenario 6 — Old custom stack is gone (SC-005, FR-011)

1. Search the repository for references to: `gateway.mjs`, `agent-worker`, `relay-worker.mjs`,
   `lra-tools.mjs`, `retrieve.mjs`, `rules.mjs`, and the `/jobs` route.
2. **Expect**: no remaining references in active source (docs describing history are fine;
   importable/runnable code is not).

## Pass/fail

All six scenarios must pass for this feature to be considered complete, per the spec's Success
Criteria (SC-001 through SC-006).

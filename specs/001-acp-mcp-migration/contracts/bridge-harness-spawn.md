# Contract: Bridge ↔ Harness (local ACP subprocess)

**Parties**: host bridge ↔ locally spawned harness process (opencode, Claude Code, Gemini CLI, or
Goose, as configured)

**Protocol base**: standard ACP v1 over stdio — the harness's own ACP implementation, unmodified.

## Bridge responsibilities

- Spawn the harness process using exactly the `command` from the active Harness Config
  (data-model.md) — no per-harness branching logic in the bridge beyond "run this command."
- Speak ACP to the spawned process exactly as it would to any ACP agent; the bridge MUST NOT
  depend on any behavior specific to one named harness (Principle III — swapping harnesses must
  require zero bridge code changes, only a config change).
- Restart or surface failure of the harness process as a connectivity error up through the
  plugin-bridge contract (FR-012), rather than hanging.

## Harness responsibilities (given, not built by this project)

- Implement ACP v1's agent-side surface (accepts `session/new`, `session/prompt`, emits
  `session/update`, honors `session/cancel`).
- Read its own model-provider configuration independently (API keys, base URL, model) — the
  bridge never passes provider identity through this contract (Principle II).
- Issue vault operations exclusively as MCP tool calls (see `contracts/harness-mcp-vault.md`),
  configured by the operator to target the MCP proxy endpoint, not LRA directly.

## Explicit non-goals

- No adapter is defined here for harnesses that do not speak ACP natively (e.g. Pi) — out of
  scope per FR-014.
- No protocol extension or non-standard method is introduced on this seam.

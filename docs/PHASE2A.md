# Phase 2a — Write tools + approval (status)

> Built 2026-09-02. Goal: the agent can safely change your vault with reviewable diffs from desktop and phone. Exit = "summarize X into Inbox/" and "reorganize these notes" work with reviewable diffs.
> **Status: COMPLETE.** Write tools, approval, and the tool-calling loop are in and since hardened (see "Changed since" at the bottom).

## What was built

### Write tool contract (`src/tools/contract.ts`)
- Added 7 write tools alongside the read-only set: `create_note`, `edit_note` (whole-content or targeted `old_string`→`new_string`), `rename_move_file`, `create_folder`, `set_property`, `manage_tags`, `delete_file` (→trash).
- `previewWrite(name, args, vault)` computes a **diff/preview WITHOUT mutating**, for approval cards. Includes a minimal line-based LCS `textDiff` (added `+` / removed `-`).
- Same JSON-schema contract runs in two places (PLAN §2.4): plugin-local and harness `lra-tools.mjs`.

### Local executor (`src/retrieval/index.ts`)
- `VaultIndex` now implements the full `VaultAdapter`: create/edit via `vault.create`/`vault.modify`, **link-aware rename/move** via `app.fileManager.renameFile`, `createFolder`, `setProperty`/`manageTags` by rewriting the YAML frontmatter block (`upsertFrontmatter` helper), `deleteFile` via `vault.trash`.
- `parseValue` coerces frontmatter values (bool/number/JSON/string).

### Approval & diff UI (`src/ui/approval.ts` + styles.css)
- `ApprovalModal` shows action, summary, and a monospace diff, with **Allow once / Always allow / Deny** (review mode) or **OK (not applied)** (plan mode).
- `createApprovalRequester` wires the modal; persistent per-tool allow/deny stored in `settings.toolAllowlist` (Copilot semantics). Plan mode never applies.

### Settings (`src/settings.ts`)
- Added `approvalMode` (auto/review/plan), `maxToolRounds` (loop cap), `tokenBudget` (per-turn), `toolAllowlist`; corresponding controls in the settings tab.

### Engine loop (`src/chat/engine.ts`)
- Full tool-calling protocol: provider adapters assemble streaming tool calls → engine emits `tool_calls`, appends assistant `tool_calls` message + `tool` result messages with matching `tool_call_id`, loops. Bounded by `maxToolRounds` and `tokenBudget`.
- Adapters updated: `openai-compat.ts` accumulates `delta.tool_calls` args by index and emits on `finish_reason=tool_calls`; `anthropic.ts` accumulates `tool_use` blocks from `content_block_start`/`input_json_delta` and emits on `stop_reason=tool_use`.

### Harness executor (`harness/src/lra-tools.mjs`)
- Mirrors the tool contract against the Local REST API (auth `Bearer <apiKey>`), so write tools run harness-side too. Tested: `list_folder`, `create_note`, `set_property` (frontmatter `status: done` confirmed), `read_file`, `delete_file` all OK. Note: TLS in dev needs `NODE_TLS_REJECT_UNAUTHORIZED=0` (LRA self-signed cert); rename/move is create-new+delete-old (link-update not guaranteed until Phase 3 MCP `vault_move`).

## Verification
- `tsc --noEmit` clean; production build OK; installed via `install.sh`.
- Plugin reloaded in Obsidian; `obsidian-chat:open-chat` command still registered (proves load with no fatal error).
- Harness LRA executor exercised end-to-end (create → set property → read-back shows `status: done` → delete), probe file cleaned up.
- Gateway + LRA still running; vault left clean.

## Notes / deferred to Phase 2b / Phase 3
- **Mobile/approval on phone**: the approval modal uses Obsidian modals (webview-safe); a "bottom sheet" presentation is a polish item. The gateway (phone) path currently streams without the write-tool loop — the phone write-tool loop is Phase 2b (the plugin runs the same loop locally on mobile since it has the vault).
- **rename/move link-update via LRA** needs the MCP `vault_move` (Phase 3) for guaranteed link rewrite; the plugin-local path uses `fileManager.renameFile` (link-aware) today.
- **Concurrency on write**: local writes don't yet use LRA `ifMatch`; the plugin-local path writes via Obsidian's API which Obsidian itself serializes. Harness-side concurrency via version token is a Phase 3 refinement.
- Loop caps + token budget wired; the meter is `tokens` shown in the status line.

## Changed since (Phase 3 / 2026-09-03)
- **Research mode** makes tool calling the default: `groundingMode: "tools" | "auto"`; notes only enter via `@mention`, a tool call, or auto mode. `search_vault` now uses the BM25 relevance cascade.
- **Approval is mode-aware** through the composer's mode selector (Research/Auto/Review/Plan); write tools stay gated (default **review**) while read tools are always available.
- Added **blacklist folders** (autocomplete) and **`.chat/rules.md`** (nearest-wins) for per-folder permissions.
- `VaultIndex` now ignores the plugin's own `chat/` folder and the configured blacklist; retrieval filters unrelated notes (coverage threshold).
- See `docs/PHASE3.md` for the full spec.

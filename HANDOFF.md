# Handoff — ACP shell (specs/004-acp-shell)

**Repo**: `/workspace/obsidian-chat` · branch `dsh-62a64db7-85a6`.
Implementation through US8 + the US9 legacy deletion is in the working tree (uncommitted until the
owner confirms a successful deploy/test).

## What this branch is

The plugin is rebuilt as a thin ACP shell: one host Obsidian spawns one harness child; paired devices
attach over ACP/WebSocket; vault read/write goes through ACP fs + approvals; read-only vault tools
are served in-process over loopback MCP; conversations are host-owned JSONL records. The legacy
HTTP/SSE relay, custom client, Markdown session-note history and tool-name dictionary are deleted.

## Deploy

```bash
cd plugin
node esbuild.config.mjs production
cd ..
OBSIDIAN_VAULT="<vault>" bash plugin/install.sh
```

Reload Obsidian (or toggle the plugin).

## Verify

1. **ACP Shell** opens; one local turn streams and `.chat/sessions/*.jsonl` gains entries.
2. No new Markdown chat notes are written; there is no chat/session folder setting.
3. **History** lists stored conversations. Old Markdown chats appear after the automatic one-time
   import; **Reimport legacy chats (diagnostics)** reports exactly what was scanned/imported/skipped.
4. Opening an old/detached conversation offers digest (default), fresh, or full replay — never a
   silent new session.
5. On a paired device: attach over the VPN, run a turn, approve a write (only the owning device sees
   the card). Kill the connection: the turn shows interrupted and reconnects with `sinceSeq`.
6. Revoking a device on the host closes its connection immediately; its next attach is rejected.
7. `npx tsc --noEmit`, `npm test`, `node scripts/check-conformance.mjs` and the production build pass.

## Notes

- Model/provider configuration belongs entirely to the harness. The plugin has no provider key,
  provider SDK, model list, or default model.
- Remote devices keep no local conversation history in v1; undo after a write is host-side only.
- Terminal capability is not advertised.

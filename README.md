# Obsidian Chat — an ACP shell for your vault

Obsidian Chat turns Obsidian into a **thin frontend for whatever ACP-compatible harness you attach**.
One Obsidian install is the host: it spawns the harness, owns the conversation record, and serves the
vault's native read/search tools. Every other device — phone or second desktop — is a shell that
attaches to that host over your private network/VPN.

**What you need:** Obsidian (desktop for the host) and an harness that speaks the
[Agent Client Protocol](https://agentclientprotocol.com). The harness owns the model/provider
configuration; this plugin never holds a provider key and has no model settings of its own.

## How it works

```
Phone / other desktop ── ACP over WebSocket ──┐
                                              ▼
              Obsidian on the host computer (one plugin listener)
                ├─ runs exactly one harness child (ACP over stdio)
                ├─ answers the harness's vault read/write requests natively
                ├─ serves read-only search/backlinks/tags/outline tools over loopback MCP
                └─ stores every conversation in a host-owned JSONL record
```

- **One host, one harness.** Shell mode → Local starts the configured harness command as a child of
  the plugin. There is no bridge, daemon, launchd job, or second process.
- **Remote devices attach to the host** by its tailnet name (Tailscale Serve), authenticated by
  their Tailscale identity — no device codes, no IPs. A remote never spawns a process, opens a listener,
  reads the vault, or keeps local history.
- **Native vault access.** Reads and writes go through Obsidian's own vault API via ACP filesystem
  capabilities; open editors refresh, parent folders are created, and a best-effort snapshot enables
  host-side undo. Paths are confined to the vault and the folder blacklist; `.obsidian/` is always
  refused.
- **Native Obsidian tools.** The harness gets read-only note search, backlinks, outgoing links, tags,
  headings/outline and note metadata over an in-process MCP server on loopback. Writes are never
  exposed through MCP: the only write path is ACP plus an approval.
- **Approvals are inline and owner-only.** The card shows the harness's real proposed change and
  exactly the options it offered; only the device that owns the session can answer.
- **The transcript is the protocol.** Tool calls, plans, usage, unknown/experimental updates and raw
  payloads are rendered generically from ACP's own fields — no tool-name dictionary — with per-turn
  and session-wide raw views. Composer controls are generated from the harness's declared modes and
  config options.
- **Old conversations always continue.** Reopening a conversation tries the harness's resume/load
  capabilities; when it can't reattach, your next message carries a bounded, deterministic summary
  of it (default). A quiet note offers the full transcript or a fresh start instead.

## Conversations and history

Conversations are host-owned **JSONL records** stored on the host, outside the vault and its sync
(`~/Library/Application Support/obsidian-chat/vaults/<vault>-<hash>/sessions/` on macOS). Records from the old in-vault `.chat/sessions/` folder are copied there once;
**Delete old in-vault conversation copies** removes the originals that have a matching copy. The ACP Shell
is the only viewer; no Markdown session notes are written, and **there is no note-folder setting**.
On first upgrade, old Markdown conversations are discovered vault-wide by their content and imported
once (idempotent, originals untouched). If History looks wrong, run **“Reimport legacy chats
(diagnostics)”** from the command palette — it reports exactly what was scanned, found, skipped, and
stored.

## Setup

1. **Host** (desktop): Settings → Obsidian Chat → role **Host**, set the harness command (e.g.
   `opencode acp`). The listener starts with the plugin on loopback (port 8765 by default).
2. Publish it on your tailnet once: `tailscale serve --bg --https=9443 8765` (not 443 if Caddy or
   another server already listens there). Optionally list the Tailscale
   accounts allowed to attach (empty = anyone on your tailnet).
3. **Other devices:** role **Remote**, host address `https://<host>.<tailnet>.ts.net:9443`, and a device
   name (shown in History, routes approvals).
4. Open the chat view.

Role, address, port and device name stay on each device; only shared preferences sync with the vault.

## Build & install

```bash
cd plugin
npm install
node esbuild.config.mjs production   # → plugin/main.js
cd ..
OBSIDIAN_VAULT="<your vault>" bash plugin/install.sh
```

`install.sh` copies the bundle, manifest and styles into the vault; re-run it after every build and
reload the plugin (or restart Obsidian).

## Repo layout

```
plugin/            The Obsidian plugin (TypeScript + esbuild)
  src/shell/       ACP client/transports, host listener, relay bridge, runtime
  src/vault/       Shared VaultService, path policy, ACP fs handlers, read-only MCP server
  src/session/     Host-owned JSONL record, store, continuity/digest, legacy import
  src/acp/         Protocol types, update mapping, permissions, declared controls
  src/ui/          ACP Shell view, renderer, raw views, approval card, controls, labels
docs/              Architecture and the ACP Shell guide
specs/             Spec Kit artifacts (004-acp-shell is this rebuild)
```

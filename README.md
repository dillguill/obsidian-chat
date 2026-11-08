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
- **Remote devices attach to the host.** Pair a device on the host, then enter the host's WebSocket
  endpoint and the device code on that device. A remote never spawns a process, opens a listener,
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
- **Continuity without silent resets.** Reopening a conversation tries the harness's resume/load
  capabilities; when it cannot reattach, you get an explicit choice: continue with a bounded,
  deterministic digest (default), start fresh, or replay the full transcript. No new session is
  created until you choose.

## Conversations and history

Conversations are host-owned **JSONL records** in the hidden `.chat/sessions/` folder. The ACP Shell
is the only viewer; no Markdown session notes are written, and **there is no note-folder setting**.
On first upgrade, old Markdown conversations are discovered vault-wide by their content and imported
once (idempotent, originals untouched). If History looks wrong, run **“Reimport legacy chats
(diagnostics)”** from the command palette — it reports exactly what was scanned, found, skipped, and
stored.

## Setup

1. **Host:** Settings → Obsidian Chat → mode **Local**, set the harness command (e.g. `opencode acp`),
   listen port (default 8765) and bind address (loopback by default).
2. **Pair devices** under *Paired devices*. Each gets its own code; revoking one closes its live
   connection immediately.
3. **Remote:** on the other device set mode **Remote**, the host endpoint
   (`ws://<host>:8765/acp`, e.g. over Tailscale) and the device code.
4. Open the **ACP Shell** view.

The host binds loopback by default. Choosing a wider bind is deliberate; the VPN/private network is
yours to provide and secure.

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

# Architecture

> The plugin is a **view**. The harness owns the model, the tools, and the
> conversation. Obsidian exposes the vault to the harness over MCP. Everything
> below exists to keep that true as the code grows.
> Written 2026-09-13 (specs/003-workspace-parity W5.2).

## 1. Stack

```
┌──────────────────────────────┐
│ Obsidian plugin (this repo)  │   thin ACP client + vault-native UI
│  plugin/src/ui/*, acp/client │   no model calls, no tool execution
└──────────────┬───────────────┘
               │  HTTP + SSE (bearer token, per device)
               │  contracts/plugin-bridge-acp.md
┌──────────────▼───────────────┐
│ harness/src/acp-bridge.mjs   │   :8765 — spawns and fronts one harness
│  POST /sessions              │   session/new, mode, config-option,
│  GET  /sessions/:id/events   │   prompt, cancel, approvals; SSE replay
└──────────────┬───────────────┘
               │  ACP over stdio (JSON-RPC)
┌──────────────▼───────────────┐
│ the configured harness       │   e.g. `opencode acp` (harness.config.json)
│  model + agent loop + tools  │   owns the conversation and the tool loop
└──────────────┬───────────────┘
               │  MCP (HTTP), server entry `vault`
┌──────────────▼───────────────┐
│ harness/src/mcp-rules-proxy  │   :8766 — enforces the folder blacklist,
│                              │   then forwards unmodified
└──────────────┬───────────────┘
               │  MCP (HTTP, self-signed TLS)
┌──────────────▼───────────────┐
│ Obsidian **desktop** +       │   :27124 /mcp/ — the vault exposes itself.
│ Local REST API plugin        │   This is the only thing that touches notes.
└──────────────────────────────┘
```

The desktop Obsidian app **is** the vault server: the always-on machine runs
Obsidian with Local REST API enabled, and the harness reaches notes only through
it. One machine should enable `settings.host` (which spawns the bridge and the
proxy as children of Obsidian); every other install — another desktop, a phone —
is a pure client pointed at that machine's bridge over Tailscale.

## 2. A turn, end to end

1. Composer → `ChatView.send()` → `AcpBridgeClient.prompt(blocks)`.
   Blocks carry the user text, any `@mention`-attached note bodies, context
   chips, images, and advisory rules text.
2. Bridge → `session/prompt` on the spawned harness.
3. Harness streams `session/update` notifications; the bridge buffers them
   with sequence numbers and relays them over SSE.
4. `AcpBridgeClient.dispatch()` splits them: chat content is mapped to
   `StreamEvent` (`token`, `reasoning`, `tool_call`, `plan`, `usage`,
   `session_info`); mode/config/command/session-info updates also refresh
   local state and notify listeners.
5. `ChatView.handleStreamEvent()` renders — reasoning accordions, activity
   groups, plan panel, usage meter, streaming answer.
6. Tool calls that need approval arrive as `session/request_permission`; the
   bridge parks them in `/approvals/:requestId` and the plugin renders an
   inline card. The decision goes back through the bridge to the harness.
7. When `session/prompt` resolves, the plugin appends the reply to
   `acpHistory` and persists the session note.

Reconnect: the plugin reopens the SSE stream with `Last-Event-ID`, so the
bridge replays exactly what was missed (no duplicated or lost content).

## 3. What the plugin may touch locally

FR-002 forbids the plugin from executing or previewing vault writes on the
harness's behalf. These are the only local vault operations that legitimately
remain — each is a client-side concern the harness cannot own.

| Local operation | Where | Why it is not a violation |
|---|---|---|
| Write the **session note** (chat transcript as Markdown) | `session/store.ts`, `ChatView.persistSession` | It is the plugin's own record of the conversation, not an agent action. The harness never asks for it. |
| **Undo snapshots** — read a note before an approved write, restore on Undo | `ChatView.handlePermissionRequest`, `undoPath`, `undoAll` | Corrections to a write the *harness* executed, driven by a user click. Snapshots are captured and replayed entirely client-side; the harness is not involved and no new content is authored. |
| **Read-only `@mention` index** (BM25 over notes) | `retrieval/index.ts` | Powers the file picker; never mutates anything, and never reaches the model except as context the user explicitly attached. |
| **Read rules files** (`AGENTS.md`, `vault-rules.md`, `.chat/rules.md`) | `ChatView.readAdvisoryRulesContext` | Read-only advisory text appended to the prompt. Not an access-control gate — the blacklist is enforced proxy-side. |

Everything else is out:

- **No model calls.** No provider adapters, keys, or HTTP to an LLM API.
- **No tool execution.** The plugin never performs `read_file`/`write_note` on
  the agent's behalf; it never inspects a tool call to decide whether it may run.
- **No access control.** Blacklist enforcement for agent tool calls lives in
  `mcp-rules-proxy`; the plugin's own `blacklistFolders` setting only keeps
  excluded folders out of the plugin's mention index.

The rule for future contributors:

> If a feature needs the plugin to call a model or execute a tool, it is
> mis-designed. Route it through ACP.

## 4. Where things live

| Path | Role |
|---|---|
| `plugin/src/acp/client.ts` | The only path to the harness: sessions, prompt, cancel, approvals, modes, config options, commands, usage/plan/session-info updates, connection state. |
| `plugin/src/chat/tool-input.ts` | Bounds and sanitises tool arguments before they reach the UI (a write's arguments contain the whole note body). |
| `plugin/src/ui/activity.ts` | Pure tool presentation: name → verb → icon → label, group stats. No Obsidian import. |
| `plugin/src/ui/chat-view.ts` | The view: transcript, composer, activity groups, approval cards, plan, usage, sessions, context chips. |
| `plugin/src/session/store.ts` | Session notes as Markdown, including the base64 activity trail. |
| `plugin/src/ui/approval.ts` | Inline approval card (approve/reject only — never edits, never batches). |
| `harness/src/acp-bridge.mjs` | Spawns the harness; HTTP/SSE façade; per-device ownership; approval parking; SSE replay. |
| `harness/src/mcp-rules-proxy.mjs` | Blacklist enforcement in front of LRA's MCP endpoint; exact per-tool path fields. |
| `harness/harness.config.json` | Harness command, cwd (the vault), proxy URL, blacklist, LRA credentials. |

## 5. Trust and configuration notes

- **Tokens:** `harness/tokens.json` maps a bearer token to a device id. The
  bridge rejects anything else (401) and enforces that a session/approval
  belongs to the device that created it (403).
- **TLS:** the LRA leg uses a self-signed certificate, so the proxy disables
  verification for that one loopback host only.
- **Exposure:** the bridge is meant for a Tailscale network, not the public
  internet. It sets permissive CORS because the mobile WebView
  (`capacitor://localhost`) is a real cross-origin client — the token, not the
  origin, is the security boundary.
- **Blacklist agreement:** `harness/harness.config.json`'s
  `rules.blacklistFolders` and the plugin's `blacklistFolders` setting should
  stay identical so the agent and the mention index agree. Both currently
  mirror this vault's `AGENTS.md` mandate (`Journals/`, `_attachments/`,
  `.trash/`).

# Architecture

> The plugin is a **view**. The harness owns the model, the tools, and the
> conversation. Obsidian exposes the vault to the harness over MCP. Everything
> below exists to keep that true as the code grows.
> Written 2026-09-13 (specs/003-workspace-parity W5.2).

## 1. Stack

```
┌──────────────────────────────┐
│ Chat client (any device)     │   plugin/src/acp/client.ts + ui/*
│                              │   no model calls, no tool execution
└──────────────┬───────────────┘
               │  HTTP + SSE (bearer token per device)
┌──────────────▼───────────────────────────────────────────┐
│ Obsidian desktop on the host — plugin host mode          │
│  plugin/src/host/server.ts   :8765                       │
│   /sessions/*  chat relay, SSE replay, approvals         │
│   /mcp         vault MCP tools (loopback + secret only)  │
└──────────────┬──────────────────────────▲────────────────┘
               │ ACP over stdio            │ MCP (HTTP, loopback)
┌──────────────▼──────────────────────────┴────────────────┐
│ the configured harness, e.g. `opencode acp`              │
│  model + agent loop; owns the conversation               │
└──────────────────────────────────────────────────────────┘
```

The host is just Obsidian with *Host on this device* enabled: the plugin spawns
the harness (respawning it with backoff if it exits), relays it to every chat
client, and is itself the vault's MCP server. Every other install is a pure
client pointed at the host's address. Nothing runs outside Obsidian except the
harness.

## 2. A turn, end to end

1. Composer → `ChatView.send()` → `AcpBridgeClient.prompt(blocks)`.
   Blocks carry the user text, any `@mention`-attached note bodies, context
   chips, images, and advisory rules text.
2. Host answers `202` and sends `session/prompt` to the harness.
3. Harness streams `session/update` notifications; the host buffers them
   with sequence numbers and relays them over SSE.
4. `AcpBridgeClient.dispatch()` splits them: chat content is mapped to
   `StreamEvent` (`token`, `reasoning`, `tool_call`, `plan`, `usage`,
   `session_info`); mode/config/command/session-info updates also refresh
   local state and notify listeners.
5. `ChatView.handleStreamEvent()` renders — reasoning accordions, activity
   groups, plan panel, usage meter, streaming answer.
6. Tool calls that need approval arrive as `session/request_permission`; the
   host parks them in `/approvals/:requestId` (cancelled after 10 minutes)
   and the plugin renders an inline card.
7. When `session/prompt` resolves, the host waits for the update stream to go
   quiet, then publishes `turn_end` (with `stopReason`) on the same stream.
   The client ends the turn on that event, so it can never finish before the
   last token, then appends the reply to `acpHistory` and saves the note.

Reconnect: the plugin reopens the SSE stream with `Last-Event-ID`, so the
host replays exactly what was missed. A heartbeat every 15 s keeps idle
streams open, and the retry budget counts consecutive failures only.

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
| **Model pin / default preference** — a shortlist order and the model a new session opens on | `chat/model-prefs.ts`, `settings.pinnedModels` / `settings.defaultModel` | Two opaque harness option values, no provider knowledge, no keys, no calls. `resolveModelChoice` only decides whether to send a `session/set_config_option` the harness already declared — and refuses to send a value it no longer declares. |

Everything else is out:

- **No model calls.** No provider adapters, keys, or HTTP to an LLM API.
- **No tool execution.** The plugin never performs `read_file`/`write_note` on
  the agent's behalf; it never inspects a tool call to decide whether it may run.
- **No access control in the client.** Blacklist enforcement for agent tool
  calls lives in the host's vault MCP server (`host/vault-mcp.ts`), which reads
  the same `blacklistFolders` setting the mention index uses.

The rule for future contributors:

> If a feature needs the plugin to call a model or execute a tool, it is
> mis-designed. Route it through ACP.

## 4. Where things live

| Path | Role |
|---|---|
| `plugin/src/acp/client.ts` | The only path to the host: sessions, prompt, cancel, approvals, modes, config options, commands, usage/plan/session-info updates, connection state. |
| `plugin/src/host/server.ts` | Host mode: spawns and respawns the harness, ACP `initialize`, HTTP/SSE relay, per-device auth, approval parking, `turn_end`. |
| `plugin/src/host/jsonrpc.ts` | Newline-delimited JSON-RPC peer for ACP over stdio. |
| `plugin/src/host/vault-mcp.ts` | The vault's MCP tools, run in-process with the blacklist enforced. |
| `plugin/src/chat/tool-input.ts` | Bounds and sanitises tool arguments before they reach the UI. |
| `plugin/src/ui/activity.ts` | Pure tool presentation: name → verb → icon → label, group stats. No Obsidian import. |
| `plugin/src/ui/chat-view.ts` | The view: transcript, composer, activity, approval cards, plan, usage, sessions, context chips. |
| `plugin/src/session/store.ts` | Session notes as Markdown, including the base64 activity trail. |
| `plugin/src/ui/approval.ts` | Inline approval card (approve/reject only). |

## 5. Trust and configuration notes

- **Device codes:** the host's *Paired devices* list maps a name to a bearer
  token; each device enters its own code. The host's own client uses a token
  minted at startup. Sessions and approvals belong to the device that created
  them (403 otherwise).
- **MCP endpoint:** `/mcp` accepts only loopback connections carrying a secret
  minted at startup and handed to the harness in `session/new`.
- **Exposure:** the host listens on all interfaces so phones can reach it;
  keep it on a private network (Tailscale or LAN). CORS is permissive because
  the mobile WebView is a real cross-origin client; the token is the boundary.

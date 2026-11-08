# Architecture (ACP shell)

The plugin is a **thin shell around an ACP harness**. It owns no model, no provider credentials and
no custom chat protocol. Everything between the harness and the vault is ACP or MCP.

## Components

The constitution names exactly four bespoke components; nothing else may be added without a new
amendment.

1. **ACP client + host transport** (`src/shell/`)
   - Local: spawns exactly one configured harness child over stdio (`ndJsonStream`).
   - Remote: paired devices attach over ACP-over-WebSocket using the SDK's WebSocket stream.
   - One listener serves `/acp` (paired devices) and `/mcp` (loopback-only vault tools).
   - A relay bridge maps each device session onto a harness session, forwards updates with
     `_meta { "obsidian-chat/seq" }`, and routes approvals to the owning device only.
2. **In-process read-only MCP vault server** (`src/vault/mcp-server.ts`)
   - Note search, backlinks, outgoing links, tags, outline/headings, metadata.
   - Loopback only, per-session bearer token, no write tools.
3. **Shared VaultService** (`src/vault/service.ts` + `path-policy.ts`)
   - The single implementation of vault semantics: path confinement, blacklist, `.obsidian/`
     protection, reads (including open-editor text), writes, editor refresh, search index and
     metadata queries. The ACP fs handlers, the MCP tools and the shell's mention search all call it.
4. **Host-owned session store** (`src/session/`)
   - Append-only JSONL, one record per conversation in the hidden `.chat/sessions/` folder.
   - A header carries resume identity (harness session id, cwd, command fingerprint, protocol
     version, capability snapshot, last sequence, last selected modes/config); entries cover prompts,
     ACP updates, permissions, turn boundaries, resume decisions, metadata and errors.
   - The chat UI is the only viewer. There is no Markdown transcript writer and no note-folder
     setting.

## A turn

1. The view sends `session/prompt` over the attach (loopback WebSocket for the host's own UI,
   VPN WebSocket for a paired device).
2. The relay forwards the prompt to the harness session and streams every harness
   `session/update` back as the host's own notification, recording it first with a monotonic
   sequence.
3. The harness may ask the shell to read/write vault files (`fs/*`): the **host** executes them
   through VaultService; a remote device never serves fs.
4. The harness may request permission (`session/request_permission`): the host forwards it to the
   owning device with the real tool call and offered options. The selected option id (or
   `cancelled`) is returned verbatim, never auto-approved. A 10-minute operational timeout
   resolves as cancelled.
5. The turn ends only when `session/prompt` resolves. Late updates are attributed (`late`) and
   never dropped. Records are appended at the session level, so closing the view does not stop a turn.

## Continuity

- Stored state is recomputed on open from the capability snapshot, command/cwd/protocol identity and
  the record: `resume-capable`, `load-only`, `digest-only`, `fresh-only`.
- Order is mandatory: `session/resume` → `session/load` (replay reconciled, never re-persisted) →
  explicit digest/fresh choice. A changed command/cwd/protocol refuses resume with a named reason; an
  agent name/version change only warns. A host-side `registry.json` reattaches sessions after a
  reload/respawn and marks them detached on stop.
- The digest is deterministic and model-free: last six complete turns, bounded field sizes, files and
  errors, 8 000-character cap, labelled as a digest and prepended to the first prompt (not shown as a
  user turn). “Start fresh” keeps the same conversation record.

## Trust boundaries

- The host listener defaults to loopback; paired devices authenticate with a per-device bearer token
  before the WebSocket upgrade (401 otherwise). Tokens are compared in constant time and never
  logged or stored in records.
- The MCP endpoint is loopback-only and additionally requires the per-session token.
- Vault writes only happen through ACP fs + approval; MCP exposes no write path.
- The shell holds no provider credentials. Provider/model configuration lives entirely in the
  harness.
- Legacy modules — HTTP/SSE relay, custom ACP bridge client, Markdown note history, `turn_end`
  envelope and the tool-name presentation dictionary — are deleted. Old Markdown conversations are
  read once by `session/migrate.ts` and imported; nothing writes that format anymore.

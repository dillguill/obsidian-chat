# ACP Shell — operator guide

## Which mode?

- **Local (this device hosts)** — desktop Obsidian. Spawns exactly one harness child, owns the
  conversation record and serves paired devices.
- **Remote (attach to a host)** — phone or second desktop. Spawns nothing, opens no listener, keeps
  no local history; it only renders the host's sessions.

Mobile Obsidian never hosts. There is no bridge, daemon or launchd job in either mode.

## First run on the host

1. Settings → Obsidian Chat → mode **Local**.
2. Harness command: any ACP-speaking command, e.g. `opencode acp`. The plugin passes the vault root
   as the session cwd and adds its loopback MCP tools when the harness supports HTTP MCP.
3. Listen port (default 8765) and bind address (loopback by default).
4. Open **ACP Shell** (ribbon or command palette).

## Pair a device (host)

Settings → Paired devices → add a name, copy the generated code. Enter the host endpoint
(`ws://<host>:8765/acp`) and that code under the device's **Remote** mode. Removing a device closes
its live connection and cancels its pending approvals immediately.

## History and continuity

- Conversations live in `.chat/sessions/*.jsonl` (host-owned, append-only). There is **no folder
  setting**.
- Old Markdown chats are found vault-wide by their content/frontmatter on first upgrade and imported
  once; originals are untouched. Command: **Reimport legacy chats (diagnostics)** shows scanned notes,
  candidates, skipped reasons and store count.
- Opening a stored conversation: the host tries the harness's resume/load capability. If it cannot
  reattach, an inline choice appears — **Continue with digest** (default), **Start fresh**, or
  **Replay full transcript**. Nothing is created until you choose; the conversation record is the
  same either way.
- A healthy resumable conversation has no status tag. Non-resumable ones show plain language (e.g.
  “Old conversation — can’t reattach”), never internal state names.

## Transcript, controls, approvals

- Every ACP update is rendered in arrival order and expanded by default; grouping is opt-in under
  Settings → Transcript. Tool cards show the harness's title/kind/status/content/locations with raw
  input/output behind a disclosure. Unknown update kinds show a generic raw row.
- **Info** shows attach mode/state, listener, store path and the session-wide paged raw record.
- Composer controls are generated from the harness's declared modes/config options/commands. Nothing
  is shown when nothing is declared.
- Approvals are inline and belong to the owning device. The shell never invents options and never
  auto-approves. Approvals cancelled by disconnect/timeout are explained in the transcript. Undo after
  a write is host-side only.

## Troubleshooting

| Symptom | Check |
|---|---|
| “No stored conversations” | Run **Reimport legacy chats (diagnostics)**; it reports the vault scan and import result. The store is `.chat/sessions/`. |
| Remote shows “unreachable” | Host Obsidian must be running with hosting enabled, and the VPN address/device code must match. There is no fallback path. |
| Auth rejected | The device was revoked or the code is wrong; re-pair. Auth errors are never retried as network failures. |
| Harness commands fail | Missing credentials/configuration live in the harness, not the plugin; fix them in the harness and use **Restart harness**. |

## What the plugin never does

- No provider SDK, key, model list or model default.
- No custom chat protocol or tool-name dictionary.
- No Markdown transcript writer.
- No second process, listener, daemon or cloud service.

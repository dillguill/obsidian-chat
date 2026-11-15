# Redesign: host, settings and vault access (2026-11)

Status: **agreed, not built.** One Gitea issue per item (titles "Redesign N: …"),
filed by `scripts/file-redesign-issues.py`; this file records why. `ARCHITECTURE.md` still describes the current build and
will be updated as each item lands.

## Why

The bugs of the ACP shell rebuild (remote devices can't connect, connections
drop, devices overwrite each other's settings, dsh bypasses the vault rules,
slow and fragile harness start) come from five structural choices, not from
individual code paths:

1. **The host lives inside a GUI app** and only starts when the chat pane
   opens.
2. **iCloud is used as a database and message bus.** Per-device role, bind
   address, device codes and live JSONL records all sit in synced files with
   last-writer-wins and no reload on external change.
3. **The "harness" is a stack.** `dsh-acp` boots containers, a proxy, relays
   and an Infisical login on every start, and pokes the supervisor that other
   things depend on.
4. **Policy lives in two places.** The plugin's path policy guards ACP `fs/*`,
   which dsh never uses; dsh reads and writes the vault with its own tools.
5. **Addressing by IP.** Bind addresses, Tailscale IPs and hand-made device
   codes live in synced config.

## Decisions

The Mac stays the host (it is always on) and dsh stays on the Mac for now.
Every item below holds whether dsh later moves to the NAS; item 7 makes that
move a settings change.

### 1. Settings split by device

- Synced `data.json`: shared preferences only (blacklist, skills folder,
  transcript options).
- Per device (`app.saveLocalStorage`): role (host/remote), host name.
- Secrets (`app.secretStorage`, per device, never synced): any harness or
  remote token.
- The plugin reloads settings on external change (`onExternalSettingsChange`)
  and never writes keys it did not change.

### 2. Host starts on plugin load

On the host device the listener (and the harness, lazily) starts at
`onLayoutReady`, not when the chat view connects. Remote devices can attach
whether or not the chat pane is open on the Mac.

### 3. Reachability through Tailscale Serve

- The listener binds loopback only. The bind address, port and wider-bind
  settings go away.
- `tailscale serve` on the Mac publishes it as `https://<mac>.<tailnet>.ts.net`;
  remote devices store that name, never an IP.
- Serve's identity headers (`Tailscale-User-Login`) replace paired-device codes.
  Serve strips client-supplied identity headers, and loopback-only binding
  means nothing can reach the listener around Serve. Note: tagged devices get
  no identity headers.

### 4. Remote connections that keep themselves alive

- Client-side liveness check (application ping), not only host pings.
- Reconnect on `visibilitychange`/resume and `online`; no permanent give-up
  after N attempts (back off to a ceiling and keep trying while visible).
- A dead connection is shown as reconnecting, never as connected.

### 5. Conversation records outside the vault

- Location: the host's app-data folder, derived from the OS home directory,
  default `~/Library/Application Support/obsidian-chat/sessions/` on macOS
  (`$XDG_DATA_HOME/obsidian-chat/sessions` on Linux). No path is hardcoded in
  synced config; a host-local override is allowed.
- Only the host reads or writes it. Remote devices already read history
  through the host (`session/list`, `session/load`) and keep no copy.
- Backed up by the Mac's normal backup (Time Machine); an optional copy to a
  NAS share can come later.
- One-time move of the existing `.chat/sessions/` records (and
  `registry.json`), idempotent, originals left until confirmed.
- Why: appending to growing JSONL inside the iCloud vault re-uploads files on
  every streamed update and syncs them to every device for no benefit.
- If dsh and the host move to the NAS later, the records move with them;
  clients never read the folder directly.

### 6. The plugin is the only way the harness reaches the vault

- dsh's own filesystem tools are disabled in the `obsidian` profile.
- The vault tool server (today read-only MCP) gains write tools. Every write
  goes through an approval card and VaultService, so the blacklist,
  `.obsidian/` protection, editor refresh and undo apply.
- Why it wasn't like this before: the design relied on ACP `fs/*` for writes
  and kept MCP read-only on purpose; dsh doesn't use ACP `fs/*`, so the rules
  sat on a path dsh never took. MCP is supported by every harness.
- Side effect: the harness no longer needs the vault on its disk, so a NAS
  move needs no vault copy (the tool calls come back to the Mac).

### 7. Harness setting: a command or a URL

One field; the plugin decides by prefix.

| Value | Meaning |
| --- | --- |
| `~/bin/dsh-acp` | spawn dsh on this machine (today) |
| `opencode acp` | spawn OpenCode |
| `npx @zed-industries/claude-code-acp` | spawn Claude Code via its ACP adapter |
| `wss://harness.example/acp` | connect to a harness running elsewhere |

`ws://`/`wss://` means connect (reusing the remote WebSocket transport);
anything else is spawned. A URL harness needs the vault tools reachable from
it (tailnet name + per-run token from item 6), never an IP.

### 8. dsh-acp: fast, self-contained start (tracked in the dsh repo)

- `dsh-acp` stops loading/SIGHUPing the supervisor on every start. If the
  proxy is up it is left alone; if not, it is started once; on failure,
  exit with a clear error.
- The plugin waits ~10 s (not 2 s) after SIGTERM before SIGKILL, so
  `dsh-acp` can revoke its Agent Vault session.
- Quitting DeepSeek.app (`down --all`) leaves the proxy running while an
  Obsidian dsh session is alive.

## Not decided

- Whether dsh (and later the host) moves to the NAS. Items 6 and 7 keep that
  open; Obsidian Sync is ruled out (no paid service).

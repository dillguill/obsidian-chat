# ACP Shell — operator guide

## Which mode?

- **Host** — desktop Obsidian. Spawns exactly one harness child, owns the conversation record and
  serves other devices. Its loopback listener starts when the plugin loads.
- **Remote** — phone or second desktop. Spawns nothing, opens no listener, keeps
  no local history; it only renders the host's sessions.

Mobile Obsidian never hosts. There is no bridge, daemon or launchd job in either mode.

## First run on the host

1. Settings → Obsidian Chat → role **Host**.
2. Harness command: any ACP-speaking command, e.g. `opencode acp`. The plugin passes the vault root
   as the session cwd and adds its loopback MCP tools when the harness supports HTTP MCP.
3. Listener port (default 8765, loopback only). Publish it once: `tailscale serve --bg --https=9443 8765`
   (9443 because Caddy on the Mac owns 443 on every interface).
4. Optional: Allowed Tailscale accounts (empty = any user on your tailnet).
5. Open the chat view (ribbon or command palette).

## Add a device

On the device: role **Remote**, host address `https://<host>.<tailnet>.ts.net:9443`, and a device name.
There is no pairing step and no code: the host trusts the Tailscale identity Serve attaches. To
remove a device, remove it from your tailnet (or from the allowed accounts).

Settings that describe a device (role, host address, port, device name) stay on that device; shared
preferences sync with the vault, and a device only writes the keys it changed.

## Check the listener (host)

```sh
H=https://<host>.<tailnet>.ts.net:9443
tailscale serve status                       # shows :9443 / proxy http://127.0.0.1:8765
curl -s --noproxy '*' "$H/"                  # {"error":"not found"}: Serve reaches the listener
U=(-s --noproxy '*' --http1.1 -m 3 -o /dev/null -D - -H "Connection: Upgrade" -H "Upgrade: websocket" \
   -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==")
curl "${U[@]}" "$H/acp?device=check" | head -1                               # 101: your identity is accepted
curl "${U[@]}" -H "Origin: https://evil.example" "$H/acp" | head -1          # 403: web pages are refused
```

A `502` on the plain GET too means nothing is listening on 127.0.0.1:8765: start Obsidian (the
listener starts with the plugin on the host) and check `lsof -nP -iTCP:8765 -sTCP:LISTEN`.
An empty `200` with `server: Caddy` means Caddy answered instead of Serve (wrong port). A `401`
where `403` is expected means Obsidian is still running an old build: quit and reopen Obsidian
(toggling the plugin does not always reload its code). `--noproxy '*'` matters: with an HTTP(S) proxy in the environment, curl prints the proxy's
`HTTP/1.1 200` CONNECT reply instead of the host's answer.

Nothing but Tailscale Serve may forward to the listener port. A reverse proxy (Caddy, nginx, socat)
in front of 8765 would pass a forged `Tailscale-User-Login` header through. This check should fail
(connection refused or 401), never return 101:

```sh
curl -s --noproxy '*' --http1.1 -m 3 -o /dev/null -D - -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Tailscale-User-Login: forged@example.com" "http://$(tailscale ip -4):8765/acp" | head -1
```

## History and continuity

- Conversations live on the host, outside the vault: `~/Library/Application Support/obsidian-chat/vaults/<vault>-<hash>/sessions/` (macOS;
  `$XDG_DATA_HOME/obsidian-chat/…` on Linux). Host-owned, append-only JSONL; no folder setting.
  Info shows the exact path.
- Records from the old in-vault `.chat/sessions/` are copied there once, verified, and marked
  (`relocated-from-vault.json`); originals stay until you run **Delete old in-vault conversation
  copies**, which removes only those the host holds byte-for-byte.
- Old Markdown chats are found vault-wide by their content/frontmatter on first upgrade and imported
  once; originals are untouched. Command: **Reimport legacy chats (diagnostics)** shows scanned notes,
  candidates, skipped reasons and store count.
- Opening a stored conversation: the host tries the harness's resume/load capability (also after the
  harness command changed). If it can't reattach, a quiet note says your next message will include a
  summary; **Full transcript** and **Start fresh** switch that. Nothing blocks the composer, and the
  conversation record is the same either way.
- History shows no warning tag for conversations that can't reattach: they all continue.

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
| “No stored conversations” | Run **Reimport legacy chats (diagnostics)**; it reports the vault scan and import result. The store path is in Info (Application Support, not the vault); `.chat/sessions/`. |
| Remote shows “unreachable” | Host Obsidian must be running (role Host) and `tailscale serve status` on the host must show the listener port. The remote retries every 15 s while open and immediately when the app returns to the foreground or the network comes back. |
| Auth rejected (401) | Use the host's tailnet name, not its IP (only Serve attaches the identity), and check Allowed Tailscale accounts. Tagged devices get no identity. Auth errors are never retried as network failures. |
| Harness commands fail | Missing credentials/configuration live in the harness, not the plugin; fix them in the harness and use **Restart harness**. |

## What the plugin never does

- No provider SDK, key, model list or model default.
- No custom chat protocol or tool-name dictionary.
- No Markdown transcript writer.
- No second process, listener, daemon or cloud service.

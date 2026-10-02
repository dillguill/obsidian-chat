# Obsidian Chat

An Obsidian plugin that puts an AI agent in your vault: chat on desktop or phone, with the agent
reading, searching and editing notes through tools you approve.

**What you need:** Obsidian and an agent harness that speaks the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP), such as opencode, Gemini CLI or
Goose. Nothing else: no extra plugins, no background services, no Node install.

## How it works

```
Phone / other desktop ──HTTP/SSE──┐
                                  ▼
               Obsidian on the host computer (this plugin, host mode)
                 ├─ runs the harness as a child process, speaking ACP over stdio
                 ├─ relays the chat to every device (replay on reconnect)
                 └─ serves the vault to the harness as MCP tools (loopback only)
```

- **One computer is the host.** Turn on *Settings → Obsidian Chat → Host on this device*, and set
  the harness command (default `opencode acp`). Obsidian starts the harness when it opens and
  stops it when it quits, and restarts it if it crashes.
- **Other devices are clients.** Pair one under *Host → Paired devices*, then enter the host
  address (e.g. `http://100.x.y.z:8765` over Tailscale or your LAN) and the device code in that
  device's settings.
- **The harness owns the model.** Pick providers and models in the harness's own config; the
  plugin never sees API keys. Switch harness by changing the command.

Vault tools the harness gets: `list`, `read`, `search`, `write`, `append`, `edit`, `move`,
`delete` (to trash). Folders on the blacklist are invisible to them.

Harnesses without native ACP support work through their ACP adapter; set the adapter's command as
the harness command. For example, Claude Code uses
[`@zed-industries/claude-agent-acp`](https://www.npmjs.com/package/@zed-industries/claude-agent-acp).

## Build & install

```bash
npm install
npm run plugin:build      # typecheck + bundle → plugin/main.js
bash plugin/install.sh    # copies main.js/manifest.json/styles.css into the vault
```

`install.sh` copies rather than symlinks, so re-run it after every build and reload the plugin.

## Repo layout

```
plugin/   The Obsidian plugin (TypeScript + esbuild)
  src/host/   host mode: HTTP/SSE server, ACP stdio peer, vault MCP server
  src/acp/    the chat client every device uses
  src/ui/     chat view
docs/     Architecture and history
specs/    Feature specs
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

## License

MIT

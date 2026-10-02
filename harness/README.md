# harness — ACP bridge + MCP rules proxy

Two long-lived processes run here on the always-on host, replacing the old
`gateway.mjs`/`relay-worker.mjs`/`lra-tools.mjs`/`echo-worker.mjs` stack (see
`specs/001-acp-mcp-migration/`):

- **`acp-bridge.mjs`** — spawns the configured ACP harness locally and fronts
  it over HTTP/SSE for the plugin, with per-device auth and replay-on-reconnect.
- **`mcp-rules-proxy.mjs`** — sits between the harness and the vault's MCP
  server, enforcing folder-blacklist and `.chat/rules.md` exclusions (the one
  named exception in Constitution Principle III beyond the bridge itself).

## Prerequisites

1. **Obsidian + Local REST API plugin (v5.0+)** running on this host, with its
   built-in MCP server enabled. Note its API key (Settings → Local REST API)
   and confirm it serves `https://127.0.0.1:27124/mcp/`.
2. **One supported ACP harness** installed locally and reachable via a shell
   command:

   | Harness | Example `command` |
   |---|---|
   | opencode | `["opencode", "acp"]` |
   | Claude Code | `["claude", "--acp"]` (see Claude Code's own docs for its current ACP entry point) |
   | Gemini CLI | `["gemini", "--acp"]` (see Gemini CLI's own docs for its current ACP flag) |
   | Goose | `["goose", "acp"]` (see Goose's ACP-provider docs) |

   Whichever `command` you configure is spawned exactly as given — the bridge
   does not special-case any of these by name (Constitution Principle III /
   FR-013). Each harness independently manages its own model-provider
   credentials (Anthropic, OpenRouter, DeepSeek, Ollama, ...); the bridge
   never reads or branches on that.

## Setup

```sh
cp harness.config.example.json harness.config.json   # gitignored — edit for your host
# tokens.json (gitignored) already holds per-device bearer tokens; add one entry per plugin device
npm install
```

`harness.config.json`'s `mcpVaultProxyUrl` should point at wherever
`mcp-rules-proxy.mjs` is listening (default `http://127.0.0.1:8766/mcp/`), and
`lra.baseUrl`/`lra.mcpPath` tell the proxy where the real LRA MCP server is.
The bridge passes `mcpVaultProxyUrl` to the harness via ACP's own
`session/new` `mcpServers` field — this is the standard ACP mechanism for
telling an agent which MCP servers to use for a session, so no separate
per-harness MCP configuration step is needed (Principle I).

## Running these processes

These two processes are **not** started by hand. The always-on Obsidian
desktop app is the server: on whichever machine is meant to be the host,
enable "Host the harness on this device" in the plugin's settings and point
"Harness directory" at this folder. The plugin then spawns `mcp-rules-proxy.mjs`
and `acp-bridge.mjs` as child processes when Obsidian starts and kills them
when Obsidian quits or the plugin reloads — so the harness (and whatever
model/provider config it reads on startup) always reflects the current
`harness.config.json` / harness-native config after a normal app restart,
with no separate service to remember to restart. See
`plugin/src/main.ts`'s `startHostedHarness()`/`stopHostedHarness()`.

For iterating on this code directly, you can still run them by hand instead —
just make sure the plugin's "Host the harness on this device" is off first,
since both would otherwise fight over the same ports:

```sh
npm run mcp-proxy &   # start the rules proxy first
npm run bridge        # then the bridge, which spawns the configured harness
```

## Switching harness or provider

Edit `harness.config.json`'s `command` (harness) or reconfigure that harness's
own provider settings (provider), then restart Obsidian (or reload the plugin)
on the host device so it respawns the harness subprocess with the new config.
No plugin update, no bridge code change (FR-002, FR-006, FR-013) — see
`specs/001-acp-mcp-migration/quickstart.md` Scenario 2 to verify.

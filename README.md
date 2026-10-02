# Obsidian Chat

An Obsidian plugin that turns Obsidian into an **AI research/notetaking IDE** — BYOK AI chat,
grounded retrieval, and a safe tool-calling framework (Claudian/Copilot-style), with a design that
treats mobile as first-class. Personal-use-first; public release deferred.

> Status: **Phases 0–2b complete · re-architected onto ACP/MCP (2026-09).** The harness is now a
> thin ACP bridge + MCP rules proxy, not a custom job/gateway protocol — see
> [`specs/001-acp-mcp-migration/`](specs/001-acp-mcp-migration/) for the spec/plan/tasks, and
> [`docs/PHASE3.md`](docs/PHASE3.md) for prior Phase 3 history (superseded where it conflicts).

---

## Highlights (built)

- **BYOK chat, streaming** — OpenAI-compatible + Anthropic adapters; provider **presets**
  (OpenRouter / OpenAI / Anthropic / Groq / Ollama / Mistral / xAI / OpenCode / Custom) that
  auto-fill base URLs; a model picker that lists all of a provider's models with **pin-to-top**.
- **Research mode** (default) + **Auto / Review / Plan** write-approval modes.
- **Research assistant with tools** — `read_file`, `search_vault` (BM25 relevance), `list_folder`,
  `web_search` (Tavily), and CRUD (`create_note`, `edit_note` w/ diff, `rename_move_file`,
  `create_folder`, `set_property`, `manage_tags`, `delete_file` → trash).
  Vault notes enter a turn only via **`@mention`**, a **tool call**, or **auto mode**.
- **Approval** — write tools are gated (review by default) with persistent per-tool
  **Always allow / Deny / Allow once**; Plan mode previews only.
- **Permissions** — blacklist folders (autocomplete) + `.chat/rules.md` (nearest-wins).
- **Sessions as notes** — saved to a configurable vault folder (default `chat/`).
- **`@`-mention / attach, vision, inline edit (word diff), slash commands, plan mode.**

## The harness: ACP bridge + MCP rules proxy

The always-on machine (`harness/`) runs two small processes instead of a custom job protocol:

- **`acp-bridge.mjs`** spawns whichever ACP-speaking coding agent is configured (opencode, Claude
  Code, Gemini CLI, Goose) and fronts it over HTTP/SSE for the plugin, with per-device auth and
  replay-on-reconnect. Swapping harness or model provider is a config change on the host — no
  plugin or bridge code changes (Constitution Principle II/III).
- **`mcp-rules-proxy.mjs`** sits between the harness and the vault's MCP server (Obsidian's Local
  REST API plugin's built-in MCP, `/mcp/` since v5.0) and enforces the folder-blacklist
  access-control gate that LRA's own MCP server doesn't know about.

See [`harness/README.md`](harness/README.md) for setup and
[`specs/001-acp-mcp-migration/`](specs/001-acp-mcp-migration/) for the full design.

## Repo layout

```
plugin/    Obsidian plugin (TypeScript + esbuild). Build → plugin/main.js
harness/   Always-on machine: ACP bridge + MCP rules proxy (launchd + Tailscale)
spikes/    Phase 0 spikes (g3-phone, g6-retrieval, …)
docs/      Phase + gate docs (historical; PHASE3.md superseded by specs/001-acp-mcp-migration/)
specs/     Spec Kit feature specs (spec/plan/tasks per feature)
PLAN.md    Master plan (decisions, architecture, phases) — historical, see specs/ for current work
```

## Build & install (plugin)

```bash
cd plugin
npm install
npm run build        # tsc -noEmit + esbuild → main.js
bash install.sh      # COPIES main.js/manifest/styles.css into the vault
```

> ⚠️ `install.sh` **copies**, not symlinks. After every build you must re-run
> `bash install.sh` (in `plugin/`) and reload/toggle the plugin in Obsidian, or changes won't
> appear.

## Harness (dev)

```bash
cd harness
cp harness.config.example.json harness.config.json   # gitignored — edit for your host
npm install
npm run mcp-proxy &
npm run bridge
```

See [`harness/README.md`](harness/README.md) for full setup (LRA MCP prerequisite, per-device
tokens, switching harness/provider).

## Docs

- [`specs/001-acp-mcp-migration/`](specs/001-acp-mcp-migration/) — current architecture: spec, plan, tasks.
- [`PLAN.md`](PLAN.md) — earlier master plan (historical; superseded where it conflicts with the spec above).
- [`docs/PHASE3.md`](docs/PHASE3.md) — Phase 3 spec + plan (historical).
- [`docs/PHASE1.md`](docs/PHASE1.md) · [`docs/PHASE2A.md`](docs/PHASE2A.md) · [`docs/PHASE2B.md`](docs/PHASE2B.md) — phase status.
- [`docs/G1-scorecard.md`](docs/G1-scorecard.md) · [`docs/G8-mobile-constraints.md`](docs/G8-mobile-constraints.md) — gates.
- [`SPIKES.md`](SPIKES.md) — Phase 0 spike log.

## License

MIT (personal-use-first; see PLAN.md §2.8).

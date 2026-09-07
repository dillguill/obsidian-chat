# Obsidian Chat

An Obsidian plugin that turns Obsidian into an **AI research/notetaking IDE** — BYOK AI chat,
grounded retrieval, and a safe tool-calling framework (Claudian/Copilot-style), with a design that
treats mobile as first-class. Personal-use-first; public release deferred.

> Status: **Phases 0–2b complete · Phase 3 (harness + mobile) in progress.** See
> [`docs/PHASE3.md`](docs/PHASE3.md) for the full spec + plan.

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

## The missing piece: the harness (Phase 3)

The always-on machine **gateway + ephemeral workers** (`harness/`) lets the phone start a
long-running research job and "walk away". The gateway scaffold exists; the **job layer /
agentic worker is the remaining work**. True token streaming for providers that block browser
CORS (e.g. OpenCode) also routes through this harness SSE relay.

## Repo layout

```
plugin/    Obsidian plugin (TypeScript + esbuild). Build → plugin/main.js
harness/   Always-on machine gateway (launchd + Tailscale) + ephemeral workers
spikes/    Phase 0 spikes (g3-phone, g6-retrieval, …)
docs/      Phase + gate docs; PHASE3.md = current spec/plan
PLAN.md    Master plan (decisions, architecture, phases)
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
# start the gateway (Tailscale bind + bearer tokens). Dev: --bind 127.0.0.1
node src/gateway.mjs --bind 127.0.0.1
# provider env lives in com.obsidianchat.gateway.plist (PROVIDER_BASE_URL / PROVIDER_API_KEY)
```

## Docs

- [`PLAN.md`](PLAN.md) — master plan: feature matrix, architecture, phases, open questions.
- [`docs/PHASE3.md`](docs/PHASE3.md) — Phase 3 spec + plan (current state, tool framework, harness).
- [`docs/PHASE1.md`](docs/PHASE1.md) · [`docs/PHASE2A.md`](docs/PHASE2A.md) · [`docs/PHASE2B.md`](docs/PHASE2B.md) — phase status.
- [`docs/G1-scorecard.md`](docs/G1-scorecard.md) · [`docs/G8-mobile-constraints.md`](docs/G8-mobile-constraints.md) — gates.
- [`SPIKES.md`](SPIKES.md) — Phase 0 spike log.

## License

MIT (personal-use-first; see PLAN.md §2.8).

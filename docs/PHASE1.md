# Phase 1 — Dual-path grounded chat (status)

> Built 2026-09-02. Goal: ship something usable daily on desktop *and* phone with one codebase and two designed layouts. Exit = grounded Q&A with citations on desktop (direct provider) and phone (gateway), verified.
> **Status: COMPLETE.** The plugin has evolved since (see "Changed since" at the bottom): a preset-based provider model, a configurable `chat/` session folder, and a tools-first grounding policy in Research mode.

## What was built

### Obsidian plugin (`plugin/`) — TypeScript + esbuild, MIT
- **Two-layout UI** (`src/ui/chat-view.ts` + `styles.css`): one `ChatView` (ItemView); desktop = docked pane, mobile = full-screen workspace with safe-area padding. Responsive via `.oc-view` CSS (media query on width).
- **Provider-neutral chat core** (`src/chat/`):
  - `types.ts` — `ChatRuntime`, `ChatMessage`, `StreamEvent` (with first-class `reasoning` from G7).
  - `openai-compat.ts` — OpenAI-wire streaming (DeepSeek/OpenRouter/OpenAI/Ollama), parses `delta.reasoning` + `delta.content`.
  - `anthropic.ts` — Anthropic Messages streaming (`content_block_delta`, `thinking_delta`).
  - `gateway.ts` — harness client reusing the G4-provost v6 reconnect (exponential backoff, retry cap 8, 404 stop, `last-event-id`).
  - `engine.ts` — ChatEngine: grounds a turn, streams, bounded read-only tool loop (dormant by default; grounding is primary).
  - `ground.ts` — builds system prompt w/ `[[wikilink]]` citations + vault rules.
- **Retrieval cascade** (`src/retrieval/`): `cascade.ts` (BM25-lite + conditional single-hop wikilink boost, from G6), `index.ts` (lazy in-memory vault index, auto-invalidated on vault events).
- **Tool contract v1 (read-only)** (`src/tools/`): `read_file`, `search_vault`, `list_folder` as JSON-schema; `runner.ts` executes locally against the vault.
- **Sessions as notes** (`src/session/store.ts`): one note per session, YAML frontmatter (model/provider/timestamps/tokens) + readable body.
- **Settings** (`src/settings.ts`): BYOK provider manager (OpenAI-compat/Anthropic/Ollama) with quick-add (DeepSeek/OpenRouter/Ollama), gateway (base URL + device token + model), grounding knobs. Keys for direct-BYOK stored here; gateway path never needs keys on the host.

### Thin gateway v1 (`harness/`)
- `src/relay-worker.mjs` — ephemeral worker that forwards a **grounded completion** to a provider using keys on the machine (env `PROVIDER_BASE_URL`/`PROVIDER_API_KEY`). G3-compat echo retained.
- `src/gateway.mjs` — default worker changed to `relay-worker.mjs`.
- `com.obsidianchat.gateway.plist` — launchd updated with provider env (placeholder key to replace).
- Verified end-to-end: `POST /sessions` → `POST /input` (completion) → `GET /events` (SSE tokens) → `DELETE`; relay streamed `GATEWAY OK` from OpenRouter.

## Verification
- `plugin` typechecks clean (`tsc --noEmit`) and builds a 40 KB `main.js`.
- Plugin installed via `plugin/install.sh` into the vault and **loaded** — `obsidian-chat:open-chat` command registered (confirmed via LRA `/commands/`).
- Gateway round trip proven from the harness machine; cascade ranks the exact Calibre note + surfaces the linked hub via graph boost.
- LRA still up (200); Obsidian running; vault left with no probe files.

## How to use
1. Configure providers + gateway token in Settings → Obsidian Chat (or quick-add).
2. Open via the ribbon/command. Ask a question — it ground-retrieves and cites notes as `[[wikilinks]]`.
3. Desktop uses direct provider (BYOK); mobile auto-uses the gateway if configured.
4. Rebuild after edits: `npm run plugin:build && bash plugin/install.sh` (or `npm run -w obsidian-chat-plugin dev` for watch).

## Notes / deferred to Phase 2a+
- **Phone path persists sessions?** Desktop persists; the gateway (phone) path currently streams without persisting the session note — add a running conversation tracker in `sendViaGateway` to persist on `done`.
- **Read-only tool loop** is defined + executed but dormant (grounding is the default). Wire the agentic loop in Phase 2a when tools matter more.
- **Provider keys**: the OpenRouter key used here for testing was flagged for rotation — replace `PROVIDER_API_KEY` in the plist and the plugin's direct-BYOK key.
- **Production gateway**: run with `--tls` bound to the Tailscale IP (`tailscale ip -4`) + provider env, not the dev `--bind 127.0.0.1`.
- **LRA tool-set worker** (agentic tool execution via the Local REST API) is Phase 3; the Phase 1 worker is a pure relay.

## Changed since (Phase 3 / 2026-09-03)
- **Provider model** replaced the OpenAI-compat/Anthropic/Ollama quick-add with **presets** (openrouter/openai/anthropic/groq/ollama/mistral/xai/opencode/custom) that auto-fill base URLs; the model picker lists all of a provider's models with pin-to-top.
- **Sessions** now save to a configurable vault folder (default `chat/`), not a fixed `Obsidian Chat/`.
- **Grounding policy** is tools-first in **Research mode** (`groundingMode: "tools" | "auto"`): notes only enter via `@mention`, a tool call, or auto mode. `search_vault` uses the BM25 relevance cascade; blacklist folders + `.chat/rules.md` added.
- **Session persistence** added to the gateway path (phone) via `handleStreamEvent` on `done` (previously deferred).
- The provider adapters now handle `delta.reasoning_content`, set `max_tokens`, fall back to `requestUrl` for CORS, send a browser `User-Agent` for Cloudflare, and wrap tools in the OpenAI wire format.
- See `docs/PHASE3.md` for the full spec.

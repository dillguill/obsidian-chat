# Phase 2b — Search, vision, commands + UI pass (status)

> Built 2026-09-02. Goal: the chat becomes a full Open WebUI replacement, grounded in the vault. Exit = anything you'd take to Open WebUI works better here.

## UI/UX pass (done first, per request) — a clean, reference-plugin-inspired interface

Redesigned to a **workspace-style chat** matching the reference plugin (no bubbles/avatars — a flowing transcript), adapted from the original card layout after review.

**Layout (`src/ui/chat-view.ts` + `styles.css`):**
- **Header**: ✳ app name + a history (🕘) menu and "＋" new-session button.
- **Transcript**: continuous, top-aligned text flow. Inline **tool rows** (icon + "Read:/Edit: file.md" + a ✓ checkmark or a `+18 -1` diff count); **"Thought for Xs"** reasoning blocks in a warm accent; streaming caret.
- **Context chips**: retrieved/attached notes shown as pills above the composer, each dismissible (×).
- **Composer**: a rounded input box (two-line placeholder) with a "↑" send button and a bottom **toolbar**: model selector (dropdown of configured providers), `Thinking: Low` toggle, and a **Yolo** (auto-apply) toggle.
- **Workspace split**: on **desktop** it opens as a **right-docked sidebar** (`getRightLeaf(false)`); on **mobile** it opens as a **full-page leaf**.

**Verified**: typecheck clean, production build OK, plugin reloads in Obsidian with `obsidian-chat:open-chat` registered; `preview.html` mock updated to match.

## Remaining Phase 2b features (next)
- Web search: **Tavily** behind a pluggable `SearchProvider` (harness-side by default — key stays on the machine; cited results).
- Slash commands / **skills** (`/summarize`, `/file-this`, custom), plan-mode toggle.
- **Vision**: image paste/attachment → multimodal provider (mobile capture).
- **Inline edit**: select text → word-level diff → apply.

## Progress since (done this pass)

### Web search (Tavily) — `src/search/tavily.ts`
- `SearchProvider` interface + `createTavilyProvider` using Obsidian's `requestUrl` (privileged, no CORS — works on desktop and mobile/webview).
- Added `web_search` tool to the contract and wired it through the runner (external tool, executed via the provider when a Tavily key is set + enabled in settings).
- Settings section: enable toggle + Tavily API key.

### Plan mode + approval-mode picker
- Header **mode button** cycles Auto → Review → Plan (amber highlight when Plan). Plan mode previews writes but never applies (the approval modal already has a preview-only path).

### Slash commands
- Autocomplete menu while typing `/` (filtered, arrow-key navigation, Enter/click to run).
- Commands: `/clear` (new session), `/plan` `/review` `/auto` (approval mode), `/web <query>` (Tavily search), `/help`.

**Verified**: typecheck clean, build OK, plugin reloads in Obsidian with `obsidian-chat:open-chat` registered; `preview.html` mock updated with the mode toggle.

## Vision + inline edit (done next pass, 2026-09-03) — 2b is complete

### Vision / image attachments
- `ChatMessage.images?: ImageAttachment[]` (`dataUrl`/`mediaType`/`name`) in `chat/types.ts`; `content` stays a string so nothing breaks.
- Both provider adapters emit multimodal content blocks: OpenAI-compat uses `image_url`; Anthropic uses a base64 `source`.
- `ChatEngine.ask(userText, systemContext?, images?)` attaches images to the user message; gateway path forwards them.
- Composer: paste handler (clipboard image → data URL), an attach chip in the toolbar with **From device…** (file input) and **From vault…** (in-vault image picker, `vaultFileDataUrl` base64 helper), pending-image pills with thumbnails + ×, and user-message thumbnail display.
- Attach chip is gated per-provider by a new `ProviderConfig.vision` flag (toggle in Settings; default on). Hidden when the active model doesn't support images.
- Session notes store a placeholder (`![image: name]`) rather than base64.

### Inline edit (word-level diff)
- `ui/diff.ts`: word-level LCS diff producing `keep/add/del` segments rendered as `<ins>`/`<del>`.
- `ui/inline-edit.ts`: select a passage in a note → prompt for an instruction → rewrite via the active provider (tools disabled) → word-level diff → apply. Respects approval mode: **auto** applies immediately; **review** shows diff + Apply/Discard; **plan** shows diff, Apply disabled.
- Wired as command `obsidian-chat:inline-edit` + an editor context-menu item (`Inline edit with Obsidian Chat`).

### `@`-mention / attach (2026-09-03)
- Type `@` at a word boundary to open the **native Obsidian `SuggestModal`** (the Quick Switcher file-search component) listing vault notes + image attachments. `activeMention` is value-based (matches the `/` mechanism). `mentionArmed` avoids re-opening after a cancelled mention.
- Selecting a **note** inserts `[[Note Name]]` inline; the note's content is force-attached to grounding (`extractWikilinks` in `chat/ground.ts`) on send, plus shown as a context chip.
- Selecting an **image** adds it as a vision attachment pill (no vision gate, so the pill always shows).
- `ui/mention.ts`: `NoteMentionModal extends SuggestModal`; `maybeOpenMention`/`applyMention` in `ui/chat-view.ts`. Styled via `.oc-mention-icon`/`.oc-mention-label`.
- **Build note:** the plugin is installed by **copying** (`bash plugin/install.sh`), not a symlink — after `npm run build` you MUST run `bash plugin/install.sh` and reload Obsidian, else changes never appear.

**Verified**: `tsc` clean, production build OK (`main.js` ~100K), installed to the vault. `Phase 2b is complete` → next is **Phase 3**.

## Next: Phase 3 (harness power + mobile polish)
Full harness service (ACP worker sessions, job queue, health indicator, folder-scoped rules, share-sheet capture, touch polish).

## Post-2b decisions (2026-09-03)
- **Chat storage:** sessions now save to a **user-configurable vault folder** (default `chat/`),
  via a `chatFolder` setting (`persistSession`/`showHistory` read it). Previously hardcoded
  `Obsidian Chat/`.
- **Provider model:** preset `ProviderType` (openrouter/openai/anthropic/groq/ollama/mistral/xai/opencode/custom)
  with auto-filled base URLs; model picker lists **all** of a provider's models with pin-to-top.
- **Research mode + grounding policy:** `groundingMode: "tools" | "auto"` (default `tools`).
  Notes enter a turn only via `@mention`, a tool call, or auto mode — no automatic note injection.
  Read tools always on; write tools approval-gated; per-tool allow/deny; blacklist folders;
  `.chat/rules.md` nearest-wins.
- **Provider/network stack (implemented):** `requestUrl` fallback for CORS, browser
  `User-Agent` for Cloudflare, OpenAI-wrapped `tools`. Providers that block CORS (OpenCode)
  reply all-at-once; true streaming comes from the harness SSE relay (Phase 3).

See `docs/PHASE3.md` for the full Phase 3 spec + plan.


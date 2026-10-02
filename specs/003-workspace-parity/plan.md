# 003 — Workspace Parity: implementation plan

> Audience: an implementing agent with **no prior context** on this conversation. Everything needed to build is below; do not re-derive decisions. Where a value, string, or behaviour is specified, implement it **exactly as written** — the specification effort has already been done.
> Status: **approved scope** (2026-09-13). Supersedes nothing; builds on `specs/002-acp-only-chat-ux` (ACP-only chat is complete in code).

---

## Implementation status (2026-09-13)

Built and verified: `npx tsc --noEmit` clean at every step; `main.js` 144 KB; `plugin/install.sh` copied to the vault (reload Obsidian to load).

- **W1 tool activity — done.** `chat/types.ts` (ActivityItem/ToolStatus/PlanEntry/UsageInfo + new stream variants), new `chat/tool-input.ts` (bounded input sanitiser + target picker), new `ui/activity.ts` (name→verb→icon→label, `applyToolEvent` merge, group label/diff), activity groups + rows + CSS. `plan` no longer fakes a tool row.
- **W2 composer/mobile — done.** Viewport-capped JS autosize (`max(150, innerHeight×0.55)`) recomputed on resize/visibility/send; measured `ToolbarLayout` compact mode replacing the media query; scroll pinning + jump-to-latest; queue/steer draining at turn end; `sendShortcut` setting; Esc cancels.
- **W4 plan/usage — done (usage live).** Plan checklist renders in place (dormant: opencode emits no plans); context/cost meter wired to the real `usage_update` (27k/200k observed in P0).
- **W6 aesthetic — done.** Welcome state with recent sessions; user hairline; shared activity rail; typography + tabular numerals; per-kind icons; turn hairline; motion + reduced-motion guard; focus-visible, ARIA and keyboard toggles; density setting with an Interface settings section.
- **W7 functional — done.** Activity trail persisted (`<!-- oc-activity-b64: … -->`) and replayed collapsed; changes card with per-file Undo / Undo all backed by pre-write snapshots; code-block copy buttons; message Copy/Quote (+ long-press menu on touch); Regenerate (same-session re-ask, labelled as such); connection banner + `connection-info` modal and command; mobile touch targets; `[[` reference-only wikilink trigger; drag-and-drop attach.
- **W5 stack cleanliness — proxy fixed, docs pending.** `mcp-rules-proxy.mjs` now uses the exact 16-tool `PATH_FIELDS` table captured live from LRA. `harness.config.json` and the plugin default blacklist now mirror the vault's own `AGENTS.md` mandate (`Journals/`, `_attachments/`, `.trash/`) — **behaviour change, flagged to the user**.
- **Still to do:** `docs/ARCHITECTURE.md`; spec-002 `tasks.md` reconciliation; and the manual verification passes in §1.6/§2.6/§3.8/§7.14 on real hardware. The running harness was **not** restarted, so the live proxy is still the pre-change build until Obsidian/the harness is reloaded.

---


## 0. Ground rules for the implementer

### 0.1 Product truths (do not violate)
- The plugin is a **thin view over the ACP harness**. It renders whatever the harness streams (`session/update` events); it owns no model logic, makes no model calls, executes no vault tools. Session notes, undo snapshots, the `@mention` index, and rules-file reads are the **only** local vault access allowed.
- No new UI primitives: menus are Obsidian `Menu`; pickers are `SuggestModal`/`FuzzySuggestModal`; icons are `setIcon`; colours come from Obsidian CSS variables; no avatars, no bubbles, no custom scrollbars, no new npm dependencies.
- All new CSS classes use the existing `oc-` prefix.
- Mobile is a first-class target (Obsidian iOS via Tailscale). Desktop is the sanity pass. iPad is out of scope.

### 0.2 Build & verify loop (run after every phase)
```bash
cd plugin && npx tsc -p tsconfig.json --noEmit && node esbuild.config.mjs production
cd .. && bash plugin/install.sh        # COPIES main.js/styles.css into the vault — not a symlink
```
Then in Obsidian: command palette → "Reload app without saving" (or toggle the plugin off/on). A phase is complete only when typecheck + build + install succeed **and** that phase's manual checks pass.

### 0.3 Current file map (what exists today)
| File | Role |
|---|---|
| `plugin/src/ui/chat-view.ts` | The single hub: header, transcript, composer, toolbar, send path, tool rows, reasoning blocks, permission cards, sessions, mentions, slash menu. ~1400 lines. |
| `plugin/src/acp/client.ts` | `AcpBridgeClient` (HTTP/SSE). `dispatch()` + `mapSessionUpdate()` translate ACP `session/update` → plugin `StreamEvent`. `toolCallContentLines()` parses ACP Diff/Content/Terminal content. |
| `plugin/src/chat/types.ts` | `StreamEvent`, `ChatMessage`, `ImageAttachment`, `Role`. |
| `plugin/src/ui/approval.ts` | `renderApprovalCard()`, `WritePreview`. Returns `handle.settle({allowed, onUndo})`. |
| `plugin/src/ui/acp-picker-menu.ts` | `openAcpPickerMenu(button, items, current, onChoose)` (native `Menu`). |
| `plugin/src/ui/acp-model-suggest.ts` | `AcpModelSuggestModal`. |
| `plugin/src/ui/markdown.ts` | `renderMarkdown(app, el, text, sessionPath, component)`. |
| `plugin/src/ui/mention.ts` | `NoteMentionModal`, `MentionItem` (`@` file search). |
| `plugin/src/ui/image-picker.ts` | `vaultFileDataUrl`, `VaultImagePickModal`, `IMAGE_EXT`. |
| `plugin/src/ui/session-suggest.ts` | `SessionSuggestModal` (history). |
| `plugin/src/session/store.ts` | `metaToFrontmatter`, `renderBody`, `approxTokens` — session notes as Markdown. |
| `plugin/src/settings.ts` | `ObsidianChatSettings`: `chatFolder`, `blacklistFolders`, `injectVaultRules`, `gateway{baseUrl,token}`, `toolAllowlist`. |
| `plugin/src/retrieval/index.ts` | `VaultIndex` (read-only BM25 for `@mentions`). |
| `plugin/styles.css` | All styling. Section-commented; classes `oc-*`. |
| `harness/src/acp-bridge.mjs` | HTTP/SSE bridge (spawns `opencode acp`, relays `session/update`, permissions). |
| `harness/src/mcp-rules-proxy.mjs` | MCP proxy → LRA `https://127.0.0.1:27124/mcp/`; enforces folder blacklist. |

### 0.4 ACP facts (verified against `node_modules/@agentclientprotocol/sdk/schema/schema.json`)
- `ToolCall` fields: `toolCallId`, `title`, `name`, `kind`, `status`, `content`, `locations`, `rawInput`, `rawOutput`, `_meta`. **There is no `parentToolCallId`** → subagent nesting is deferred (§8).
- `ToolKind`: `read | edit | delete | move | search | execute | think | fetch | switch_mode | other`.
- `ToolCallStatus`: `pending | in_progress | completed | failed`.
- `Plan` update: `entries: [{ content, priority: high|medium|low, status: pending|in_progress|completed }]` — replaced wholesale on every update.
- `UsageUpdate`: `{ used: number, size: number, cost?: { amount: number, currency: string } }`.
- `SessionInfoUpdate`: `{ title?: string | null, updatedAt?: string | null }`.
- `PermissionOptionKind`: `allow_once | allow_always | reject_once | reject_always`.
- Today `mapSessionUpdate()` **fakes** `plan` as a completed tool row and **drops** `usage_update`/`session_info_update`. Both change in W4.

---

## 1. W1 — Tool activity rework

**Outcome:** a turn reads as *reasoning → actions → answer*, actions collapsed behind one line, each row says what it *did*, nothing is vague.

### W1.1 Extend the stream model first (foundation)
- `plugin/src/chat/types.ts`:
  - Extend the `tool_call` `StreamEvent` variant with: `rawName?: string`, `rawInput?: unknown`, `locations?: { path: string; line?: number }[]`, `rawOutputPreview?: string` (stringified `rawOutput`, ≤400 chars), `title?: string` (currently `name` carries `tc.title` — keep `name`, add `title` as an alias for clarity only if `name` proves ambiguous; prefer renaming `name` → `title` and adding `rawName`).
  - Add variants: `{ type: "plan"; entries: PlanEntry[] }` and `{ type: "usage"; used: number; size: number; cost?: { amount: number; currency: string } }` and `{ type: "session_info"; title?: string | null; updatedAt?: string | null }`.
- `plugin/src/acp/client.ts` `mapSessionUpdate()`:
  - `tool_call` / `tool_call_update`: pass the new fields through, **with the confirmed opencode behaviour baked in** (P0 probe, §10):
    - `kind` is **always `"other"`** for MCP tools → never derive the verb/icon from `kind`; derive from the cleaned **title** (W1.2) and use `kind` only as a fallback.
    - `title` carries the raw tool name (`vault_vault_read`); it is present on the initial `tool_call` and on the `in_progress` update but **absent on `completed`** → keep the last-seen value (existing behaviour).
    - `rawInput` is **empty on the initial `tool_call`** and arrives on the first `tool_call_update` (`{"path":"AGENTS.md"}`) → the row must update its label when it lands.
    - `locations` is **always `[]`** → targets come from `rawInput`; keep `locations` only as a fallback.
    - `content` on a completed read is a **Content variant holding a ~20 KB JSON string** → **do not** attach `contentLines` for non-edit tools (no label/row uses them and the plan's detail expansion is out of scope). Attach `contentLines` only when the payload contains a `Diff` variant (for the diff stat). The permission-card path keeps calling `toolCallContentLines()` for its own diff.
    - Cap `rawOutputPreview` at 400 chars; never pass `rawOutput` through unbounded.
  - `plan` → `{ type: "plan", entries }` (delete the current fake-tool-row mapping).
  - `plan_update` → same as `plan` (unstable but identical shape; treat as replacement).
  - `usage_update` → `{ type: "usage", used, size, cost }`.
  - `session_info_update` → `{ type: "session_info", title, updatedAt }`.
- `plugin/src/acp/client.ts` `dispatch()`: no other changes — the bridge already relays everything.

### W1.2 Activity data model (used by W1, W7.5, W7.6)
- New file `plugin/src/ui/activity.ts`:
  - `export interface ActivityItem { id: string; kind: ToolKind | "other"; rawName: string; label: string; target?: string; path?: string; status: ToolCallStatus; diff?: { add: number; del: number }; startedAt: number; endedAt?: number; }`
  - `export function friendlyToolName(rawName: string, title?: string): string` — input is the ACP **`title`** (the only field opencode populates; `name` is absent). Cleaning order:
    1. strip a leading `mcp__<server>__` segment,
    2. strip repeated leading `vault_` segments (`vault_vault_read` → `read`; the MCP server is registered as `vault`, so its tools arrive double-prefixed),
    3. map the confirmed LRA tool set (P0 probe) to friendly labels:
       `list|vault_list`→`List` · `read|get_document_map|active_file_get_path`→`Read` · `write|append`→`Write` · `patch`→`Patch` · `delete`→`Delete` · `move|copy`→`Move` · `search_query|search_simple|search`→`Search` · `tag_list`→`Tags` · `command_list|command_execute`→`Command` · `open_file`→`Open`,
    4. fallback: underscores → spaces, capitalise first letter (cap 40 chars).
    Unknown names must still render sensibly (step 4) — never blank.
  - `export function toolTarget(rawInput: unknown, locations?: {path:string}[]): string` — first non-empty string found in `rawInput` keys in this order: `path, file_path, filePath, file, targetPath, destination, url, query, pattern, command, description`; else `locations?.[0]?.path`; else `""`. (`destination` matters for `vault_move`/`vault_copy`.)
  - `export function toolLabel(item)` — display string: for file-ish targets show **basename** (tooltip keeps full path); for search/execute/fetch show the raw value truncated to 60 chars with `…`.
  - `export function diffStat(lines: string[]): { add: number; del: number }` — count `+`/`-` prefixed lines, **ignoring** `+++`/`---` header lines. Reuse/absorb `diffStatFromLines()` from `chat-view.ts` and delete the duplicate.
  - `export function verbFor(name: string, kind: string | undefined, status: string): string` — gerund while `pending|in_progress`, past tense when `completed|failed`. Primary lookup by cleaned **name**, fallback to `kind`:
    `list: Listing/Listed · read: Reading/Read · write|append: Writing/Wrote · patch: Patching/Patched · delete: Deleting/Deleted · move|copy: Moving/Moved · search: Searching/Searched · execute: Running/Ran · think: Thinking/Thought · fetch: Fetching/Fetched · switch_mode: Switching mode/Switched mode · other: Running/Ran`.
  - `export const TOOL_ICONS: Record<string, string>` — **name-first** icon map (kind is `other` in practice): `list: "folder"`, `read: "book-open"`, `write: "file-plus"`, `append: "file-plus"`, `patch: "pencil"`, `edit: "pencil"`, `delete: "trash-2"`, `move: "folder-symlink"`, `copy: "copy"`, `search: "search"`, `tag_list: "tags"`, `command: "terminal-square"`, `open_file: "file-text"`, `think: "brain"`, `fetch: "globe"`, `switch_mode: "shuffle"`, `other: "wrench"`. Lookup order: cleaned name → `kind` → `wrench`. Error rows always use `alert-triangle` in `var(--color-red)`.

### W1.3 Activity group rendering (replaces always-open tool rail)
- DOM (all inside `this.messagesEl`, in transcript order):
  ```
  div.oc-activity                       ← one per consecutive run
    button.oc-activity-header           ← role=button, tabindex=0, aria-expanded
      span.oc-activity-icon             ← spinner (running) / check (done) / alert (failed)
      span.oc-activity-label            ← "Working…" | "3 steps · 12s" (+ " · 1 failed")
      span.oc-activity-diff             ← optional "+8 −2" (tabular nums)
      span.oc-activity-chevron          ← chevron-down / chevron-right
    div.oc-activity-body                ← hidden when collapsed
      div.oc-tool (one per call, see W1.4)
  ```
- **Group boundaries:** a group opens on the first `tool_call` when none is open; it closes (collapse + freeze) when a `token`, `reasoning`, `plan`, `done`, or `error` event arrives (same boundary rules as reasoning bursts today, see `handleStreamEvent`'s existing `finalizeThought()`/`currentToolThreadEl = null` resets). Consecutive tool calls stay in the same group.
- **While running:** header shows `Working…`; the body stays **expanded** and the header's label line additionally mirrors the newest row: `Reading Inbox/Seed.md` (verb + label, truncated 80). Ticking elapsed timer in the header is allowed only if trivial: reuse the technique in `addThoughtDelta()` (`window.setInterval`, cleared on finalize); label format `Working… 4s`.
- **On completion:** body collapses; header label becomes `{n} step · {d}s` / `{n} steps · {d}s` (omit `· {d}s` when `d < 1`); append ` · 1 failed` (red) when any row failed; append ` · +a −b` (green/red spans) when the group contains edit diffs. Group stays collapsed on click-toggle; state is per-DOM, not persisted live (replay handles reopening, W7.5).
- **Errors:** a failed tool call forces the group **open** and stays open. `error` events (transport-level) remain standalone rows exactly as today (`addToolRow("error", …)`), never inside a group.
- **Interactive calls never group:** if `kind === "switch_mode"` or the tool asks a question (title/name matching `/ask|question/i`), render it as a standalone row outside the group and do not pool the following calls into the previous group.
- Permission/approval cards remain exactly as today (separate inline cards).

### W1.4 Tool row spec
- DOM:
  ```
  div.oc-tool[.oc-tool-error]
    span.oc-tool-icon        ← setIcon(TOOL_ICONS[kind])
    span.oc-tool-verb        ← verbFor(...)   e.g. "Read"
    span.oc-tool-label       ← toolLabel(item) e.g. "Seed.md"
    span.oc-tool-right       ← diff stat (+8 −2) for edits; time for slow calls (≥10s: "12s"); hidden otherwise
  ```
- Behaviour:
  - Live updates by `toolCallId` (keep the existing `toolRows` Map pattern; an update re-renders only changed spans).
  - Click on `oc-tool-label` when `item.path` resolves via the existing `resolveVaultFile()` → `this.app.workspace.getLeaf(false).openFile(file)`. Add `cursor: pointer` + `title` = full path only when resolvable.
  - Hover tooltip on any row: full detail line `Read · Inbox/Seed.md · 1.2s` (plain `title` attribute — no custom tooltips).
- Delete the old `oc-tool-thread` rail markup; `oc-tool-thread` class is retired.

### W1.5 CSS
- Remove `.oc-tool-thread` rules.
- Add: `.oc-activity { margin: 8px 0; }`, `.oc-activity-header { display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; width:100%; background:none; border:0; text-align:left; color:inherit; }`, `.oc-activity-label { font-size:13px; font-weight:500; color: var(--text-accent, var(--interactive-accent)); font-variant-numeric: tabular-nums; }`, `.oc-activity-diff { font-size:12px; font-variant-numeric: tabular-nums; }`, `.oc-activity-body { }`, `.oc-activity[data-expanded="false"] .oc-activity-body { display:none; }`, `.oc-activity[data-expanded="true"] .oc-activity-chevron { transform: rotate(180deg); }` — chevron is `chevron-down`; rotate to point right when collapsed instead (pick one: static chevron-right icon when collapsed, chevron-down when expanded, swap via `setIcon` on toggle — simpler and crisper than transforms).
- `.oc-tool` becomes: `display:flex; align-items:baseline; gap:6px; font-size:13px; color: var(--text-muted); padding:2px 0;` `.oc-tool-icon svg { width:13px; height:13px; }` `.oc-tool-verb { font-family: var(--font-monospace); color: var(--text-accent, var(--interactive-accent)); }` `.oc-tool-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }` (basename labels only, so ellipsis not wrap).

### W1.6 Verification
1. Ask a question that triggers ≥3 vault reads: group appears expanded, header shows live `Working…`, rows show `Read Seed.md` style labels with icons.
2. Wait for completion: group collapses; header `3 steps · Ns`; expand/collapse works via click, Enter, and Space; `aria-expanded` flips.
3. Trigger an edit via the agent: row shows `Edit <name>` and `+a −b`; group header also shows the aggregate diff.
4. Force a failure (e.g. ask for a path that doesn't exist): group opens, failed row shows `alert-triangle` in red.
5. `plan` no longer renders as a "plan" tool row (until W4 lands, plan updates are simply ignored).

---

## 2. W2 — Composer, toolbar, and mobile responsiveness

**Outcome:** the composer grows/shrinks correctly everywhere (including keyboard open/close), the toolbar never crowds or wraps awkwardly, reading position is never yanked, and you can keep typing while the agent works.

### W2.1 Textarea autosize (viewport-capped)
- In `onOpen()`, keep `rows="2"` and the existing input handler, but replace the height logic with a helper:
  ```ts
  private applyComposerHeight(): void {
    const ta = this.composerEl;
    ta.style.height = "auto";
    const cap = Math.max(150, window.innerHeight * 0.55);
    ta.style.height = Math.min(ta.scrollHeight, cap) + "px";
  }
  ```
- Call `applyComposerHeight()` on: `input` event, after `send()` clears the value, on `window.resize`, and on `document.visibilitychange` (mobile keyboard close can fire this). Throttle via `requestAnimationFrame` (one scheduled frame max).
- CSS: `.oc-input { min-height: 44px; max-height: none; overflow-y: auto; }` — the JS cap owns the maximum now (delete `max-height: 240px`).
- Mobile placeholder: in `onOpen()` choose placeholder text by `Platform.isMobile`: mobile = `"Ask anything…"`; desktop keeps the two-line version.
- The send button keeps floating bottom-right; ensure it doesn't overlap the last line by keeping `padding-right: 38px` on the textarea.

### W2.2 Toolbar compact mode (replace the media query)
- Port the reference plugin's measure-don't-guess approach:
  - New small class `ToolbarLayout` **inside `chat-view.ts`** (no new file): constructor takes `toolbarEl`; `refresh()` removes `oc-toolbar-compact`, measures whether items wrapped by comparing each child's `offsetTop`, then adds `oc-toolbar-compact` when any child sits below the first row. Observe with `ResizeObserver` on `toolbarEl` + a `MutationObserver` on its children; disconnect in `onClose()`; schedule via `requestAnimationFrame`.
  - Call `refresh()` after `this.refreshToolbar()` (it already runs on harness state changes).
- CSS: `.oc-toolbar-compact .oc-toolbtn-text { display: none; }` and `.oc-toolbar-compact .oc-toolbtn-chevron { display: none; }` — replaces the entire `@media (max-width: 600px)` label-hiding block. Keep the `font-size: 16px` iOS zoom guard and the touch-target rules in the media query.
- Remove: `.oc-toolbtn-model .oc-toolbtn-text { max-width: 32vw; }` and all label `display:none` rules from the media query (compact mode handles it).

### W2.3 Scroll pinning + jump-to-latest
- Add fields: `private pinned = true; private jumpEl!: HTMLElement;`
- On `messagesEl` scroll: `this.pinned = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;` toggle the jump element's hidden state.
- `scrollToBottom()` → `if (this.pinned) el.scrollTop = el.scrollHeight;` (no smooth scrolling during streaming).
- Jump element: `button.oc-jump` with `arrow-down` icon + text `New`; absolutely positioned inside `.oc-view` (which already has `position: relative`): desktop `right: 18px; bottom: 96px`, mobile same (it must clear the composer — 96px does). Hidden by default (`display:none`), shown when `!pinned`. Click → `this.pinned = true; scrollToBottom(); hide`.
- Sending a message always sets `pinned = true` before appending (explicit user action).

### W2.4 Queue + steer while the agent runs
- Replace `if (!text || this.streaming) return;` in `send()` with: if `streaming`, enqueue and return (never drop).
- Fields:
  ```ts
  private queued: { text: string; images: ImageAttachment[]; textAttachments: { name: string; content: string }[] } | null = null;
  private steerAfterCancel = false;
  ```
- On enqueue: capture the composer's current pending attachments into the queued item, clear the composer (same clearing the normal send path does), render the queue row, and take nothing else from the composer (do **not** echo the user message yet — the transcript only ever shows messages in send order).
- Queue row DOM: `div.oc-queue` rendered as the last child of `this.chipsEl`'s parent area (insert directly above `.oc-composer`, i.e. `c.appendChild` before composer; simplest: create `div.oc-queue` in `onOpen()` between chips and composer, hidden by default).
  - Content: `span.oc-queue-text` = `Queued · <first 60 chars of text>` + `button.oc-queue-send` = "Send now" + `button.oc-queue-x` (icon `x`, aria-label "Discard queued message").
- Sending a second message while queued: replace the queue item and show `new Notice("Queued message replaced")`.
- Drain rules:
  - On normal turn end (`sendViaAcp`'s `finally`): if `this.queued` → capture it, clear queue row, then `void this.sendQueued()` (which echoes the user message + runs the turn). Guard with a `draining` boolean to prevent recursion.
  - "Send now": set `steerAfterCancel = true` and `await this.cancelStreaming()`. In the `finally`, if `steerAfterCancel && this.queued` → skip the normal drain, immediately send the queued item first (steer), then drain any newer queue.
  - The stop button (send button in stop mode) = cancel only; the queue survives; the user discards explicitly via `×`.
- `sendQueued()`: pushes `{role:"user", …}` onto `acpHistory`, calls `addUserMessage(...)`, restores pending attachments, then `await this.sendViaAcp(text)` (same error handling as `send()`).

### W2.5 Enter-behaviour setting
- `settings.ts`: add `sendShortcut: "enter" | "mod-enter"` (default `"enter"`).
- Keydown handler in the composer:
  - `enter`: Enter sends; Shift+Enter newline (today's behaviour).
  - `mod-enter`: Enter inserts a newline; `Cmd/Ctrl+Enter` sends.
  - `Cmd/Ctrl+Enter` always sends regardless of setting.
- Settings tab (W6.9) exposes it as a dropdown: name "Send shortcut", options "Enter" / "Cmd/Ctrl+Enter".

### W2.6 Verification
1. Phone: open keyboard, type 5 lines → composer grows to ~55% of viewport but never taller; close keyboard → shrinks back; send → resets to 2 rows.
2. Rotate the phone to landscape → cap recalculates (no overflow).
3. Desktop: narrow the sidebar until toolbar items wrap → labels disappear *only then*; widen → they return.
4. While a long turn streams, scroll up: transcript stops yanking; `New` pill appears; click → returns to bottom and pill hides.
5. While streaming, send a message → queue row appears; "Send now" cancels the turn and sends it immediately; `×` discards; otherwise it sends automatically when the turn ends.

---

## 3. W3 — Selection & context tooling

**Outcome:** you can point the agent at text/notes the way a workspace chat does — selection, active note, file menu, drag-drop — on desktop and mobile.

### W3.1 "Add selection to chat context" (desktop-first, mobile via command palette)
- New command in `main.ts`: id `add-selection-to-chat`, name "Add selection to chat context", `editorCallback(editor, ctx)`:
  1. `const text = editor.getSelection().trim()`; if empty → `new Notice("No text selected")`; return.
  2. Resolve note path: `ctx instanceof MarkdownView ? ctx.file?.path : app.workspace.getActiveFile()?.path ?? "unknown"`.
  3. Line range: `editor.getCursor("from").line + 1` … `editor.getCursor("to").line + 1`.
  4. Store a `selectedTextContext = { id: uuid-ish (Date.now()+rand), text, notePath, startLine, endLine }` on the plugin/view (see W3.5), then reveal the chat view (reuse the existing reveal/activation pattern used by `open-chat`) and render the chip.
- Editor context menu: register `app.workspace.on("editor-menu", (menu, editor) => { … })` in `main.ts`; add one item "Add selection to chat context" with icon `message-square-plus` that calls the same command. Guard: only add when selection is non-empty.
- Chip: rendered by W3.5; clearing on send.

### W3.2 Active-note chip
- A composer chip (W3.5) representing "include the currently active note". Not automatic by default (unlike Copilot) — exposed as a small toolbar action.
- Add to the composer toolbar, **leftmost**, before the attach button: `button.oc-toolbtn.oc-toolbtn-active-note` with icon `file-text`, label "Current note", `title` "Include the current note in the next message". Click:
  - if a chip already exists → remove it;
  - else if no active `TFile` → `Notice("No active note")`; return;
  - else add chip `{kind:"active-note", path, label: basename}`.
- On send: an active-note chip attaches the note's content as a context block (`# Current note\n[[path]]\n\n<content>`), same mechanism as `@mention` attached content (`attachMentions` path in `buildAcpPromptBlocks`). Cap content at 20,000 chars with a trailing `…[truncated]` marker.
- The chip is one-turn: cleared on send like other attachments.

### W3.3 File-menu integration
- `main.ts`: `app.workspace.on("file-menu", (menu, file) => …)`; for `TFile` only: item "Add to Obsidian Chat" (icon `message-square-plus`) → reveals chat view and adds a `{kind:"note", path, label: basename}` chip (reuse W3.5). No content is read until send; on send, attach like W3.2.
- Folder support: for `TFolder`, item "Mention folder in chat" → chip `{kind:"folder", path, label: basename}`; on send, attaches a path-only block `# Folder\n[[folder-path]]` (the agent reads it via its tools; we never enumerate files in the plugin).

### W3.4 Drag & drop onto the composer
- On `.oc-inputbox`, add `dragover` (preventDefault + `dropEffect = "copy"`), `dragleave`, `drop`:
  - Accept `e.dataTransfer.files`. For each file:
    - image (`IMAGE_EXT` match) → read via `FileReader` as data URL → `addPendingImageFromFile(file)` (existing method; it already handles pill rendering).
    - text (`TEXT_EXT` set in `chat-view.ts`) → read as text → push to `pendingTextAttachments` (existing mechanism; no new code path).
    - `.md` dropped from Obsidian's own file tree arrives as `File` too; treat as text.
  - Reject others silently; if any file was accepted show nothing extra (the chips/pills are the feedback). If none accepted → `Notice("Unsupported file type")`.
  - Visual affordance: on `dragover` add class `oc-drop-active` to `.oc-inputbox` (CSS: `border-color: var(--interactive-accent);`); remove on `dragleave`/`drop`.
- Unsupported on iOS share-sheet (out of scope, §8).

### W3.5 Context chips (shared component)
- Generalise the existing citation chips (`renderChips`, `chipsEl`): introduce a `ContextChip { id: string; kind: "selection"|"note"|"folder"|"active-note"; label: string; sub?: string; tooltip?: string }` array on the view (`private contextChips: ContextChip[] = []`).
- `renderChips()` renders `contextChips` (removal `×` per chip) **and** the existing citation rendering stays as-is for citations (citations are non-removable). Keep the two visually identical (reuse `.oc-chip` classes).
- Chip label rules: selection = `N lines selected` (sub = note basename); note/folder/active-note = basename.
- `buildAcpPromptBlocks()` gains one step before the user text: map `contextChips` → text blocks:
  - selection → `# Selected text\n<editor_selection path="{path}" lines="{start}-{end}">\n{text}\n</editor_selection>` (XML shape copied from the reference plugin's prompt convention),
  - note/active-note → `# Note context\n[[path]]\n\n{content}`,
  - folder → `# Folder reference\n[[path]]`.
  Order: selection blocks, then notes, then folders, then the `@mention` block (existing), then rules (existing), then user text.
- Clear chips in the same `finally` that clears attachments in `send()`.
- On mobile, the selection chip is added via the command palette (Obsidian's native one) — no extra UI needed.

### W3.6 `[[` wikilink autocomplete in the composer
- Extend `activeMention()`: detect either `@query` (existing) **or** `[[query`. Trigger `[[` only when the two chars before the caret are not preceded by another `[` and the caret is not inside an unterminated `[[…` (scan backwards from caret: if a `[[` occurs before caret with no `]]` between, it's still open — that's the trigger case; if a matching `]]` already exists after the caret, do nothing).
- `applyMention()`: when triggered by `[[`, replace from the `[[` position to the caret with `[[{basename}]]` (no space appended) and **do not** force-attach the note content (the note is a reference for the agent to open, matching Copilot's note-mention semantics).
- When triggered by `@`, keep today's behaviour exactly (insert `[[name]]` + force-attach content).
- Menu: reuse `NoteMentionModal` unchanged (it already lists vault files).

### W3.7 Speaker/message action row (copy + quote)
- Each assistant message block gets `div.oc-msg-actions` appended (after render completes, not during streaming):
  - `button` icon `copy` → copies the message's raw markdown (keep the source text on the view's last persisted assistant message; simplest: store `raw` on the block's dataset when rendering).
  - `button` icon `quote` (lucide `quote`) → prefixes the composer with the message text as `> …` blockquote lines, focuses composer, positions caret at end. If the composer has content, prepend a blank line first.
- Visibility: `@media (hover: hover)` → hidden until `:hover`/`:focus-within` on the parent block; touch devices → hidden until long-press; long-press (`contextmenu` event, `preventDefault`) opens an Obsidian `Menu` with the same two items plus "Copy message". This keeps mobile native-feeling and avoids a permanent button row.
- Do the same for user messages (Copy only).

### W3.8 Verification
1. Desktop: select text in a note, right-click → "Add selection to chat context" → chat opens with a `N lines selected` chip; send → agent receives it (ask the agent to quote the selection back).
2. Mobile: same via command palette; chip appears above the composer; `×` removes it.
3. Toolbar "Current note" → chip appears; un-tap removes; send attaches note content.
4. Right-click a file in the file explorer → "Add to Obsidian Chat" → chip; folder → `Mention folder`.
5. Drag a `.md` from the file explorer onto the composer → context block attached; drag a PNG from Finder/iOS Files → image pill.
6. Type `[[See` → file search menu appears; pick a note → `[[Seeds]]` inserted, content **not** attached; type `@See` → same picker, note content attached (existing behaviour preserved).
7. Hover an assistant message (desktop) → Copy/Quote appear; long-press (mobile) → native menu with the same actions; Quote puts the text in the composer as a blockquote.

---

## 4. W4 — Plan & usage surfaces

**Outcome:** the two protocol-native surfaces we currently throw away become visible; nothing is faked.

### W4.1 Plan checklist
- State: `private planEntries: PlanEntry[] | null = null; private planEl: HTMLElement | null = null;`
- On `{type:"plan"}`: replace `planEntries` wholesale (the protocol sends the complete list each time). Render/update `div.oc-plan` **in place** at the position of the first plan update in the current turn; if no element exists yet, append it to the transcript at the current position.
- DOM:
  ```
  div.oc-plan
    div.oc-plan-header           ← "Plan · 2/5" (completed/total) + collapsible chevron
    div.oc-plan-body
      div.oc-plan-row[data-status]   (one per entry)
        span.oc-plan-icon        ← pending: "circle"; in_progress: "loader" (spinner class); completed: "check"
        span.oc-plan-text        ← entry.content (truncate 120 with …)
        span.oc-plan-prio        ← only for high: small accent dot, title "High priority"
  ```
- States: expanded by default while any entry is `in_progress`; auto-collapses once **all** entries are `completed`; user toggle always wins afterwards (track `userToggled` so auto-collapse doesn't fight the user).
- Retention: the plan persists for the session (one element, updated in place across turns). `newSession()` clears it.
- If the harness never sends `plan`, nothing renders — no placeholder.

### W4.2 Usage / context meter
- State: `private usage: { used: number; size: number; cost?: {amount:number;currency:string} } | null = null;`
- On `{type:"usage"}`: store and refresh the meter.
- DOM (created in `onOpen()` as the **last** toolbar child; hidden by default with `oc-toolbtn-hidden`):
  ```
  div.oc-usage (title="1.2k / 128k tokens (12%) · $0.04")
    div.oc-usage-bar > div.oc-usage-fill   ← width = min(100, used/size*100)%
  ```
- Visual: track 48px×4px rounded, `--background-modifier-border`; fill colour: `<70%` accent, `70–89%` `var(--color-orange)`, `≥90%` `var(--color-red)`.
- Mobile: bar only (48px), no text (text lives in the `title` attribute; there is no visible text anyway — keep it that way at all widths for cleanliness).
- Cost: shown in the `title` only when `cost` is present; formatted `amount.toFixed(2)` + `currency` (e.g. `$0.04` → `${currency === "USD" ? "$" : currency + " "}${amount.toFixed(2)}`).
- Hidden entirely until the first `usage_update`.

### W4.3 Verification
1. Ask for a multi-step task → plan panel appears, `in_progress` entry spins, counter updates; on completion it auto-collapses; clicking re-expands; it persists across turns; "New session" clears it.
2. (Depends on opencode emitting usage — see §10.) If emitted: meter appears in the toolbar and updates during the turn; colour thresholds verified by temporarily hardcoding values in a test harness or by observing a large-context turn.
3. If opencode emits neither: both features stay invisible and nothing errors (verify the transcript is unchanged).

---

## 5. W5 — Stack cleanliness

**Outcome:** the "plugin = thin view; harness owns model+tools; desktop exposes MCP" story is true in code and documented.

### W5.1 Fix `mcp-rules-proxy` LRA tool-name mapping
- File: `harness/src/mcp-rules-proxy.mjs`. Today `extractTargetPaths()` guesses path fields from JSON-RPC bodies. Replace with the **confirmed** LRA tool table (captured live in P0 — no schema scanning needed; keep the fetch as a startup assertion only):

| Tool | Path-bearing input fields |
|---|---|
| `vault_list` | `path` |
| `vault_read` | `path` |
| `vault_write` | `path` |
| `vault_append` | `path` |
| `vault_patch` | `path` |
| `vault_delete` | `path` |
| `vault_move` | `path`, `destination` |
| `vault_copy` | `path`, `destination` |
| `vault_get_document_map` | `path` |
| `open_file` | `path` |
| `active_file_get_path`, `search_query`, `search_simple`, `tag_list`, `command_list`, `command_execute` | none |

- Implementation: a `const PATH_FIELDS: Record<string, string[]>` literal with the table above, consulted by `tools/call`; any tool not in the table falls back to the old generic scan (never blocks a call). Unknown/unmapped → forward unchanged.
- Optional hardening (do it, it is cheap): at startup `POST` a `tools/list` JSON-RPC request to `LRA_BASE + LRA_MCP_PATH` (`Authorization: Bearer <key>`, `Content-Type: application/json`, `Accept: application/json, text/event-stream`; parse **both** plain JSON and SSE-framed `data:` responses — LRA answers SSE-framed, confirmed in P0) and `console.warn` if a tool in `PATH_FIELDS` is missing from the live list. Never block or delay startup on it.
- Note for the implementer: the vault's own `AGENTS.md` declares `Journals/`, `_attachments/`, `.trash/` as a **mandatory** blacklist, but `harness/harness.config.json`'s `rules.blacklistFolders` is currently `[]`. Mirror the three folders into that config so the proxy actually enforces the vault's stated policy (flag this change to the user — it is a behaviour change, albeit one the vault rules demand).

### W5.2 Document the plugin-local boundary
- New file `docs/ARCHITECTURE.md`, containing exactly:
  - The stack diagram: `Obsidian plugin (view)` ⇄ HTTP/SSE ⇄ `harness/src/acp-bridge.mjs` ⇄ spawned `opencode acp` ⇄ vault MCP via `harness/src/mcp-rules-proxy.mjs` ⇄ Obsidian Local REST API `https://127.0.0.1:27124/mcp/` (desktop exposes MCP).
  - Allowed plugin-local vault access (with the FR-002 justification): session notes (`session/store.ts`), undo snapshots (read + restore on user click), the read-only `@mention` index (`retrieval/index.ts`), rules-file reads (`readAdvisoryRulesContext`). Everything else — model calls, tool execution, all other writes — happens in the harness.
  - A one-line rule for future contributors: *if a feature needs the plugin to call a model or execute a tool, it is mis-designed; route it through ACP.*

### W5.3 Reconcile spec-002 state
- `specs/002-acp-only-chat-ux/tasks.md`: tick T001–T029 and T030/T031 only when their quickstart sections pass in the P0 baseline run.
- Run `specs/002-acp-only-chat-ux/quickstart.md` US1–US6 top to bottom once, note failures as new tasks at the top of §9's later phases.

---

## 6. W6 — Aesthetic pass

### W6.1 Welcome / empty state
- DOM (created in `onOpen()` after the transcript container, shown only when the transcript has no user/assistant blocks):
  ```
  div.oc-welcome
    div.oc-welcome-brand     ← setIcon "bot" + "Obsidian Chat"
    div.oc-welcome-sub       ← "Grounded in your vault — connected to <harness label or 'harness'>"
    div.oc-welcome-actions
      button.oc-welcome-action[data-action=ask-current]   ← icon "file-text", "Ask about this note"
      button.oc-welcome-action[data-action=history]       ← icon "history", "History"
      button.oc-welcome-action[data-action=new]           ← icon "plus", "New session"
    div.oc-welcome-recent (hidden when no sessions)
      div.oc-welcome-recent-title   ← "Recent"
      button.oc-recent-item ×3      ← title + relative date
  ```
- Behaviour: "Ask about this note" → reveals the note chip (W3.2 path) and focuses the composer; if no active note → `Notice("No active note")`. "History" → `showHistory()`. "New session" → `newSession()`.
- Recent list: newest 3 session notes in `sessionFolder()` by `TFile.stat.mtime` (desc); label = `frontmatter.title` if present else basename without extension; sub = date via `new Date(mtime).toLocaleDateString()`.
- Hide rules: remove the whole welcome element the moment the first user message is added; recreate it in `newSession()`.
- The existing initial `addSystemMessage("Ask a question — I'll ground it in your vault.")` is **deleted** (replaced by the welcome sub-line).
- Mobile: identical, actions stack full-width (`flex-direction: column` via the existing mobile media query).

### W6.2 User-turn marker (left hairline)
- CSS only: `.oc-user { border-inline-start: 2px solid var(--background-modifier-border); padding-inline-start: 10px; }` (keep `.oc-user-images` as-is). No "You" label, no bubble.

### W6.3 Shared activity rail
- One rail treatment for everything that belongs to the agent's work:
  - `.oc-thought-content`, `.oc-activity-body`, `.oc-plan-body` all get: `border-inline-start: 2px solid var(--background-modifier-border); margin-inline-start: 7px; padding-inline-start: 16px;` (exactly one rail left of the content, aligned to the same x).
  - Remove the per-component border/margin/padding declarations that differ (`.oc-thought-content` currently has its own; normalise).
  - `.oc-user` hairline uses the same 2px/border colour so user turns and agent work read as the same visual language.

### W6.4 Typography pass
- Prose: `.oc-body-md { font-size: 15px; line-height: 1.6; }` (already) — do not change.
- Activity scale: all tool/activity/plan/thought text `13px`; mono (`var(--font-monospace)`) for: `oc-tool-verb`, `oc-tool-label` file names, plan paths; sans for descriptions.
- Numeric stability: `font-variant-numeric: tabular-nums` on `.oc-activity-label`, `.oc-tool-right`, `.oc-thought-label`, `.oc-usage`, `.oc-plan-header`.
- Ellipsis over wrap: single-line activity text uses `overflow:hidden; text-overflow:ellipsis; white-space:nowrap;` (never wraps — wrapping is what makes activity "clutter").
- Code: keep `pre` 13px; inline code unchanged.

### W6.5 Per-kind tool icons
- Implemented in W1.2/W1.4 (`TOOL_ICONS`). This entry exists to state the rule: **every** tool row has a kind icon; the group header icon reflects the group's aggregate state (spinner/check/alert), not a kind.

### W6.6 Turn separation (hairline)
- When `addUserMessage()` runs and `this.messagesEl` already contains at least one block, insert before it:
  ```
  hr.oc-turn            ← <hr class="oc-turn">
  ```
- CSS: `.oc-turn { border: 0; border-top: 1px solid var(--background-modifier-border); margin: 18px 0 14px; opacity: .55; }`
- Do not insert for the first turn, for messages after only system/error rows, or for regenerated turns (W7.7).

### W6.7 Motion discipline
- Global guard, appended to `styles.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .oc-view *, .oc-view *::before, .oc-view *::after { animation: none !important; transition: none !important; }
  }
  ```
- Accordion open: add `animation: oc-fade 150ms ease;` on `.oc-activity-body`, `.oc-thought-content`, `.oc-plan-body` when they become visible (`@keyframes oc-fade { from { opacity: 0 } to { opacity: 1 } }`); no close animation (instant hide — avoids max-height jank).
- Spinner: `.oc-spin { animation: oc-spin 900ms linear infinite; }` `@keyframes oc-spin { to { transform: rotate(360deg) } }` applied to the `loader` icon wrapper in running tool rows/plan rows/group headers.
- The streaming caret keeps its blink; reduced-motion disables it (caret becomes static).

### W6.8 Keyboard affordances
- Focus: `.oc-view :focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }` and explicitly re-assert the composer's no-outline rule (`.oc-input:focus-visible { outline: none; }`) so the textarea keeps its border-only treatment.
- Collapsibles (activity header, thought header, plan header) all: `role="button"`, `tabindex="0"`, `aria-expanded`, and keydown handler for Enter/Space toggling (factor a tiny `wireCollapsible(headerEl, wrapperEl, onToggle?)` helper in `chat-view.ts`; migrate the existing `wireThoughtToggle` to use it).
- Escape: view-level keydown — when `this.streaming`, Escape calls `cancelStreaming()`; when not streaming, Escape clears the composer's mention/slash menus if open (existing behaviour) and otherwise does nothing.
- Send button while streaming: `title`/`aria-label` = `Stop (Esc)`.
- All icon-only buttons keep `aria-label`s (audit attach, send, chip ×, queue ×, toolbtn-hidden ones).

### W6.9 Density setting
- `settings.ts`: `uiDensity: "comfortable" | "compact"` (default `"comfortable"`).
- `chat-view.ts`: in `onOpen()`, `this.contentEl.toggleClass("oc-density-compact", s.uiDensity === "compact")`.
- CSS variables (defined on `.oc-view`, overridden under `.oc-view.oc-density-compact`):
  - `--oc-gap`: 16px → 10px (used by `.oc-messages { gap: var(--oc-gap) }`)
  - `--oc-activity-pad`: 2px → 0px (used by `.oc-tool { padding: var(--oc-activity-pad) 0 }`)
  - `--oc-activity-font`: 13px → 12.5px
  - `--oc-input-font`: 15px → 14px
- Settings tab: "Interface" section (new `<h3>Interface</h3>` before the existing sections) with three rows: **Density** dropdown, **Send shortcut** dropdown (W2.5), **Chat folder** stays where it is today (do not move it).
- After settings save, views refresh: add `refreshOpenChatViews()` in `main.ts` (iterate `app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)`, call `(view as ChatView).applyViewSettings()`); `applyViewSettings()` re-applies the density class. Call it from the settings tab's `onChange`s.

### W6.10 Native chrome audit (constraint, not a feature)
- Before finishing: grep new code for banned patterns: custom `Menu`-like popovers, `createEl("button")` without `aria-label` for icon-only, hardcoded hex colours, `position:absolute` overlays outside `.oc-view` bounds, any new dependency. The bar: the UI could pass for a first-party Obsidian surface.

---

## 7. W7 — Functional additions

### W7.1 Queue & steer → covered in W2.4.

### W7.2 Enter behaviour → covered in W2.5.

### W7.3 Scroll pinning → covered in W2.3.

### W7.4 Faithful session replay
- Persist the activity trail per assistant turn so reopening a session reproduces it.
- `plugin/src/session/store.ts` `renderBody()`: for an assistant message with `activity` (new optional field on `ChatMessage`), append after the content/reasoning blocks:
  `\n<!-- oc-activity-b64: {base64} -->\n` where base64 = `btoa(unescape(encodeURIComponent(JSON.stringify({ v:1, items: ActivityItem[] }))))` and items are capped to the last 50 with strings ≤200 chars.
- `ChatMessage` (in `chat/types.ts`): `activity?: ActivityItem[]`.
- Collection: `chat-view.ts` keeps `private turnActivity: ActivityItem[]`; `addOrUpdateToolCall()` maintains the item (create/update by id, set `endedAt` on terminal status); on turn end (same `finally` as session persistence), attach a **copy** to the pushed assistant history entry (only when non-empty) and reset.
- `loadSession()`: when reading the note, parse `<!-- oc-activity-b64: ([A-Za-z0-9+/=]+) -->` per assistant section (regex on the raw note text in section order); on rendering an assistant block, if it has activity, render **one collapsed activity group** with the stored items (same DOM as W1.3, header label `{n} steps`, no live timer, no "Working…"). Expand shows the rows with their stored labels/diff stats; clickable paths still work (paths re-resolved against the current vault).
- Forward compatibility: unknown fields ignored; malformed base64 → skip silently.

### W7.5 End-of-turn changes card
- Trigger: turn end (same place as W7.4) when any item has `kind === "edit"` or `kind === "delete"` or `kind === "move"` and `status === "completed"`.
- DOM (appended as the last block of the turn, after the assistant text):
  ```
  div.oc-changes
    div.oc-changes-header   ← "Changed 3 notes · +12 −4" + chevron (collapsible)
    div.oc-changes-body
      div.oc-changes-row ×N ← icon (edit/delete/move) + path (clickable, resolves like W1.4) + diff stat + button "Undo" (only when a snapshot exists)
    div.oc-changes-actions  ← button "Undo all" (only when ≥1 snapshot exists)
  ```
- Aggregation: group items by `path`; sums of `diff.add`/`diff.del` across items on the same path.
- Default expanded when ≤3 paths, collapsed otherwise. Header text pluralises: `Changed 1 note` / `Changed 3 notes`.
- Snapshots: extend `handlePermissionRequest` so **every** allow path records a snapshot before responding:
  - Keep the existing snapshot logic for card approvals.
  - In the allowlist-bypass branch (`settings.toolAllowlist[action] !== undefined` and allowing), also capture `this.writeSnapshots.get(path) ?? captureNow()` before responding allow.
  - `writeSnapshots: Map<string, { existed: boolean; content: string }>` — keyed by **vault-relative resolved path**; first write wins (so "Undo" returns to session-start state for that file), value captured just before the first approved write.
  - Capture helper: resolve via `resolveVaultFile(rawPath)`; if resolvable → `{existed:true, content: await vault.cachedRead(f)}`; else `{existed:false, content:""}`.
- Undo actions:
  - Single: restore snapshot for that path (modify if exists; if file missing and snapshot existed → ensure parent folder exists (`vault.createFolder` when needed) then `vault.create`; if snapshot says it didn't exist → `vault.trash(f, false)` when present).
  - Undo all: run the same per path, sequentially; show `Notice("Restored N notes")`; on any failure `Notice("Undo failed for <path>")` and continue.
  - After undo, the card's rows for that path get `data-undone="true"` (strikethrough path, Undo disabled) — no card removal (audit trail stays).
- Edge: path unresolvable at render time → row still shows, Undo disabled with `title="File not found"`.

### W7.6 Clickable activity rows → covered in W1.4 (paths) + W1.5 (cursor). Tool-detail expand on a row (bounded rawOutput preview) is **not** in scope this iteration — the row tooltip carries the detail.

### W7.7 Copy affordances
- Code blocks: in `ui/markdown.ts` `renderMarkdown()`, after `MarkdownRenderer.render`, run a `finish()` pass: for each `pre` inside `el`, prepend `button.oc-code-copy` (icon `copy`, `aria-label "Copy code"`, `title "Copy"`); on click → `navigator.clipboard.writeText(pre.innerText)` → swap icon to `check` for 1.2s. CSS: `pre { position: relative }`, button absolutely positioned top-right inside the padding, 24×24, `background: var(--background-primary-alt)`, border, radius 6, opacity 0 until `pre:hover` (desktop) / always visible on touch (media `(hover: none)`).
- Message copy/quote → W3.7.

### W7.8 Regenerate (same-session re-ask)
- On the **last** assistant message only, when `!this.streaming`, show an `oc-msg-actions` button `refresh-cw` labelled (tooltip) "Regenerate — asks again in this session".
- Data: keep `private lastTurnText: string | null` + `lastTurnImages: ImageAttachment[]` set in `send()`/`sendQueued()`; also derivable from `acpHistory` (last user message).
- Action: guard `!streaming && lastTurnText`; call `void this.sendViaAcp(this.lastTurnText)` **without** echoing a new user message and without pushing to `acpHistory` (the harness session already has the user turn; this is a re-ask). Persist the new assistant reply as usual.
- Label the limitation in the tooltip (above). Edit-and-resend is out of scope (no ACP rewind, §8).

### W7.9 `[[` wikilink autocomplete → covered in W3.6.

### W7.10 Connection status surface
- `client.ts`: add `private connection: "idle" | "connecting" | "connected" | "unreachable" = "idle";` plus `getConnectionState()` and an `onConnectionChange` listener set alongside the existing `stateListeners` (reuse `emitStateChange()`; set states in `connect()` start → `connecting`; on successful session/new → `connected`; on fetch failure/scheduleReconnect → `unreachable`; after a successful permission/prompt call → `connected`).
- `chat-view.ts`: create `div.oc-conn` inserted directly before `this.messagesEl` (inside the view column, so it pushes the transcript down — no overlap). Hidden by default.
  - `connecting`: amber dot + "Connecting to harness…" (no button).
  - `unreachable`: red dot + "Harness unreachable — retrying" + `button "Details"` → opens `ConnectionInfoModal`.
  - `connected`: hide; if the row was visible, fade out (150ms) then set `display:none`.
- New file `plugin/src/ui/connection-info.ts`: a tiny `Modal` (Obsidian `Modal`) listing `getDebugInfo()` rows (base URL, session id, last event id, reconnect attempts, last error, harness connected yes/no) + a "Copy" button (`navigator.clipboard.writeText` of the same text). Plain `Modal`, no styling beyond one `pre` with `font-family: var(--font-monospace)`.
- `client.ts` `getDebugInfo()`: `{ baseUrl, connected: connection === "connected", sessionId, lastEventId, retries: sseFail, lastError }` — track `lastError: string | null` in the failure paths.
- Also add a command `obsidian-chat:connection-info` ("Connection info") in `main.ts` opening the modal.

### W7.11 Auto-title sessions
- `client.ts`: handle `session_info_update` → `sessionTitle: string | null` + `getSessionTitle()`; emit state change.
- `chat-view.ts` `persistSession()`: when `settings` allow, pass `title` into the session note frontmatter (`title: <sanitized>`) — sanitize: trim, collapse whitespace, strip `[]#|` chars, cap 80 chars; skip when null/empty.
- `showHistory()`/`SessionSuggestModal` labels + W6.1 recent list prefer `frontmatter.title` when present (read via `app.metadataCache.getFileCache(file)?.frontmatter?.title`), else today's label.
- Filename scheme unchanged (avoids rename churn/sync conflicts).

### W7.12 Subagent/task nesting — **deferred** (see §8). Document in `docs/ARCHITECTURE.md` §W5.2 notes as "revisit when ACP exposes parentToolCallId".

### W7.13 Mobile essentials
- Jump-to-latest pill: shared with W2.3 (positioned above the composer at all widths).
- Keyboard-aware composer: **verification-only** item. Obsidian's webview resizes the view when the iOS keyboard opens; after building, test on device. Only if the composer is obscured, add a `window.visualViewport.addEventListener("resize", …)` that sets `--oc-vh: ${visualViewport.height}px` on the view and a CSS rule using it for `.oc-composer { padding-bottom: calc(env(safe-area-inset-bottom) + max(56px, …)); }`. Do not add this pre-emptively.
- Touch targets (mobile media query): `.oc-send` → 40×40; `.oc-toolbtn` → `min-height: 44px`; `.oc-chip-x` → 28×28 hit area via padding; `.oc-slash-item` → `padding: 12px 13px`; `.oc-queue-*` buttons → `min-height: 36px`.
- Background completion notice: in `handleStreamEvent` `done` case, if `document.hidden` → `const n = new Notice("Obsidian Chat: reply ready", 8000); n.noticeEl.addEventListener("click", () => this.app.workspace.revealLeaf(this.leaf));` (revealLeaf is available on workspace). Only once per turn (the `done` case already fires once).
- Debug/health panel: W7.10's `ConnectionInfoModal` is the panel; command included.

### W7.14 Verification
1. Reopen a completed session → activity groups render collapsed with real labels; expand shows rows; reasoning blocks stay collapsed (existing).
2. Trigger 2 edits in one turn → changes card `Changed 2 notes · +a −b`; per-row Undo restores that file; Undo all restores both; undone rows show disabled Undo; a file that didn't previously exist is deleted (trashed) on undo.
3. Hover a code block → copy button; click → clipboard contains code; icon flips to ✓ then back.
4. Regenerate on the last reply → new reply arrives without a duplicated user message; session note records the new reply.
5. Kill the bridge (or Tailscale off) while the view is idle → status row appears red; click Details → modal with base URL/retries; restart bridge → row disappears.
6. If opencode emits `session_info_update`: session note frontmatter gains `title:`, and history/recent labels use it.
7. Archive/hide the app during a turn (mobile) → completion Notice appears; tap → chat reveals.

---

## 8. Explicitly out of scope this iteration
| Item | Why |
|---|---|
| Subagent/task nesting | ACP `ToolCall` has **no** `parentToolCallId` (verified). No reliable parent link exists; a heuristic would be wrong half the time. Revisit if ACP adds it or opencode exposes it via `_meta`. |
| Tabs / multi-session | Architectural (view + tab manager + per-tab state); deserves its own spec. |
| Quick-Ask panel / inline-edit rebuild | A separate surface with its own UX; the approval-card + selection-context paths cover the underlying needs for now. |
| Edit-and-resend / true regenerate | ACP (stable) has no session rewind; "Regenerate" ships as a same-session re-ask and is labelled as such. |
| Cost history / persistence | `usage_update` is rendered live; persistence has no agreed home yet. |
| `compaction_update` / `plan_update` extras | Unstable schema; `plan_update` is accepted as a replacement payload only. |
| iPad widths, share-sheet capture, mobile toolbar redesign | Explicitly deferred by the user. |
| Tool-row deep-dive expansion (rawOutput viewer) | Tooltip has the detail; avoid a second expansion model until needed. |

---

## 9. Implementation order & gates

| Phase | Contents | Gate (all of: typecheck, build, install, then manual) |
|---|---|---|
| **P0** | Baseline: build clean; run `specs/002-acp-only-chat-ux/quickstart.md` US1–US6; probe opencode for `plan`/`usage_update`/`session_info_update`; capture LRA `tools/list` output (W5.1). | Quickstart passes or failures are logged as tasks; probe results recorded in §10. |
| **P1** | W1.1 stream model + `mapSessionUpdate` extensions; W1.2 `activity.ts` (pure functions). | tsc + build; existing behaviour unchanged except `plan` no longer fakes a row. |
| **P2** | W1.3–W1.5 activity groups + rows + icons + CSS; W6.3 rail; W6.4 typography. | W1.6 checks 1–5. |
| **P3** | W2.1 autosize, W2.2 toolbar compact, W2.3 scroll pinning, W6.9 density, W2.5/W2.4 queue + enter setting. | W2.6 checks 1–5. |
| **P4** | W6.1 welcome, W6.2 user hairline, W6.6 turn hairline, W6.7 motion, W6.8 keyboard, W6.10 audit. | Manual: welcome appears/disappears correctly; keyboard toggles work; audit grep clean. |
| **P5** | W3 selection/context (W3.1–W3.7). | W3.8 checks 1–7. |
| **P6** | W4 plan + usage. | W4.3 checks (skip usage if opencode doesn't emit). |
| **P7** | W7.4 replay, W7.5 changes card, W7.7 copy, W7.8 regenerate, W7.10 status/health, W7.11 auto-title, W7.13 mobile. | W7.14 checks 1–7. |
| **P8** | W5 stack cleanliness + `docs/ARCHITECTURE.md`; tick spec-002 tasks; final full walkthrough. | W5 verification steps; all manual checks green. |

Dependency notes: P1 is a hard prerequisite for P2/P6/P7. P3 and P4 only touch `chat-view.ts` + `styles.css` (independent of P5). P5 depends on P1 only for `contextChips` plumbing. Nothing depends on P8.

---

## 10. Runtime verification results (P0 probe, 2026-09-13)
Probed live against `opencode acp` via the bridge (`POST /sessions` → SSE → `POST /prompt`), plus LRA `tools/list`.

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | Emits `plan`? | **No** (0 events across 2 turns) | W4.1 ships but stays dormant — renders nothing; keep the code for harnesses that do emit it. |
| 2 | Emits `usage_update`? | **Yes** — `{"used":27348,"size":200000,"cost":{"amount":0,"currency":"USD"}}` | W4.2 is **live**; 27.3k/200k = 13.7% → accent colour. |
| 3 | Emits `session_info_update`? | **No** | W7.11 dormant; frontmatter `title:` simply stays absent. |
| 4 | `ToolCall` fields | `title` = `vault_vault_read` (**raw name lives here**), `kind` = **`"other"` always**, `rawInput` empty on `tool_call` then `{"path":"AGENTS.md"}` on the `in_progress` update, `locations` **always `[]`**, completed `content` = Content variant holding a **~20 KB JSON string** | Verb/icon must come from the **name**, not `kind`; targets from `rawInput`; do **not** attach `contentLines` for non-edit tools (see W1.1). |
| 5 | LRA MCP tools | 16 tools; all path-bearing ones use `path`, plus `destination` on `vault_move`/`vault_copy` (full list in W5.1) | W5.1 mapping is now exact — no schema-scanning heuristic needed. |
| 6 | iOS keyboard obscures composer? | **Yes** — the keyboard overlays the webview and the OS scrolls the focused field into view, pushing the column up and stranding the composer above blank space (observed 2026-09-14, screenshot) | Fixed: `handleKeyboardViewport()` reserves exactly the hidden height as bottom padding on mobile, driven by `visualViewport` resize/scroll plus composer focus. |

### Post-implementation bug fixes (2026-09-14, on-device)

- **Non-specific tool rows.** opencode sends human status lines through the tool-call channel (`Loaded skill: obsidian-cli`, confirmed by decoding the persisted `oc-activity-b64` trail). Those fell through the identifier path and rendered as a generic `Ran` with an empty label. `activity.ts` now detects status titles, renders them verbatim with a neutral icon, and never leaves a row blank — an unnamed tool falls back to its own prettified name.
- **Keyboard push-up.** See row 6 above.
- **Mobile Return.** A phone keyboard has no Cmd/Ctrl, so Return now always inserts a newline and the send button sends; the "Send shortcut" setting is desktop-only. Mobile placeholder shortened to "Ask anything…".

Additional confirmed facts: `modes` is `null` → the agent-mode control is correctly absent (FR-008); `configOptions` contains a `model` select with real values (`opencode/big-pickle` current); `available_commands_update` delivers the installed skill list; reasoning arrives as 45 `agent_thought_chunk`s and the answer as 3 `agent_message_chunk`s per short turn.

---

## 11. Acceptance summary (definition of done)
- Long agent turns read cleanly: one collapsed activity line per run, real labels, per-kind icons, reasoning in its own accordion, plan checklist when offered, usage meter when offered.
- Composer behaves on a phone: grows/shrinks with the keyboard, toolbar never crowds (measured, not guessed), reading position never yanked, messages queue while the agent works.
- Selection tooling feels native: editor selection → chip → prompt; active-note and file-menu entry points; drag-drop; `[[` autocomplete; copy/quote everywhere.
- Sessions replay faithfully (activity trail persisted) and changes are auditable (changes card + undo).
- The stack story is documented and true: thin plugin, harness owns model+tools, desktop exposes MCP; `mcp-rules-proxy` maps tools exactly, not heuristically.

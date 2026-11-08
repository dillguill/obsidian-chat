# TODO

## Order

| # | Feature | Size | Where | Depends on |
|---|---------|------|-------|------------|
| 1 | Mobile bugs | S | plugin (CSS/view) | — |
| 2 | Conversation naming | S | plugin + host record | — |
| 3 | @ mentions on mobile | S | plugin | 1 (verify on phone) |
| 4 | Conversations sync between devices | L | host + plugin | 2 (titles shown in the shared list) |
| 5 | Skills folder | M | plugin + host | 4 helps (same list on every device), not required |
| 6 | Web search/fetch toggle | M | dsh profile + plugin | dsh exposing a per-session switch |

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
- [ ] Verify on the phone: keyboard behaviour, popover placement, touch
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
- [ ] Verify on the phone keyboard.

## 4. Conversations sync between devices

Conversations are stored by the host on the machine that runs it
(`.chat/sessions/`) and are owned by the device that started them: the phone
only lists its own conversations, and the Mac's local chats don't appear on
the phone (or vice versa).

- [ ] Decide the model: one shared conversation list across devices (the
      host is the single source of truth) vs. per-device lists.
- [ ] Let any paired device list and open conversations started on another
      device (relax the per-device ownership check in `host-bridge.ts`
      `loadSession`, with a clear policy).
- [ ] Desktop local chats and phone chats show in the same History list,
      with the originating device shown.
- [ ] Handle two devices opening the same live conversation (read-only
      follower, or hand-off).

## 5. Skills

- [ ] A setting picks one vault folder as the skills folder (user-selected,
      vault level).
- [ ] Each skill is a note (or folder with a main note) in that folder; the
      plugin lists them and offers them to the harness.
- [ ] Skills can be picked from the composer (e.g. `/` menu) and are sent as
      tagged context like other attachments.
- [ ] Skills sync with the vault, so every device sees the same set.

## 6. Web search and fetch (globe toggle)

dsh has native `web_search` / `web_fetch` tools, but the `obsidian` profile
disables them on purpose ("Thin vault surface: notes and search only. No
shell, no web tools."). The toggle needs a dsh-side switch first.

- [ ] dsh: expose web access as a per-session ACP config option (boolean,
      default off) for the obsidian profile, instead of a profile-wide
      on/off.
- [ ] Plugin: render that declared option as a globe toggle in the composer,
      off by default, without hard-coding tool names (driven by what the
      harness declares).
- [ ] Gated: web tools exist only while the toggle is on, and each call still
      goes through the permission card.
- [ ] The toggle state is visible in the composer and stored per
      conversation.

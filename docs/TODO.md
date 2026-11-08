# TODO

## Mobile design

Built on desktop and checked at phone width in a narrowed pane; still needs a
pass on a real phone.

- [x] Remove buttons that do nothing on mobile ("attach current note",
      "attach selection").
- [x] Composer sits above Obsidian's bottom toolbar, with bottom padding
      (`--view-bottom-spacing`), and moves down when the keyboard opens.
- [x] Header buttons are 44px touch targets with spacing.
- [x] Model and effort (and any other harness option, mode or command list)
      merged into one compact control next to send, on desktop and mobile.
- [x] Tables, code and tool output scroll inside their own box.
- [ ] Verify on the phone: keyboard behaviour, popover placement, touch
      targets in tool rows, chips and permission cards.

## Conversation naming

New chats stay titled "New chat" unless the harness sends `session_info`.

- [ ] Title a new conversation from the first prompt (trimmed typed text, not
      the attached context) when the harness gives no title.
- [ ] Prefer the harness's `session_info` title when one arrives.
- [ ] Let the user rename a conversation from the header and from History.
- [ ] Store the title in the session record so History and other devices show
      it.

## @ mentions on mobile

- [ ] Typing `@` in the composer on mobile opens the note picker, as it does
      on desktop (the @ button works; the typed trigger needs checking and
      fixing on the phone keyboard).

## Web search and fetch (globe toggle)

- [ ] A globe button in the composer turns `web_search` / `web_fetch` on for
      the conversation. Off by default.
- [ ] Gated: the harness gets the web tools only while the toggle is on, and
      each call still goes through the permission card.
- [ ] The toggle state is visible in the composer and stored per
      conversation.

## Skills

- [ ] A setting picks one vault folder as the skills folder (user-selected,
      vault level).
- [ ] Each skill is a note (or folder with a main note) in that folder; the
      plugin lists them and offers them to the harness.
- [ ] Skills can be picked from the composer (e.g. `/` menu) and are sent as
      tagged context like other attachments.
- [ ] Skills sync with the vault, so every device sees the same set.

## Conversations sync between devices

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

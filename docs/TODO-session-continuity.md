# TODO — session continuity (P2/P3)

Follow-up work from the session-continuity audit. **P0 and P1 are done** (see
"Already landed" at the bottom); everything below is still open.

Context for whoever picks this up: the product requirement already exists —
`specs/001-acp-mcp-migration/spec.md` US5 scenario 2, `quickstart.md` Scenario 5
steps 3–4, and task **T034**, which is the one unchecked task in that phase.
Resumption was specified, never implemented, and never validated.

---

## P1.1 — A turn in flight survives the view closing

P1 keeps the session alive when the chat tab closes, but the *view* is what
accumulates the reply. `AcpBridgeClient.emit` (`plugin/src/acp/client.ts:94`)
only iterates currently-registered listeners — there is no buffer for a late
subscriber — and `onClose` unsubscribes the view. So if a turn is still
streaming when the tab closes:

- the harness finishes the work and the bridge buffers the events,
- but the plugin drops every token that arrives after the unsubscribe,
- `lastAssistantText` stops accumulating, and the `finally` in `sendViaAcp`
  persists the **partial** reply to the note,
- reopening restores that truncated version.

Not a regression — before P1 closing the tab deleted the session outright — but
"close the tab while it's thinking" is normal on mobile, so this needs closing.

- [ ] Move the turn accumulator out of `ChatView` and into the plugin-owned
      session: `lastAssistantText`, `pendingReasoningBursts`, `turnActivity`,
      and the `persistSession` call. The transcript should be built and saved
      whether or not a view is mounted; the view then only renders from it.
- [ ] This also makes the multi-view case coherent (see P3), since both views
      would render the same session-owned state rather than each accumulating
      their own.

## P2.1 — Complete the ACP handshake (blocks everything else)

`initialize` is **never called anywhere in this repo** — grep `harness/src` and
`plugin/src` and you will find nothing. `connectHarness` in
`harness/src/acp-bridge.mjs` goes straight from `app.connect(stream)` to
`session/new`. The spawned harness tolerates it today; that is luck, not
contract.

This matters beyond conformance: `initialize`'s response is the **only** place
the agent advertises what it can do, and every item below is capability-gated.

- [ ] Call `initialize` in `connectHarness` before any session request, with
      real `clientCapabilities`.
- [ ] Cache the `InitializeResponse` on the bridge.
- [ ] Surface the relevant capability flags to the plugin — on the `POST
      /sessions` response, or a `GET /capabilities` route.
- [ ] Gate every optional call below on the advertised flag, not on try/catch.

Capability flags that matter (`@agentclientprotocol/sdk/dist/schema/types.gen.d.ts`):

| Flag | Line | Enables |
|---|---|---|
| `agentCapabilities.loadSession` | 1521 | `session/load` |
| `sessionCapabilities.resume` | 1716 | `session/resume` |
| `sessionCapabilities.list` | 1677 | `session/list` |
| `sessionCapabilities.close` | 1723 | `session/close` |

## P2.2 — Persist the session handle

The note frontmatter (`metaToFrontmatter`, `plugin/src/session/store.ts`) records
`type`/`created`/`updated`/`tokens` and **no session id**, so there is nothing to
resume with even once the protocol work is done.

- [ ] Add `acpSessionId` and `cwd` to `SessionMeta`, `metaToFrontmatter`, and
      `parseSessionMeta`. `cwd` is not optional: `LoadSessionRequest`
      (`types.gen.d.ts:4885`) requires `cwd`, `mcpServers` and `sessionId`, and
      the cwd must match the session's original cwd.
- [ ] Extend the `store.test.ts` frontmatter round-trip to cover both fields.

## P2.3 — Resume, with the right verb

Two methods exist and the less obvious one is the better fit here.

- [ ] **Prefer `session/resume`** (`sessionCapabilities.resume`) — restores agent
      context *without* replaying history. Right for this UI because the
      transcript is already in the note: render the note, resume the session,
      done.
- [ ] **Fall back to `session/load`** (`agentCapabilities.loadSession`) — restores
      context *and* streams the whole history back as `session/update`
      notifications. If you take this path you must clear the transcript and
      rebuild it from the replay, or every message renders twice.
- [ ] **Neither advertised** (likely with opencode today) — degrade *visibly*:
      start a fresh session, seed turn one with a clearly-labelled transcript
      summary block, and tell the user in the UI ("Continuing in a new session —
      prior transcript re-sent as context"). Silent partial memory is worse than
      an honest downgrade.
- [ ] Bridge: `POST /sessions/:id/load` (and/or `/resume`), same device-auth and
      replay-buffer treatment as the existing routes.
- [ ] Plugin: `loadSession` in `chat-view.ts` calls it after rendering. Its
      docstring already points here and says the agent does *not* have the
      conversation in context — update that once this lands.

## P2.4 — Never lose context silently

Today the SSE 404 handler nulls `sessionId` (`plugin/src/acp/client.ts:298` and
`:330`) and the next send's `connect()` quietly mints a **brand-new session**.
The transcript keeps scrolling; the agent has forgotten everything. The only
signal is an error row that scrolled past.

- [ ] Add an explicit `dead` state that `connect()` refuses to paper over.
- [ ] On death, attempt resume-by-id first (P2.3); if that fails, surface a
      **Resume / Start new** choice rather than auto-creating.
- [ ] Same treatment when the bridge restarts — `sessions` is an in-memory `Map`
      (`acp-bridge.mjs:64`) and every session is orphaned by a restart.

## P2.5 — Bridge durability

- [ ] Respawn the harness with backoff. It currently exits permanently:
      `acp-bridge.mjs:91` logs "restart the bridge to respawn" and gives up.
- [ ] Persist the `sessionId → deviceId` registry to disk so a bridge restart can
      re-attach via `session/load` instead of orphaning live sessions.
- [ ] Idle-session TTL sweep with `session/close`. P1 made sessions outlive the
      view deliberately, so nothing reaps them now except explicit "New session"
      and plugin unload.

## P2.6 — Hand-edited session notes

P0 made the canonical block the source of truth, which means **edits a user makes
to the prose body of a session note are now discarded** on the next save. The old
prose parser read them back (unreliably, but it read them).

- [ ] Decide whether this matters. If it does: store a hash of the rendered prose
      alongside the canonical block and prefer the prose parse when the body has
      diverged from what `renderBody` last wrote.

## P3 — Tests

- [ ] Bridge contract tests against a stub agent: `initialize` handshake,
      `load`/`resume`, and the capability-absent degradation path.
- [ ] Turn quickstart Scenario 5 into an automated test and finally tick **T034**.
- [ ] Multi-view case: P1 makes two open chat views share one session and both
      render the stream. `activateView()` reuses the existing leaf so this is
      hard to hit, but it is untested and the old code gave each view its own
      session.
- [ ] `chat-view.ts` has no test coverage at all — it needs an Obsidian test
      double before `loadSession`, the onOpen restore path, and the
      "reopened a different note while a session was live" branch can be tested.
      The P0/P1 view changes were verified by typecheck and build only; only the
      `store.ts` logic is under test.

---

## Already landed (P0 + P1)

**P0 — the note is now a trustworthy record.**
- `parseSessionNote` / `parseSessionMeta` in `plugin/src/session/store.ts`, with
  `store.test.ts` covering the round trip.
- `renderBody` writes a canonical `<!-- oc-transcript-b64: … -->` block. The prose
  is now a rendering, not the format. A legacy prose parser is kept as fallback
  for notes written before this.
- Fixed: an assistant reply containing `## Summary` no longer truncates on
  reload, and `## Assistant behaviour` in prose is no longer read as a role
  heading (the old parser flushed on any `#` line and matched any `##` line
  containing the word).
- Fixed: `loadSession` now rehydrates `acpHistory`, so replying to a reopened
  session no longer overwrites the note with only the new turns.
- Fixed: `created` is preserved across re-saves instead of being restamped to
  `Date.now()` on every persist.
- Image bytes are still never written to the note; names/types now survive.

**P1 — the session outlives the view.**
- The `AcpBridgeClient` moved from `ChatView` to `ObsidianChatPlugin`
  (`plugin.acp()`), rebuilt automatically if the bridge settings change.
- `ChatView.onClose` drops its subscriptions only. It no longer calls
  `session/close`, so closing the tab or a workspace layout change no longer
  ends the conversation.
- Explicit teardown is "New session" and plugin unload.
- A reopened view rejoins a live session via `plugin.currentSessionPath`.

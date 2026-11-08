# Handoff — mobile composer keyboard bug + context-ring spacing

Date: 2026-09-14 · Branch: `001-acp-mcp-migration` (HEAD `bddcf13`) · Component: Obsidian Chat plugin, iOS mobile view
Status: **resolved** — verified on the device in build `0.1.10`; earlier analysis below is superseded

## Problem statement

On iPhone (Obsidian mobile app), when the on-screen keyboard opens, the composer
is left stranded near the **top** of the screen with ~230px of blank space below
it, and the transcript is clipped to a sliver (user screenshot 2026-09-14 00:49:
header, then a one-line sliver of the welcome text, then the composer card, then
empty space down to the keyboard). The user wants the input pinned directly above
the keyboard. Separately: the circular context meter should sit equidistant from
the other toolbar icons (it had too much space to its left on mobile).

## Outcome — resolved (verified on device; final build `0.1.17`)

The screenshot-plus-on-screen-readout loop above settled this. Final facts, all
measured on the iPhone with the keyboard up:

```
inner=852  vvH=852  vvTop=0  screen=852  kbVar=328px  capH=328
app=524    vc=524   view=111..524       msgs=28  comp=133  display=flex
```

1. **The keyboard is a pure overlay.** Neither `window.innerHeight` nor
   `visualViewport.height` changes (both stay 852) and `vvTop` stays 0. So every
   viewport-diffing approach — i.e. all four earlier attempts — measured "keyboard
   not open" and was inert. `visualViewport` events do fire; they simply carry no
   information on this device.
2. **Obsidian already ends the app at the keyboard.** `.app-container` and
   `.view-content` both measure exactly `524 = 852 − 328`: its
   `max-height: calc(100vh - var(--keyboard-height))` clamp does the right thing
   by itself. Nothing about the container needed fixing, and reserving the
   keyboard height *again* (builds `0.1.4`/`0.1.5`) double-counted it — that was
   the "back to where it was" report.
3. **The actual defect was the composer never sitting at the bottom of the view.**
   The view spans 111..524, yet the wrapper measured `161..294`, leaving 230px of
   free space *below* it. `margin-top: auto` could not fix that: auto margins only
   receive the free space that `flex-grow` leaves behind, and the transcript's
   `flex: 1 1 auto` consumed it first.

**The fix** (`pinComposer` + the mobile `.oc-composer-wrap` rule):

- pin the wrapper with `position: absolute; left/right/bottom: 0` in the view
  (which is `position: relative`), applied both declaratively and inline from JS;
- reserve the composer's measured height as `padding-bottom` on `.oc-messages`,
  recomputed whenever the composer is sized, so the transcript's last lines cannot
  hide beneath it;
- while the keyboard is up, set the composer box's `padding-bottom` to `8px`
  instead of the `56px + env(safe-area-inset-bottom)` tab-bar clearance — the
  keyboard covers that bar, so the clearance is what reads as blank space;
- detect the keyboard from Obsidian's `--keyboard-height` (328px here), polled
  every 250ms and on every viewport/focus/blur/Capacitor event.

Verified after the fix: `wrap=391..524`, `card=391..524` — the card's bottom edge
sits exactly on the keyboard's top edge — and `msgs` grew 28 → 153. The transcript
box (`msgs`) had the *same* defect as the composer: it stayed at content height
instead of filling, which is what clipped the welcome block mid-button and left
the grey slab the user kept pointing at. It is pinned the same way
(`position: absolute; top: 0; bottom: composer height + 4px`), and `flex-grow` on
it is still not trusted anywhere in this view.

Final state shipped in `0.1.17`:

- transcript pinned `top: 0` and ending **4px** above the composer card
  (`GAP_ABOVE_COMPOSER` in `pinComposer`); the empty chips row is excluded from
  that sum so its 10px of padding cannot widen the visible gap;
- composer wrapper pinned `bottom: 0`, card flush above the keyboard;
- detection only from Obsidian's `--keyboard-height` plus Capacitor's
  `keyboardWillShow`/`keyboardWillHide` — **the 250ms poll was removed** (it read
  layout twice a second and was heating the device);
- all diagnostic readouts deleted; no `position: fixed` rules remain in the
  plugin CSS;
- the only remaining debug surface is the `Keyboard …` rows in the connection-info
  modal, which sample on keyboard-open transitions only.

## The gotcha that cost most of this session

`bash plugin/install.sh` copies `main.js`/`manifest.json`/`styles.css` into an
iCloud vault. **`manifest.json` is what Settings → Community plugins displays, and
it updates as soon as the file syncs — while the running plugin JS only reloads
when the plugin is toggled off/on or the app is restarted.** So "the version says
0.1.x" never proves the new code is running. Several "no change" reports in this
session were builds that had not loaded, and several fixes were judged before
they had ever executed. When a change appears to do nothing, **toggle the plugin
before believing it**, and for anything geometry-related put the build string in
the code (a screenshot of on-screen text) rather than trusting the version number.

## Superseded analysis (kept as debugging history)

The two sections below were written before the readout existed and are wrong in
places: the clamp theory in particular. They are kept only to show what was ruled
out.

## Root cause (2026-09-14, fix in build `0.1.2`)

**Obsidian clamps the whole app when the keyboard opens, and on this device the
clamp double-counts — leaving this view ~172px tall.**

From Obsidian's own `app.css` (extracted out of
`/Applications/Obsidian.app/Contents/Resources/obsidian.asar`):

```css
body.is-mobile { height: 100vh; }
body.is-mobile .app-container { max-height: calc(100vh - var(--keyboard-height)); }
body.is-mobile.keyboard-animating .app-container { max-height: 100vh; }
.view-content { height: calc(100% - var(--header-height)); }
.mobile-toolbar {
  position: absolute;
  top: calc(100vh - var(--keyboard-height) - var(--mobile-toolbar-height));
}
```

`--keyboard-height` is Obsidian's own measured keyboard height (it reads the same
variable back with `getComputedStyle` to `translateY` the toolbar on iOS), so
that math assumes the WebView keeps its full layout viewport and is merely
*overlaid* by the keyboard.

**This device's WebView resizes for the keyboard instead.** `100vh` is therefore
already the reduced (visible) height, and the keyboard height gets subtracted a
second time: ≈ 508px − ≈ 336px = **≈ 172px**. `.app-container` is clamped to that
box, and because this view is `height: 100%` it is squashed into the same 172px.
That is exactly the screenshot: the composer near the **top** of the screen with
~230px of blank below it, and the transcript clipped to a sliver — with

```css
.oc-composer { padding-bottom: calc(56px + env(safe-area-inset-bottom)); }
```

holding its tab-bar clearance inside that sliver.

This also explains the whole debugging history:

- All four attempts derived their offset from `window.innerHeight - vv.height`,
  which is ≈ 0 in the resize case — so every one of them was a **provable no-op**
  (attempt B even memoized itself out before touching the DOM).
- Nothing tuned *inside* the view could ever show up as a change, because the box
  doing the damage is an **ancestor**, not the composer. The earlier "it is the
  90px padding" theory was wrong: the band was ~230px of unused space in a
  collapsed container. (The `padding-bottom` change is still right, just
  secondary.)
- Attempt A's `html.mobile, body.mobile { height: 100%; overflow: hidden }` also
  did nothing — it was gated on a `mobile` body class while Obsidian uses
  `is-mobile`. Removed in `0.1.2` rather than left behind as dead code.

## Fix as deployed (`0.1.2`)

```css
body.is-mobile:has(.oc-view.oc-kb) .app-container { max-height: none; }
```

Releases Obsidian's clamp while the keyboard is up *and* this view is on screen,
so the app follows the viewport — which is already the right size for a resized
WebView. Specificity (0,4,1) beats Obsidian's (0,2,1), and if `:has()` were ever
unsupported the rule is simply dropped and behaviour is unchanged.

Supporting pieces:

1. `syncKeyboardState()` detects the keyboard *without* trusting the layout
   viewport: it diffs the current viewport against the largest one seen while the
   keyboard was closed (≈ 0 when nothing overlays, ~300px when a keyboard does).
   Works in both WebView modes; baselines re-take on a width change, so rotation
   cannot leave a stale resting height behind.
2. `.oc-view.oc-kb` while the keyboard is up →
   `.oc-view.oc-kb .oc-composer { padding-bottom: 8px }`. With the keyboard up
   there is no overlay tab bar to clear, and Obsidian's `.mobile-toolbar` only
   exists in markdown views (the screenshot shows nothing under the keyboard but
   the keyboard). Secondary to the clamp release.
3. `.oc-view.oc-kb-pinned` + `--oc-kb-height`/`--oc-kb-top` pins the view to the
   visual viewport, but **only** when the layout viewport did *not* shrink (the
   overlay case). Here the layout viewport does shrink, so it never engages; it
   exists so an overlaid WebView does not leave the composer behind the keyboard.
   Replaces the old `transform: translateY` lift.
4. Context ring: the mobile `margin-left: 6px` override on `.oc-view .oc-usage`
   is gone, so the ring sits on the toolbar's plain `gap` like every other icon
   (removing `margin-left: auto` was already in the tree; the nudge was
   re-introducing exactly the "too much space to its left" reported).

## How to verify on the phone

1. Confirm the build landed: **Settings → Community plugins** shows
   `Obsidian Chat 0.1.2`. Obsidian mobile must be fully killed and reopened
   before it re-reads `styles.css`.
2. Focus the composer. The view should fill the space above the keyboard with the
   card sitting ~8px above it, and the ring evenly spaced against its neighbours.
3. If it is still wrong, open **connection info** (command `Connection info`) and
   read the `Keyboard …` rows. The view samples the whole box chain — not just
   the viewport — 250ms after the keyboard settles and only while it is *up*, so
   the numbers survive the dismissal that opening the panel requires:
   - `--keyboard-height` non-zero **and** `.app-container` ≈ `100vh − kb` ⇒ the
     clamp is still winning; check the `:has()` rule really applies.
   - `.app-container` large but `.oc-view` still small ⇒ the clamp is released
     and something else is constraining this view (the chain says which box).
   - `Covered: 0px` / `Keyboard open: no` while the keyboard *is* up ⇒ detection
     failed; switch to textarea focus instead of viewport diffing.

## Relevant code

- `plugin/src/ui/chat-view.ts`
  - `handleKeyboardViewport()` (~line 657) — the keyboard handler; registered on
    `window.visualViewport` `resize`/`scroll` events and on textarea `focus`
    (rAF-delayed). See also the registration block in `onOpen()` (~lines 292–310).
  - `applyComposerHeight()` — viewport-capped textarea autosize (W2.1).
  - Composer DOM construction in `onOpen()` (~line 240): `.oc-composer` >
    `.oc-inputbox` > `.oc-input-row` (textarea + send) + `.oc-toolbar`.
  - Usage ring: created ~line 348 (`this.usageEl`), updated by `updateUsage()`
    (~line 1125) via `--oc-usage-pct`.
- `plugin/styles.css`
  - `.oc-composer` base (~line 265) and the mobile override (~line 435):
    `padding-bottom: calc(56px + env(safe-area-inset-bottom))` — clearance for
    Obsidian's overlaying bottom tab bar. **This 56px may itself read as a gap
    under the composer when the keyboard is open** (unverified hypothesis, see #5).
  - `.oc-view .oc-usage` (~line 738) — conic-gradient ring; `margin-left: auto`
    was the cause of the excess left padding vs other icons.
- Layout facts: `.oc-view` is `display:flex; flex-direction:column; height:100%;
  overflow:hidden`; transcript scrolls inside `.oc-messages` only; document
  scroll should never be involved.

## Attempts so far (all deployed via build + install.sh, user reports NO change)

> Superseded: all three were provable no-ops on this device — see Root cause.

1. **W7.13 original fix** (already in working tree before this session): reserve
   hidden height with `contentEl.style.paddingBottom = hidden`, where
   `hidden = max(0, innerHeight − (vv.height + vv.offsetTop))`. → Did not fix it.
2. **This session, attempt A**: same padding + clamp `document.documentElement.scrollTop`/
   `body.scrollTop` to 0 + CSS `html.mobile, body.mobile { height:100%; overflow:hidden }`.
   → Did not fix it.
3. **This session, attempt B**: transform-based lift — wrap composer in
   `.oc-composer-wrap`, apply `transform: translateY(-hidden)`; `hidden` takes
   the max of the overlay case AND the resized case (`vv.scrollTop + vv.height −
   innerHeight`). No document resize at all. → Did not fix it.

All three approaches produced *no observable change* per the user. That pattern
is the most important clue: either the code path isn't executing on the phone,
or the visual result is dominated by something else entirely.

## Hypotheses, ranked

1. **Stale deploy / stale JS engine.** The vault copy is a plain file copy
   (`bash plugin/install.sh`), iCloud-synced to the phone. Possible failure
   modes: iCloud hasn't synced main.js/styles.css to the device; Obsidian
   mobile keeps the old JS engine alive until the app is fully killed (reloading
   the plugin or reopening the vault may not re-read styles.css); the user's
   screenshot predates the newest install.
   - Verify: bump `versions.json`/manifest version or add a visible marker
     (e.g. change placeholder text "Ask anything…") and confirm it appears on
     the phone BEFORE debugging geometry.
2. **`Platform.isMobileApp` false / handler early-returns.** Everything is
   gated on it. Should be true in the Obsidian mobile app, but unverified here.
   - Verify: temporary `new Notice(...)` inside `handleKeyboardViewport` showing
     `hidden`, `vv.height`, `innerHeight`, `vv.offsetTop`. Notices render on
     phone — fastest ground truth without a console.
3. **visualViewport events don't fire** in Obsidian's mobile shell (they are
   registered manually, not via registerDomEvent — fine, but if the WebView
   never fires them, nothing happens). Same Notice probe answers this.
4. **The blank band is Obsidian's own chrome**, not our layout: e.g. the native
   bottom tab bar area staying visible between keyboard and webview bottom. If
   `window.innerHeight` already excludes the keyboard (resize case) while the
   *visible* webview ends higher, our math says "nothing hidden" and does
   nothing. The `vv.scrollTop` term in attempt B was meant to catch this; if
   events never fire (hypothesis 3) it wouldn't have applied either.
5. **The 56px tab-bar clearance padding** on `.oc-composer` looks like a gap
   under the card whenever the keyboard covers the tab bar. Cosmetic even if
   positioning is otherwise correct. Consider shrinking it while lifted.

## Suggested next steps (superseded — kept as the debugging history)

> Steps 1–3 (the diagnostic build and the deploy questions) are answered: the
> vault copy was byte-identical to the repo build (`8223ed6…`), so no stale
> deploy was involved.

1. Deploy a **diagnostic build**: on every `handleKeyboardViewport` call show a
   Notice with `{innerHeight, vv.height, vv.offsetTop, vv.scrollTop, hidden}`
   and a distinctive placeholder-text change to prove which build is live.
2. If no Notice ever appears → events/deploy problem (hypotheses 1–3), not
   layout. Fix the delivery path first (kill/reopen the app, check iCloud sync,
   consider sideloading main.js over USB/Files instead of iCloud).
3. If the Notice appears with sane numbers but the composer still floats →
   measure what element actually paints the white band (Obsidian devtools via
   `about:debugging`? or bisect by temporarily setting
   `.oc-composer { background: red }` and `contentEl` outline).
4. If the resize case is real (`vv.height ≈ innerHeight − keyboard`), remember
   CSS alone can pin the composer: with the layout viewport shrunk,
   `position: sticky/flex-end` already works and any JS lift would double-move.
   Conversely in the overlay case (`innerHeight` unchanged, `vv.height` shrinks),
   only JS can help. The two cases need different handling — branch on whether
   `vv.height < innerHeight` persistently.
5. Only after the band is gone: reduce the 56px mobile composer padding while
   the keyboard is up (hypothesis 5).

## Context-ring spacing (small, independent)

Remove `margin-left: auto` from `.oc-view .oc-usage` (styles.css ~line 742) so
the ring flows with the toolbar's normal `gap` like the other icon chips. This
was implemented in the reverted work and is trivially re-appliable.

## Repro / deploy notes

- Build: `cd plugin && npm run build && bash install.sh` (npm workspace root
  rejects bare `npm run build`). Vault target:
  `<vault>/.obsidian/plugins/obsidian-chat/`.
- After install, Obsidian must reload the plugin; on mobile, fully kill and
  reopen the app to be sure styles.css is re-read.
- TypeScript gotcha: this TS lib's `VisualViewport` type omits `scrollTop`
  (exists at runtime) — read via `(vv as { scrollTop?: number }).scrollTop ?? 0`.
- HEAD (`bddcf13`) does NOT contain the current working-tree migration state;
  do not `git checkout HEAD -- <file>` on files touched this session unless you
  mean to lose pre-session work. Use targeted edits/reverts instead.

## State right now

- `chat-view.ts` / `styles.css` / `connection-info.ts` / `manifest.json` carry
  the `0.1.1` fix; the vault build (`9ebe8b0…`) is byte-identical to the repo
  build, and `keyboardLiftPx` no longer exists anywhere in the bundle.
- The transform-lift handler is gone. If a future change needs to know whether
  this device overlays or resizes, the answer is in the connection-info panel
  rather than in guesswork.
- Deploy caveat unchanged: `bash plugin/install.sh` is a plain file copy into an
  iCloud-synced vault, so the phone only sees a new build once iCloud has
  delivered it *and* the app has been fully killed and reopened.
- Known pre-existing breakage: reverting ONLY `chat-view.ts`/`styles.css` to
  HEAD fails `tsc` (errors reference `plugin.tools`, removed provider modules,
  etc.) — those two files at HEAD belong to the pre-migration codebase and are
  inconsistent with the rest of the uncommitted working tree. A full revert of
  just these files cannot produce a loadable build; keep this in mind before
  attempting one.

# Quickstart: Validating ACP-Only Chat UX Completion

Manual acceptance walkthrough — no automated test framework exists in this repo (research.md,
consistent with specs/001-acp-mcp-migration). Run through these after implementation, in order;
each maps to one user story's acceptance scenarios in spec.md.

## Prerequisites

- A configured, reachable ACP bridge + harness (any of opencode/Claude Code/Gemini CLI/Goose per
  specs/001-acp-mcp-migration), with the plugin's `gateway.baseUrl`/`token` pointed at it.
- **Zero BYOK providers configured** in plugin settings — this is the target configuration this
  feature is built for, and the one the pre-existing session-save bug (research.md R10) only
  reproduces under.
- Build and deploy the plugin (`npx tsc -noEmit -skipLibCheck && node esbuild.config.mjs
  production`, copy `main.js`/`styles.css` into the vault's plugin folder, reload the plugin).

## US1 — Chat works end to end with no direct provider configured (P1)

1. Send a message with no BYOK providers configured.
2. **Expect**: a streamed reply renders, no error notice.
3. Open the configured session folder in the vault.
4. **Expect**: a session note exists for this exchange, with no "Couldn't save session" notice
   having appeared. Frontmatter has no `model`/`provider` fields (data-model.md: Session).

## US2 — Approve, reject, or undo a proposed vault change (P1)

1. Ask the assistant to create or edit a note.
2. **Expect**: an inline card appears in the transcript (not a blocking modal) showing the actual
   proposed diff.
3. Approve it. **Expect**: the note is created/changed; the card shows an applied state with an
   Undo action.
4. Ask for changes to two different notes in one turn. **Expect**: two independent cards, each
   resolvable without waiting on the other (approve one, reject the other, in either order).
5. Continue the conversation a few turns past an approved write, then click Undo on it.
   **Expect**: the affected note reverts to its pre-change content.
6. Check "always allow" on one action, trigger that same action again later.
   **Expect**: it applies with no new prompt.

## US3 — Agent mode / thinking level reflect the connected harness (P2)

1. With a harness connected that declares multiple modes, open the mode control.
   **Expect**: only that harness's actual modes are listed; selecting one changes behavior for
   the session (verify via a mode-dependent action, e.g. a mode that skips approval prompts).
2. Open the thinking-level control. **Expect**: only that harness's actual levels are listed.
3. Reconfigure the bridge to point at a differently-configured harness (or one with a different
   `configOptions`/`availableModes` set) and reconnect.
   **Expect**: the toolbar controls now reflect the new harness's options, with no plugin update
   or plugin setting change.
4. Connect to (or simulate) a harness declaring no modes/thinking options.
   **Expect**: those toolbar controls don't appear at all — not disabled, not placeholder text.

## US4 — Follow the assistant's reasoning (P2)

1. Trigger a response that includes visible reasoning.
2. **Expect**: a block appears with a live "Thinking Ns…" label, ticking, while streaming.
3. Let it finish. **Expect**: it collapses to "Thought for Ns"; click it to re-expand inline
   (no popup).
4. Trigger a turn with more than one distinct reasoning burst (e.g. one that reasons, calls a
   tool, then reasons again). **Expect**: two separate, independently-expandable blocks in order.
5. Close and reopen the session note via history. **Expect**: reasoning blocks render collapsed
   by default, still expandable.

## US5 — Dynamic "/" commands (P3)

1. Connect to a harness that exposes at least one custom command (or a skill surfaced as one).
2. Type "/" in the composer. **Expect**: that command appears alongside `/clear` and `/help`.
3. Trigger whatever changes the harness's available-command set mid-session (harness-dependent).
   **Expect**: the next "/" listing reflects the change.

## US6 — Mobile toolbar spacing (P3)

1. Open the chat view at a phone-width viewport (or on an actual mobile device).
2. **Expect**: every toolbar control (model, mode, thinking) is fully visible and tappable, no
   label overlapping/cut off, same controls present as on desktop.

## Regression check — deletions

After implementation, confirm none of the removed files/exports are referenced anywhere:

```bash
grep -rn "chat/anthropic\|chat/openai-compat\|chat/models\|chat/runtime\|chat/engine\|chat/ground\|tools/contract\|tools/runner\|search/tavily" plugin/src --include="*.ts"
```

**Expect**: no output (all references removed along with the files).

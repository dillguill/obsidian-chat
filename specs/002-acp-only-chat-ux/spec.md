# Feature Specification: ACP-Only Chat UX Completion

**Feature Branch**: `002-acp-only-chat-ux`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Complete the ACP-only migration for the obsidian-chat plugin and layer chat UX improvements on top, per specs/001-acp-mcp-migration (FR-001, FR-006, FR-011 were never fully finished — the BYOK/local-execution stack still exists alongside the ACP path today). Remove the BYOK/local-execution stack entirely so the plugin is ACP-only. Obsidian-specific tool/skill support comes from host-level configuration (the bridge already attaches a vault MCP proxy to every session; skills get installed into the harness), not new plugin/bridge code. Replace per-write blocking approval popups with an inline, independently-resolvable approval prompt per write, diff shown from the harness's real data, approve/reject only (no inline editing), with undo available for any approved write for the rest of the session. Agent mode and thinking/reasoning level must be driven entirely by whatever the connected harness declares, not a plugin-hardcoded set, with no control shown when a harness declares none. The assistant's reasoning must stream visibly, auto-collapse into a re-expandable block when it finishes, threaded per burst. The composer's slash-command list must reflect whatever commands the connected harness currently exposes, live. Sessions must reliably save as notes regardless of harness/provider (fixes a pre-existing crash when no direct provider is configured). Mobile toolbar spacing must not overlap/truncate at phone widths, without changing which controls exist."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chat works end to end with no direct provider configured (Priority: P1)

A user who has removed all direct (BYOK) model-provider configuration and relies solely on a connected harness sends a message and receives a streamed reply, and the conversation is saved as a session note afterward, exactly as it would be for any other user.

**Why this priority**: This is the foundation the rest of the feature builds on, and it fixes a real regression — today, a user in this exact configuration can chat, but the session silently fails to save. Nothing else in this feature matters if the basic loop doesn't work.

**Independent Test**: With no direct provider configured, send a message, confirm a streamed reply renders, then confirm a session note exists in the configured session folder with that exchange in it.

**Acceptance Scenarios**:

1. **Given** no direct model-provider is configured, **When** the user sends a message, **Then** the message reaches the connected harness and a streamed reply renders with no error.
2. **Given** a chat exchange has just completed, **When** the turn finishes, **Then** a session note is created or updated in the configured session folder reflecting that exchange, with no failure notice.

---

### User Story 2 - Approve, reject, or undo a proposed vault change without leaving the conversation (Priority: P1)

A user asks the assistant to create, edit, or otherwise change a note. They see what's being proposed inline in the conversation and can approve or reject it there, and if they change their mind later in the session, they can undo an approved change.

**Why this priority**: Vault writes are the highest-risk action the assistant takes; this is the safety-critical interaction the rest of the experience is built around.

**Independent Test**: Trigger a note edit, confirm an inline prompt appears showing the actual proposed change, approve it, confirm it's applied, then undo it and confirm the note reverts.

**Acceptance Scenarios**:

1. **Given** the assistant proposes a change to a note, **When** the change appears in the conversation, **Then** the user sees what will change before deciding, and can approve or reject it without a blocking dialog interrupting the rest of the conversation.
2. **Given** the assistant proposes changes to two different notes in the same turn, **When** both prompts are visible, **Then** the user can resolve them in either order, independently, without one being forced to wait on the other.
3. **Given** the user approved a change earlier in the current session, **When** they choose to undo it, **Then** the affected note reverts to its content from immediately before that change.
4. **Given** the user has previously chosen "always allow" for a specific action, **When** that same action is proposed again, **Then** it is applied without prompting again.

---

### User Story 3 - Agent mode and thinking level reflect whatever the connected harness supports (Priority: P2)

A user switches which harness (or harness configuration) they're connected to, and the mode/thinking controls in the chat toolbar update to reflect exactly what that harness now offers — no leftover options that don't apply, no missing options the new harness actually supports.

**Why this priority**: Mismatched or hardcoded controls are actively misleading (a control that doesn't do anything, or is missing an option the harness actually supports) — this makes the toolbar trustworthy across any supported harness.

**Independent Test**: Connect to a harness, note the available mode/thinking options shown, switch to a differently-configured harness, and confirm the shown options change to match without any plugin update.

**Acceptance Scenarios**:

1. **Given** a harness is connected, **When** the user opens the mode control, **Then** they see only the modes that harness actually offers, and selecting one changes the active mode for the session.
2. **Given** a harness is connected, **When** the user opens the thinking-level control, **Then** they see only the levels that harness actually offers.
3. **Given** a connected harness offers no selectable modes (or no selectable thinking levels), **When** the user looks at the toolbar, **Then** that control does not appear at all.

---

### User Story 4 - Follow the assistant's reasoning without it cluttering the conversation (Priority: P2)

While the assistant is working through a problem, the user can watch it reason in real time, and once each burst of reasoning is done, it tucks itself away into a small, clearly-labeled, clickable block so the conversation stays readable — but the full reasoning is still there to expand later, including when reopening a past session.

**Why this priority**: Reasoning output can be long and is usually secondary to the final answer; it needs to be available without dominating the transcript.

**Independent Test**: Send a message that triggers visible reasoning, watch it stream, confirm it collapses once finished, expand it back open, then reload the session note and confirm the same reasoning is there (collapsed by default).

**Acceptance Scenarios**:

1. **Given** the assistant is reasoning through a turn, **When** that reasoning is happening, **Then** the user can watch it appear in real time.
2. **Given** a burst of reasoning has finished, **When** the next part of the turn begins (an answer or an action), **Then** that reasoning collapses to a compact, labeled, clickable summary the user can reopen at any time.
3. **Given** a turn included more than one distinct burst of reasoning, **When** the user looks at the transcript, **Then** each burst is its own separately expandable block, in the order it happened.
4. **Given** a past session is reopened, **When** its reasoning blocks render, **Then** they appear collapsed by default and remain expandable.

---

### User Story 5 - Use whatever commands the connected harness offers (Priority: P3)

A user types "/" in the composer and sees the commands that are actually available from their currently-connected harness (which may include harness-specific commands or installed skills), not a fixed list that may not apply.

**Why this priority**: Nice-to-have discoverability improvement; doesn't block core chat safety or reliability.

**Independent Test**: Connect to a harness that exposes at least one custom command, type "/", and confirm it appears in the list alongside the always-available built-ins.

**Acceptance Scenarios**:

1. **Given** a harness is connected, **When** the user types "/", **Then** they see commands the harness currently makes available, plus starting a new session and listing available commands, which are always present.
2. **Given** the set of harness-provided commands changes mid-session, **When** the user next opens the "/" list, **Then** it reflects the updated set.

---

### User Story 6 - Use the toolbar comfortably on a phone (Priority: P3)

A user on a phone-width screen can see and tap every toolbar control without any of them overlapping, being cut off, or requiring precise tapping to hit the right one.

**Why this priority**: Usability polish; the controls already exist and work, this only affects their layout on narrow screens.

**Independent Test**: Open the chat on a phone-width viewport and confirm every toolbar control is fully visible and tappable, with the same controls present as on desktop.

**Acceptance Scenarios**:

1. **Given** the chat is open on a phone-width screen, **When** the user views the toolbar, **Then** no control's label or tap target overlaps or is cut off by its neighbors.
2. **Given** the same chat view on desktop versus phone width, **When** compared, **Then** the same controls are present in both — only spacing differs.

---

### Edge Cases

- What happens when the connected harness declares neither a selectable mode nor a selectable thinking level at all? Both controls are simply absent — never shown disabled or with a placeholder.
- What happens when the harness disconnects while a write-approval prompt is still pending? The prompt's resolution behavior on reconnect must not silently apply or silently discard the pending action.
- What happens when the user tries to undo a write to a note that has since been changed again (by the user or a later approved write)? The user must be able to tell the undo may not simply restore the version they expect, rather than it failing silently or corrupting the note.
- What happens when a harness proposes a write to a note covered by an existing folder exclusion/rule? The write must still be denied at the vault-tool boundary regardless of anything in this feature.
- What happens when the session note itself fails to save for a reason unrelated to provider configuration (e.g. a vault/disk error)? The user must see a clear failure notice, not a silent loss of the conversation record.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The plugin MUST support chatting exclusively through a connected ACP-speaking harness; it MUST NOT retain any direct (BYOK) model-provider connection, tool execution, or approval path of its own.
- **FR-002**: The plugin MUST NOT execute or preview vault-write actions itself; every vault tool invocation MUST be carried out by the connected harness.
- **FR-003**: A session note MUST be created or updated in the user's configured session folder after every completed turn, independent of which harness or model/provider is active, and independent of whether any direct provider is configured at all.
- **FR-004**: When the harness proposes a vault-write action, the user MUST see an inline, non-blocking prompt in the conversation, showing the actual proposed change, and MUST be able to approve or reject it without that decision blocking or being blocked by any other pending prompt.
- **FR-005**: The user MUST be able to mark a specific action as always-allowed so that future occurrences of that exact action are applied without prompting again.
- **FR-006**: Any vault write the user approved MUST remain revertible for the remainder of that session.
- **FR-007**: The set of selectable agent modes, and the set of selectable thinking/reasoning levels, shown to the user MUST be derived entirely from what the currently-connected harness declares; the plugin MUST NOT hardcode, assume, or fall back to a fixed set of its own.
- **FR-008**: If the connected harness declares no selectable agent modes, or no selectable thinking levels, the corresponding toolbar control MUST NOT be shown.
- **FR-009**: The assistant's reasoning MUST render as it streams, MUST collapse into a compact, re-expandable summary once that burst of reasoning ends, and multiple distinct bursts within one turn MUST each be independently expandable in the order they occurred.
- **FR-010**: Reasoning blocks in a previously-saved session MUST render collapsed by default when that session is reopened, while remaining expandable.
- **FR-011**: The composer's "/" command list MUST reflect the commands currently exposed by the connected harness, updating if that set changes during the session, always including the ability to start a new session and to list available commands regardless of harness.
- **FR-012**: Obsidian-specific vault-tool access and formatting conventions needed for a harness to work well against a vault MUST be achieved through host-level configuration of the harness/bridge, not through new plugin or bridge code.
- **FR-013**: Existing vault-access restrictions (blacklisted folders, `.chat/rules.md`-style rules) MUST continue to be enforced for every vault tool invocation, unaffected by any change in this feature.
- **FR-014**: Every toolbar control (model, agent mode, thinking level) MUST remain fully visible and tappable at phone screen widths, with the same set of controls present as at desktop widths.

### Key Entities

- **Session**: A persisted conversation, saved as a note in the user's configured folder, independent of which harness/provider produced it.
- **Approval Prompt**: A single pending decision point for one proposed vault-write action, resolvable independently of any other concurrently pending prompt, carrying enough detail (the actual proposed change) for the user to decide.
- **Undo Snapshot**: The prior state of a note captured at the moment its change was approved, usable to revert that specific change later in the same session.
- **Agent Mode**: A named operating mode offered by the connected harness (e.g. how freely it may act without asking); the available set is defined entirely by the harness, not the plugin.
- **Thinking Level**: A named reasoning-effort setting offered by the connected harness; the available set is defined entirely by the harness, not the plugin.
- **Reasoning Block**: One contiguous burst of the assistant's visible reasoning within a turn, collapsible independently of other bursts in the same turn.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with zero direct model-providers configured can complete a full chat turn (send a message, see a streamed reply) with no error, every time.
- **SC-002**: 100% of completed chat turns result in a saved session note, verified including at least one turn with zero direct providers configured.
- **SC-003**: When a turn proposes two or more separate vault writes, a user can approve or reject each one independently, in any order, without waiting on the others.
- **SC-004**: A user can undo any single previously-approved write at any later point in the same session and see the affected note return to its pre-change content.
- **SC-005**: Switching which harness is connected changes the agent-mode and thinking-level options a user sees, with zero plugin update and zero plugin setting change required.
- **SC-006**: A user can distinguish, at a glance, the assistant's reasoning from its final answer, both while a turn is streaming and after reopening a past session.
- **SC-007**: On a phone-width screen, 100% of toolbar controls remain individually tappable with no overlapping or cut-off hit targets.

## Assumptions

- Exactly one ACP-speaking harness is configured and connected at a time, consistent with specs/001-acp-mcp-migration's existing assumption.
- The connected harness/bridge implements ACP's mode-selection, configurable-option, and available-command mechanisms, or the corresponding plugin control simply does not appear when it doesn't — no plugin-side substitute is built for a harness that lacks one of these.
- Obsidian-specific tool access and formatting conventions are satisfied by host-level configuration (the existing vault MCP proxy already attached per session, plus skills installed into the harness) — this feature does not add new custom tool-execution code to the plugin or the bridge.
- The pre-existing failure to save a session when no direct provider is configured is resolved as a direct consequence of FR-001's removal of the direct-provider path, not tracked as a separate fix.
- No automated test framework exists in this repository; acceptance is verified against the scenarios above by manual walkthrough, consistent with specs/001-acp-mcp-migration's existing testing approach.
- "Always-allow" decisions and blacklist/rules enforcement carry forward unchanged from the current implementation; this feature does not alter their behavior, only how the initial prompt is presented.

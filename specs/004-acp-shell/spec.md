# Feature Specification: ACP Shell

**Feature Branch**: `004-acp-shell`

**Created**: 2026-11-07

**Status**: Approved 2026-11-07; implementation in progress (status reconciled during the 2026-11-07 realignment)

**Input**: User description: "I want to reimagine the plugin as an ACP shell with native Obsidian
integrations. The app should be built on the idea as a thin wrapper as a frontend for whatever ACP
compatible harness is attached to it."

Clarified during specification review (user, 2026-11-07):

- **Attach model**: Obsidian on the host desktop spawns the ACP harness inside the plugin; remote
  devices over the VPN connect to that host instance. No separate bridge, daemon, launchd job, or
  server process.
- **Scope**: local host attach, remote attach, native vault read/write, path confinement, inline
  approvals, editor refresh and snapshots, harness-declared controls, continuity, and native
  Obsidian search/backlinks. Terminal capability is out of scope for v1.
- **UI**: the transcript streams tool calls and every other ACP session update with minimal
  front-end interpretation — chronological and expanded by default, tool calls as a headline plus
  one expandable content/details area, per-turn raw ACP disclosure plus a full raw log in connection
  details, and composer controls generated from the harness's declarations instead of a fixed
  model/thinking/agent trio.
- **Continuity**: reopening a conversation must reattach to the harness session via the standard
  ACP resume/load capabilities, fall back to an explicit bounded digest or fresh start, and never
  silently begin a new session.
- **Storage**: the conversation record is a host-owned append-only structured session log. The chat
  UI is the only viewer; no generated Markdown session notes. Old Markdown session notes are
  imported during migration, not kept as the history model.
- **MCP**: native vault search/backlinks remain, served in-process by the host plugin as a read-only
  MCP vault server over loopback; all writes continue through ACP filesystem capabilities and
  approvals, so there is one write path.
- **Rebuild**: the work is a greenfield rebuild on this branch. Legacy code is removed at the end of
  the branch, not kept as a parallel fallback.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The host instance owns the harness and chats locally (Priority: P1)

A user on Obsidian desktop turns on *host on this device* and sets the harness command. The plugin
starts that harness as a child of the plugin itself — no separate bridge, server, daemon, or
container — introduces itself over the Agent Client Protocol (ACP), opens a session whose working
directory is the vault, and sends a message. The reply streams into the chat and the exchange is
written to the host's session record. Cancelling, or the harness dying, produces an honest visible
outcome — never a hung or fabricated completion.

**Why this priority**: This is the reimagining in its smallest complete form. If a desktop user
cannot attach to a locally spawned ACP harness and finish one real turn with no external process
beyond the harness, nothing else in this feature has a foundation.

**Independent Test**: On a desktop Obsidian install with the host enabled and a configured harness
command, send one prompt and confirm: exactly one harness child process exists, a streamed reply
renders, the session record contains the exchange, and a stop reason is recorded. Repeat once with
cancel and once by killing the harness mid-turn.

**Acceptance Scenarios**:

1. **Given** the host is enabled on desktop, **When** the user sends a message, **Then** exactly one
   harness child process is started, one ACP initialization and one session creation occur with the
   vault as the session's working directory, the reply streams in, and the turn is persisted to the
   host's session record.
2. **Given** a turn is streaming, **When** the user cancels, **Then** the turn stops promptly, the
   transcript shows the turn ended as cancelled, and no further reply content is appended.
3. **Given** a turn is in flight, **When** the harness process exits (crash or kill), **Then** the
   turn is shown as interrupted rather than completed, the host reports a reconnecting state, and
   the harness is restarted with bounded retries.
4. **Given** the configured harness command cannot be started (binary missing, bad argument),
   **When** the user opens the chat, **Then** a specific configuration error names the command,
   there is no endless retry loop, and no second process is started.

---

### User Story 2 - The harness reads and writes the vault through native Obsidian capabilities (Priority: P1)

The attached harness asks the shell to read and write notes through ACP's own filesystem client
capabilities. Reads return the content Obsidian currently sees, including a note open in an editor.
Writes go through Obsidian's vault operations, so open editors refresh; parent folders are created
for new notes; a best-effort snapshot is taken before a note is overwritten. Every path is confined
to the vault and checked against the configured folder blacklist; a path that escapes, is relative,
or is blacklisted is refused — never silently clamped or redirected.

**Why this priority**: This is the "native Obsidian integrations" half of the reimagining and the
security boundary of the whole product. Without it the harness either cannot touch the vault or has
to be given an unrestricted filesystem view the shell cannot police.

**Independent Test**: Run the shell against a controlled test harness that issues a read of an
existing note, a write of a new nested note, a read of a path that escapes the vault, a read under a
blacklisted folder, and a read under `.obsidian/`. Confirm the legitimate read matches the vault,
the write creates the note and refreshes an open editor, and every unsafe request is refused with no
vault read or write.

**Acceptance Scenarios**:

1. **Given** the harness asks to read a path inside the vault, **When** the shell handles the
   request, **Then** it returns the note's current text, honouring an optional line window.
2. **Given** the harness writes text to a path inside the vault, **When** the shell handles the
   request, **Then** missing parent folders are created, the note is created or overwritten, open
   editors/metadata refresh without a reload, and a best-effort pre-write snapshot is captured.
3. **Given** a request path contains `..` segments that escape the vault, is absolute outside the
   vault, or is relative, **When** the shell evaluates it, **Then** the request is refused with an
   error and no vault read or write occurs.
4. **Given** a request path is inside a folder listed in the folder blacklist, **When** the shell
   evaluates it, **Then** the request is refused with an error that distinguishes "blacklisted" from
   "outside the vault", and no content is returned or written.
5. **Given** a request path is under `.obsidian/`, **When** the shell evaluates it, **Then** the
   request is refused unconditionally, even if the user never added it to the blacklist.
6. **Given** a snapshot cannot be captured before a write, **When** the write proceeds, **Then** the
   failure is reported without blocking the write, and the user is not silently told an undo will
   restore the wrong content.

---

### User Story 3 - A remote device attaches to the host instance over the VPN (Priority: P1)

A user on a phone (or a second desktop) opens the chat and — with nothing else installed or running
on the host besides Obsidian and its harness — attaches to the host Obsidian instance over their
private network/VPN using the host address and a paired device code. They browse the host's
conversations, start a session, send a message, watch the reply stream in, cancel it, and answer
approvals. The remote app never starts a harness, never opens a listening port, and never touches
the host's filesystem; the host performs every vault capability on the remote's behalf.

**Why this priority**: This is the second half of the user's stated model — the host is the one
computer, every other device is a shell pointed at it.

**Independent Test**: With the host running on desktop and a device paired, attach from a second
Obsidian install over the private network, complete one turn, close Obsidian on the host, and
confirm the remote shows an unreachable state rather than falling back to a local or public server.

**Acceptance Scenarios**:

1. **Given** the host is running and the device is paired, **When** the remote user sends a message,
   **Then** the host's harness handles it, the reply streams to the remote, and the turn is written
   to the host's session record.
2. **Given** the host is running, **When** the remote opens its conversation list, **Then** it sees
   the host's stored sessions and can reopen one, resuming where the host's session allows.
3. **Given** a remote device presents a wrong or revoked device code, **When** it attaches,
   **Then** the attach is rejected, no session is created, and no vault content or harness state is
   exposed.
4. **Given** the host is closed or the VPN is down, **When** the remote tries to attach,
   **Then** the remote shows a clear unreachable state with bounded retries and no fallback path;
   host history is unavailable until the host returns.
5. **Given** a remote session is in progress, **When** the host's harness edits a note, **Then** the
   change happens in the host vault and the remote sees the activity; the remote device performs no
   filesystem write of its own.
6. **Given** the host's local chat and a remote session are both active, **When** either sends a
   message, **Then** both turns proceed independently against the same harness and neither sees the
   other's conversation.

---

### User Story 4 - Approvals stay inline and go only to the device that owns the session (Priority: P2)

During a turn the harness asks for permission to act. The user who started the turn sees the
existing inline approval card, built from the change the harness actually proposed, and answers by
choosing one of the options the harness offered. No other device sees or can answer that request.
The shell never approves on the user's behalf, and a request cannot survive a dead connection.

**Why this priority**: Writes are the highest-risk action in the product. Multi-device routing makes
this harder than today, so it is called out separately — but it depends on US1–US3.

**Independent Test**: Trigger a permission request from a session on device A while device B is
connected. Confirm A sees one card with the proposed change, B sees none, answering on A applies
only the offered choice, and killing the connection leaves the request cancelled with a visible
reason.

**Acceptance Scenarios**:

1. **Given** the harness sends a permission request with a changed note, **When** the card renders,
   **Then** the owning device sees the actual proposed change and one action for each option the
   harness offered — not a plugin-invented Approve/Reject pair.
2. **Given** a permission request is pending, **When** the user chooses a reject action, **Then** the
   request is resolved with one of the harness's own reject options and is never auto-approved.
3. **Given** two permission requests arrive in one turn, **When** both cards are visible, **Then**
   the user can resolve them independently and in either order.
4. **Given** a device is disconnected while its permission request is pending, **When** the host
   detects the loss, **Then** the request is resolved as cancelled and the transcript explains why
   the card disappeared.
5. **Given** the harness offers an "always allow" option, **When** the user selects it, **Then** that
   choice is sent as the harness's own option and the shell keeps no persistent allow/deny table of
   its own.

---

### User Story 5 - Controls are exactly what the harness declares, and swapping harness is configuration (Priority: P2)

Every mode, config option (model, thinking level, and anything else the harness invents), and
slash-command surface is generated from the attached harness's declarations — each control labelled
and typed from the declaration, with its own current value, description and identifiers. Nothing is
hardcoded, defaulted or hidden because the shell does not recognise its category. The user changes
`shell.command` from one ACP harness to another (or points the remote at a host running a different
harness) and the same build behaves identically.

**Why this priority**: "Thin wrapper for whatever harness is attached" is the product thesis. The
control surface is where a fake or hardcoded shell becomes visible to the user.

**Independent Test**: Attach a harness declaring two modes, two config options (one select, one
boolean) and a command, then attach one declaring none. Confirm every declared control appears by
its own name/type and works, then change only the harness command and confirm the same build keeps
working.

**Acceptance Scenarios**:

1. **Given** a connected harness declares modes/config options/commands, **When** the user opens
   those controls, **Then** every declared item appears, each labelled and typed from the
   declaration, and selecting one changes the session.
2. **Given** a connected harness declares no modes, no config options, or no commands, **When** the
   chat is open, **Then** the corresponding control is absent rather than disabled or hardcoded.
3. **Given** the user replaces the harness command with a different ACP harness, **When** they
   reconnect, **Then** the same build attaches and completes a turn with no other setting or code
   change.
4. **Given** any attached harness, **When** the shell builds its handshake and session payloads,
   **Then** they contain no harness identity, provider identity, model name, or provider credential.
5. **Given** the harness declares a config option the shell has never seen, **When** the composer
   renders, **Then** that option still appears as a working control (select menu or toggle) by its
   declared name, and no fixed model/thinking/agent trio is assumed.

---

### User Story 6 - The transcript streams the protocol, not a translation of it (Priority: P2)

A user watches a turn and sees everything the attached harness sends, in the order it arrives. Tool
calls appear with the harness's own title, kind, status and content; plans, usage, session metadata
and unknown/experimental update kinds appear as they are declared. The shell does not translate tool
names into its own vocabulary, does not hide a run of work behind a collapsed "3 steps" line by
default, and does not drop information it fails to recognise — the raw protocol record is always one
disclosure away.

**Why this priority**: This is the visible half of "thin wrapper". The protocol layer can be correct
while the transcript still lies by omission if it reinterprets or discards what arrived.

**Independent Test**: Drive the shell with a controlled harness that emits a tool call with an
unknown title, tool content variants (text, diff, terminal output, image/resource), a plan, usage,
session metadata, and an update kind the shell does not implement. Confirm every item appears in
order, the tool card uses the harness's own title/kind/status, and the raw record contains every
notification.

**Acceptance Scenarios**:

1. **Given** the harness streams a tool call and its updates, **When** they render, **Then** there is
   one card per tool-call id showing the harness's title verbatim, an icon derived only from ACP's
   fixed tool-kind enum, the ACP status, and duration; later updates mutate the same card.
2. **Given** a tool call carries several content variants, **When** the card renders, **Then** each
   variant is shown as its own content type (text as Markdown, diff as a diff, terminal output,
   image/audio/resource as a preview or link); no variant is dropped because another is present.
3. **Given** the tool call carries locations or raw input/output, **When** the card is expanded,
   **Then** locations are visible (and clickable when they resolve to a note) and raw input/output
   are available in a bounded Details disclosure.
4. **Given** an update kind the shell has no dedicated renderer for, **When** it arrives, **Then** a
   generic row shows the update kind and a bounded raw payload disclosure; it is never dropped.
5. **Given** the user opens a turn's "ACP updates" disclosure, **Then** the raw notifications for
   that turn are listed; connection details expose the session's full raw update record.
6. **Given** a turn is streaming, **Then** updates appear in arrival order and stay visible by
   default; grouping/collapsing is an opt-in activity-density setting.
7. **Given** the harness supplies no title, **Then** its programmatic name is shown verbatim, then
   the kind — the shell invents no verb or status label.

---

### User Story 7 - Reopening a conversation reattaches to its harness session (Priority: P2)

A user closes the chat, comes back later, and opens a stored conversation. The transcript appears
immediately from the session record; the shell reattaches to the same harness session when the
harness supports it — resuming without replaying history where possible, loading and replaying where
that is the only option — and only when the harness cannot restore the session does it offer a
bounded digest or a fresh start. The user is never silently given an empty session and never has to
re-paste the conversation to restore context.

**Why this priority**: Continuity is a basic expectation of a conversation product and the current
pain point the user named; it is P2 because the core flows can function without it, but it is the
first P2 item to build.

**Independent Test**: Open a session, complete several turns, close the view and reopen the
conversation. Confirm the transcript appears instantly, the shell attempts ACP resume (then load)
with capability gating, a subsequent prompt uses the prior context, and no turn is rendered twice.
Repeat with a harness advertising neither capability: a clear digest/fresh choice appears and no
session is created without the user's action. Repeat after killing the harness and after reloading
Obsidian.

**Acceptance Scenarios**:

1. **Given** a stored conversation with session identity, **When** it is reopened, **Then** the
   transcript renders from the record and the shell attempts `session/resume` when advertised,
   otherwise `session/load` when advertised, otherwise shows the restore choices.
2. **Given** `session/resume` succeeds, **When** the user sends the next prompt, **Then** the harness
   uses the prior conversation and no history is replayed into the transcript.
3. **Given** `session/load` replays prior history, **When** the replay arrives, **Then** the shell
   reconciles it against the stored record so no turn is rendered twice and the replay is not
   persisted as new turns.
4. **Given** the harness advertises neither resume nor load, **When** the conversation is reopened,
   **Then** the shell offers Continue with digest (default), Start fresh, and an advanced
   full-transcript replay; a new session is created only after the user chooses.
5. **Given** the host or harness restarted, **When** the conversation is reopened, **Then** the
   shell attempts to reattach from the persisted identity; on failure it shows an explicit dead
   state with the same choices and never auto-creates a replacement session.
6. **Given** the harness command or working directory differs from the stored fingerprint,
   **When** the conversation is reopened, **Then** resume is refused with an explanation rather than
   attaching to the wrong harness or vault.
7. **Given** a session is resumed, **Then** the last selected modes/config values are reapplied for
   that session, and pending permission requests are not restored (the harness must ask again).

---

### User Story 8 - Several paired devices, drops, and reconnects without duplicate turns (Priority: P3)

The host serves more than one paired device at the same time with isolated sessions. When the VPN
drops mid-turn, the remote shows the turn as interrupted rather than complete; when the connection
returns, the remote reattaches within a bounded number of attempts and the conversation continues
without duplicating the prompt or losing what was already shown.

**Why this priority**: This is the difference between a demo and a daily driver, but it only matters
after US1–US3 work.

**Independent Test**: Connect two devices, run simultaneous turns, drop one mid-stream, and confirm
the interrupted state, bounded reconnect, exactly-once delivery, and that the other device is
unaffected.

**Acceptance Scenarios**:

1. **Given** two paired devices, **When** both chat at once, **Then** each has its own isolated
   session, transcript, and approvals.
2. **Given** a remote turn is streaming, **When** the VPN drops, **Then** the remote marks the turn
   interrupted, stops appending, and does not claim success.
3. **Given** the VPN returns within the retry budget, **When** the remote reattaches, **Then** the
   session resumes and already-rendered content is not duplicated by a replayed prompt.
4. **Given** a device is revoked while connected, **When** it next attempts an operation, **Then**
   its access ends and its pending approvals are cancelled.

---

### User Story 9 - Upgrade and legacy removal without losing history (Priority: P3)

An existing user upgrades from the current host/relay build. Their host setting, harness command,
port, folder blacklist, and paired-device codes are preserved; existing chat Markdown notes are
imported into the host's new session store and stay readable as files; no conversation is lost. On
this branch, the old custom relay, custom client, note-writing format, and tool-name presentation
dictionary are deleted rather than kept as a second path.

**Why this priority**: Losing working setups or history during the rebuild would be a regression the
feature cannot accept, but it is P3 because it is preservation, not new value.

**Independent Test**: Start from a settings file and chat folder representing an existing host user
with paired devices and session notes; upgrade and confirm the host starts, devices reconnect with
the same codes, every old conversation is present in the new store, and no legacy transport or
second protocol is listening.

**Acceptance Scenarios**:

1. **Given** persisted settings from the current host mode, **When** the upgraded plugin loads,
   **Then** the host starts on the recorded port with the recorded harness command and no
   reconfiguration is required.
2. **Given** a device paired before the upgrade, **When** it updates and connects, **Then** it is
   accepted with the existing code and no re-pairing step.
3. **Given** existing Markdown chat notes anywhere in the vault, **When** the upgraded plugin first
   runs, **Then** every note's conversation is discovered by content and imported into the host
   session store losslessly, the original notes are left untouched, and the import is idempotent.
4. **Given** the branch is complete, **When** the plugin's runtime is inspected, **Then** the only
   network listener is the host's authenticated ACP/MCP endpoint, the only extra process is the
   harness child, and the legacy HTTP/SSE relay and custom client no longer exist.

---

### Edge Cases

- **Host Obsidian is not running / closed**: remote attach fails with a clear "host unreachable"
  state, bounded retries, and no fallback to a local or public server; host history is unavailable.
- **VPN address changes**: reconnect uses the configured host name/address; a stale address is
  reported as unreachable, not silently retried forever.
- **Device credential rejected or revoked**: distinct credential error, bounded retries only for
  network failures, and no session or vault content exposed.
- **Harness crashes mid-turn**: turn is interrupted, partial output stays, host reports reconnecting,
  harness restarts with bounded backoff; the session can be resumed only through the continuity
  ladder, never by silently starting a new one.
- **Harness binary missing or bad arguments**: a specific startup error names the command; one
  failure is reported, not a retry loop; no duplicate process.
- **Second prompt while one is in flight**: rejected locally with a clear message; the session is not
  corrupted.
- **Path escapes / relative path / NUL / malformed path**: refused with an invalid-request error, no
  vault side effects.
- **Blacklisted and `.obsidian/` paths**: refused before any vault operation; error names the policy,
  not the file's content.
- **Undo snapshot fails**: write still proceeds, and the user is told the previous content could not
  be preserved rather than being offered a false undo.
- **MCP vault server fails to start**: the chat still works through ACP; search/backlink tools are
  visibly unavailable for that host run rather than silently returning wrong results.
- **Harness calls an MCP write-shaped tool**: no such tool exists; the call fails as an unknown tool
  and writes remain on the ACP path with an approval.
- **Session record malformed or truncated**: the store skips the bad line, reports the affected
  session as degraded, and does not discard the rest of the session or its other sessions.
- **Session record deleted externally**: the session list no longer offers it; the chat never
  fabricates a replacement history.
- **Store write fails (disk full, permissions)**: the turn remains visible in the live chat and the
  failure is surfaced; no silent loss.
- **Old Markdown note cannot be parsed during import**: it is skipped and counted in a migration
  report; the original file is never modified or deleted.
- **Two devices with the same display name**: pairing still produces distinct credentials; sessions
  remain isolated.
- **Remote approval pending when the remote disconnects**: request is cancelled; it is never answered
  by the host or by another device.
- **Two views of the same session**: both render the same session-owned state; no duplicated turn or
  second session.
- **In-flight turn while the view closes**: the turn continues to accumulate and persist at the
  session level; reopening shows the complete turn.
- **Host reachable beyond the VPN/loopback**: the host warns before accepting a wider bind and never
  exposes itself publicly by default.
- **Mobile host attempt**: host mode is hidden/unavailable on mobile; mobile defaults to remote
  attach and never starts a process or the MCP server.
- **Unknown or experimental ACP update kind**: rendered as a generic raw row, never dropped.
- **Tool call with no title**: programmatic name shown verbatim, then kind; no invented verb.
- **Oversized tool content or raw payload**: bounded/truncated in the UI, with the full payload only
  in the local raw record.
- **Terminal capability**: not advertised in v1 on any platform.

## Requirements *(mandatory)*

### Functional Requirements

**Host ownership and lifecycle**

- **FR-001**: On desktop, the plugin MUST be able to own and start exactly one configured ACP
  harness at a time as a child of the plugin process, with no separate bridge, daemon, launchd job,
  or server process required for local chat.
- **FR-002**: The harness command MUST be a configuration value; switching to a different
  ACP-compatible harness MUST require no plugin code change and MUST NOT add a second process type.
- **FR-003**: The host MUST supervise the harness: restart it with bounded backoff after an
  unexpected exit, not restart it after a deliberate shutdown, and expose the current state.
- **FR-004**: Host ownership MUST be unavailable on mobile; a mobile install MUST NOT start, spawn,
  or attempt to spawn any harness process, and MUST default to remote attach.
- **FR-005**: While hosting, the plugin MUST serve remote devices and its own local chat from the
  same harness attachment; remote devices MUST NOT cause additional harness processes to be started
  on the host or on the remote.
- **FR-006**: The host MUST bind only to the interfaces the user has selected, MUST default to
  loopback, and MUST require explicit confirmation before listening on interfaces reachable beyond
  the private network.
- **FR-007**: Host ownership MUST follow the Obsidian app lifecycle: starting when enabled or when
  Obsidian opens, stopping cleanly when disabled or when Obsidian quits, without taking Obsidian down
  with it when the harness fails.
- **FR-008**: The host MUST expose exactly one network listener carrying two endpoints — the
  paired-device ACP endpoint and the loopback-only MCP vault endpoint — with one authentication
  boundary and no additional servers or ports.

**Remote attach and authentication**

- **FR-009**: A remote device MUST attach to the host Obsidian instance over the private
  network/VPN using a host address and a per-device credential; the shell MUST NOT require a
  separate server, cloud service, or account.
- **FR-010**: An unpaired, mispaired, or revoked device MUST be rejected before any session is
  created, and no vault content, harness state, or other device's transcript may be exposed to it.
- **FR-011**: A remote device MUST get the same chat behaviour as local: sessions, prompts, streamed
  updates, cancel, approvals, harness-declared controls, and the host's stored conversation list.
- **FR-012**: A remote instance MUST act only as a frontend: it MUST NOT start a harness, read or
  write the host's filesystem, serve vault capabilities or MCP tools, or hold provider credentials.
- **FR-013**: Sessions and approvals MUST be owned by the device that created them; another device
  MUST NOT see or answer them, even when both are connected to the same host.
- **FR-014**: The remote↔host connection MUST use the same open agent-client protocol that the
  harness uses, so that a remote instance is a shell rather than a client of a private protocol.
- **FR-015**: On connection loss mid-turn, the remote MUST mark the turn interrupted, MUST stop
  appending content, and MUST NOT report success; on reconnect it MUST reattach within a bounded
  retry budget, resume or explicitly restart the session, and MUST NOT duplicate the prompt or the
  already-rendered transcript.
- **FR-016**: Authentication failures MUST be distinguishable from network failures: an auth
  rejection MUST NOT be retried as a transient error.
- **FR-017**: Device pairing and revocation MUST be possible without editing configuration files by
  hand, and MUST take effect for subsequent operations without restarting Obsidian.

**Native vault access through ACP filesystem capabilities**

- **FR-018**: The shell MUST serve vault reads and writes to the harness only through the standard
  ACP filesystem client capabilities, executed by the host instance that owns the vault; remote
  instances MUST NOT serve these capabilities.
- **FR-019**: A read MUST return the note's current content as Obsidian sees it, including a note
  open in an editor, and MUST honour an optional line window.
- **FR-020**: A write MUST go through Obsidian's vault operations, create missing parent folders,
  create or overwrite the note, refresh open editors and metadata without a reload, and return a
  success response.
- **FR-021**: Before the first write to a given path in a session, the shell MUST attempt a
  best-effort snapshot; failure to snapshot MUST be reported and MUST NOT block the write.
- **FR-022**: Every capability path MUST be confined to the vault after lexical normalisation;
  escapes, relative paths, malformed paths, blacklisted folders, and `.obsidian/` MUST be refused
  with an error and MUST perform no vault operation. Refusal MUST NOT clamp or redirect the path.
- **FR-023**: The blacklist used for ACP filesystem requests, MCP vault tools, and the shell's own
  mention index MUST be the same setting and the same enforcement code.
- **FR-024**: The shell MUST NOT perform direct disk I/O or maintain a second content index; ACP
  filesystem handlers, MCP vault tools, and the mention index MUST call one shared vault service.
- **FR-025**: Writes MUST NOT be exposed through MCP (normative tool-surface rule in FR-028); the only
  write path is ACP filesystem capabilities plus the harness's permission request, so approvals and
  snapshots cannot be bypassed.

**Native Obsidian tools through MCP**

- **FR-026**: The host plugin MUST serve a read-only MCP vault server from inside the Obsidian
  runtime, reachable only over loopback and authenticated with a per-session credential that the
  shell supplies in the ACP session-creation request's MCP server list. It MUST only be advertised
  when the attached harness advertises support for an HTTP MCP server; otherwise the shell MUST NOT
  present the native tools as available (FR-031) and MUST keep chat working over ACP.
- **FR-027**: The MCP server MUST expose the native Obsidian read/search capabilities the agent
  needs: full-text note search, backlinks, outgoing links, tags, headings/outline, and note metadata.
  Results MUST come from Obsidian's live metadata cache and the shell's existing vault index.
- **FR-028**: The MCP server MUST NOT expose write, edit, append, move, or delete tools; a harness
  that wants to modify the vault MUST use ACP filesystem capabilities.
- **FR-029**: MCP tools MUST use the same shared vault service, path confinement, and blacklist as
  the ACP filesystem path; there MUST be no separate policy implementation, proxy, or duplicated
  vault logic.
- **FR-030**: The MCP server MUST run in the plugin process with no additional process, daemon, or
  launchd job, and MUST NOT be started on mobile or on a remote-only instance.
- **FR-031**: If the MCP server cannot start or a tool call fails, the host MUST keep the chat
  working through ACP and MUST visibly report that the native vault tools are unavailable for that
  run; it MUST NOT silently return empty results.
- **FR-032**: MCP MUST be used as the standard protocol it is — no custom tool envelope, no
  plugin-specific RPC layer — and the harness MUST connect to it as an ordinary MCP client.
- **FR-033**: In v1 the shell MUST pass only its own vault server in the session's MCP server list;
  forwarding arbitrary third-party MCP servers from user configuration is out of scope.

**Permissions**

- **FR-034**: The shell MUST handle ACP permission requests by rendering an inline card from the
  harness's real proposed change and answering only on explicit user action, with one action per
  option the harness offered and the exact chosen option returned to the harness.
- **FR-035**: A permission request MUST be routed only to the device that owns the session; no other
  device may see it, and no request may be auto-approved.
- **FR-036**: On explicit cancel, session teardown, device disconnect, or transport loss, every
  parked permission request for that session MUST be resolved as cancelled before the session ends,
  and the transcript MUST explain why any visible card disappeared.
- **FR-037**: The shell MUST NOT inspect a tool call to decide whether the agent may run it, MUST NOT
  maintain a persistent allow/deny table of its own, and MUST NOT invent permission options the
  harness did not offer.
- **FR-038**: The shell MUST NOT execute an agent tool call itself; approvals gate the harness's
  actions, they do not become shell actions.

**Harness-declared control surface**

- **FR-039**: Modes, config options, and slash commands MUST be shown exactly as the connected
  harness declares them and MUST update from live harness notifications.
- **FR-040**: A control the harness does not declare MUST be absent, and every option it does declare
  MUST be rendered by its own declared name and type; the shell MUST NOT hardcode, default, hide, or
  fall back to a plugin-owned option set, including a fixed model/thinking/agent trio.
- **FR-041**: Selecting a mode or config option MUST be sent to the harness unchanged, using the
  harness's own identifiers and value shapes, and MUST affect only the current session.
- **FR-042**: The shell MUST never call a model API, hold a provider API key, or import a provider
  SDK; provider choice is harness-side configuration only.

**Faithful protocol rendering (UI)**

- **FR-043**: Every ACP session update the harness sends MUST be surfaced in the transcript: known
  kinds through dedicated renderers, unknown or experimental kinds as a generic row carrying the
  update kind and a bounded raw payload disclosure. No kind may be silently dropped.
- **FR-044**: Tool calls MUST be rendered from ACP's own fields — title verbatim, programmatic name
  as fallback, kind, status, content, locations, raw input and raw output. The shell MUST NOT
  maintain a tool-name-to-verb/icon/label dictionary or rewrite a harness-provided title.
- **FR-045**: Tool content MUST be rendered generically per ACP variant: text as Markdown, diff as a
  diff, terminal output as terminal-style text, image/audio/resource-link/resource as their own
  preview or link. No variant may be dropped because another variant is present.
- **FR-046**: Tool-call details MUST be available behind an explicit disclosure, including locations
  (clickable when they resolve to a vault note) and bounded raw input/output; the disclosure MUST be
  lazy and local-only.
- **FR-047**: Agent work MUST appear in arrival order and remain visible by default; a
  grouped/collapsed presentation MAY exist as an explicit activity-density setting but MUST NOT be
  the default.
- **FR-048**: Each turn MUST offer an "ACP updates" disclosure listing that turn's raw
  notifications, and connection details MUST expose the session's raw update record; both derive
  from the same stored session record.
- **FR-049**: The shell MUST NOT fabricate labels, verbs, or statuses for harness content; when a
  title is missing it MUST show the harness's programmatic name verbatim, then the kind.
- **FR-050**: Raw payloads shown in the UI MUST be bounded, lazily rendered, local-only, and MUST
  NOT be written into the conversation record as visible transcript content.
- **FR-051**: The chat UI MUST provide the conversation list for the host's stored sessions
  (title, updated time, resumability state) and open any of them; there is no separate note-based
  history surface.
- **FR-052**: The composer MUST render the harness's declared modes and every declared config option
  as working controls generated from the declarations, and MUST render an empty control area when
  nothing is declared.

**Conversation record**

- **FR-053**: Each conversation MUST be recorded as a host-owned, append-only structured session log
  containing an ordered entry for every prompt, ACP session update, permission request/resolution,
  and turn boundary. It is the single source of truth for history, raw view, continuity, and digest.
- **FR-054**: The feature MUST NOT write Markdown session notes as its history model; the chat UI is
  the viewing surface, and optional export to a note is out of scope for v1.
- **FR-055**: The session log MUST record resume identity in its header: harness session id,
  working directory, harness command fingerprint, ACP protocol version, agent capabilities
  snapshot, last recorded sequence, and the session's last selected modes/config values.
- **FR-056**: The session log MUST live inside the vault in a fixed hidden configuration folder
  (default `.chat/sessions/`) so it is durable, backed up, and synced with the vault, while remaining
  outside the ordinary note surface. This is an internal location, not a note-folder setting: the
  shell MUST work with no user-configured chat folder.
- **FR-057**: Log writes MUST be append-only and atomic enough that a crash or partial write cannot
  corrupt a whole session; on a malformed entry the store MUST skip it, report the session as
  degraded, and preserve the rest.
- **FR-058**: The log MUST NOT contain provider credentials, tokens, or prompt-image bytes; image
  attachments are recorded by name/type only, as today.
- **FR-059**: On first run after upgrade, existing Markdown session notes MUST be imported losslessly
  into the store using their canonical transcript block (falling back to the prose parser for older
  notes); originals MUST be left untouched, skipped notes MUST be reported, and the import MUST be
  idempotent.

**Continuity**

- **FR-060**: Reopening a stored conversation MUST render its transcript from the record immediately
  and attempt to reattach to the harness session; it MUST NOT create a new session without the
  user's explicit choice.
- **FR-061**: When the harness advertises session-resume capability, the shell MUST use resume and
  MUST NOT replay history into the transcript; when only session-load is advertised, it MUST load
  and reconcile replayed updates against the stored record so no turn is rendered twice and the
  replay is not persisted as new turns.
- **FR-062**: When the harness advertises neither capability, the shell MUST offer Continue with
  digest (default), Start fresh, and an advanced full-transcript replay. The digest MUST be built
  only from the stored record, deterministic, bounded, labelled as a digest, and MUST NOT require a
  model call by the shell.
- **FR-063**: The host MUST persist its session registry (session id, owning device, cwd, sequence)
  so an Obsidian reload or harness respawn attempts to reattach before declaring a session dead;
  when reattachment fails it MUST expose an explicit dead state with the same user choices.
- **FR-064**: Resume MUST be refused with an explanation when the stored harness fingerprint or
  working directory does not match the current attach; the shell MUST offer digest/fresh instead of
  attaching to the wrong harness or vault.
- **FR-065**: After a resume, the last selected modes/config values for that session MUST be
  reapplied; pending permission requests MUST NOT be resumed and MUST be requested again by the
  harness.
- **FR-066**: A turn in flight MUST survive the chat view closing; accumulation, streaming state,
  and persistence MUST live with the session, not the view, and reopening MUST show the completed or
  interrupted turn.
- **FR-067**: Two views of the same session MUST render the same session-owned state; they MUST NOT
  create a second session or duplicate a turn.

**Configuration, migration, and scope**

- **FR-068**: Settings MUST cover host enablement, harness command, listen port/interface, paired
  devices and credentials, and the agent folder blacklist, with clear validation and a visible
  attach/connection status. There MUST NOT be a note-folder or session-store folder setting.
- **FR-069**: Upgrade MUST preserve existing host settings, paired-device credentials, and blacklist,
  MUST NOT require re-pairing, MUST discover and import old Markdown conversations automatically
  (by note content, with no folder setting), and MUST stop writing note-based session history.
- **FR-070**: This branch MUST delete the legacy path at the end: the HTTP/SSE relay, the custom
  `AcpBridgeClient`, the old note writer/parser as a history format, the custom SSE/RPC envelope,
  and the tool-name presentation dictionary. Nothing may remain as a parallel fallback.
- **FR-071**: The shell MUST expose a non-secret attach indicator (which mode/instance is attached
  and whether it is healthy) and a connection-details view; neither may display tokens, credentials,
  or file content.
- **FR-072**: Everything the plugin does to the vault locally MUST remain limited to the shell's own
  concerns: the session store, the read-only mention index, advisory rules reads, pre-write
  snapshots, and the read-only MCP vault tools. No agent-tool execution beyond these may be
  introduced.
- **FR-073**: The existing shell UX — transcript, approvals, activity presentation, context chips,
  current-note context, `@mention` index, session history, composer, and mobile layout — MUST
  continue to work, with transcript and control presentation updated exactly as FR-039…FR-052
  describe. History MUST NOT depend on any note-folder setting.
- **FR-074**: The implementation MUST be delivered as a greenfield module set on this branch; legacy
  modules MUST be removed rather than evolved in place or run side by side.

### Key Entities *(include if data involved)*

- **ShellInstance**: One Obsidian install with the plugin. Exactly one of two roles at a time:
  *host* (owns a harness, serves sessions and vault tools) or *remote* (attaches to a host).
- **HarnessAttachment**: The host's relationship to one spawned ACP harness: configured command,
  lifecycle state (starting/ready/reconnecting/stopped), negotiated capabilities, restart count, and
  last error. Never contains model or provider identity.
- **PairedDevice**: A device allowed to attach to a host: display name, credential, last seen, and
  revocation state. Credentials are secrets and must never render or log.
- **ShellSession**: One conversation between a device and the host's harness: owning device, session
  id, title, live turn state, and harness-declared modes/config/commands. Sessions are isolated per
  device.
- **VaultService**: The single in-process implementation of vault semantics: path normalization and
  policy, folder blacklist, read/write with editor refresh, full-text search index, backlinks,
  outgoing links, tags, headings/outline, and note metadata. Both protocol adapters call it.
- **VaultCapabilityRequest**: One ACP filesystem request: method, original path, mapped vault path,
  policy verdict (allowed / outside vault / blacklisted / protected / malformed), and whether a
  snapshot was captured. Never persisted with file content.
- **VaultToolCall**: One read-only MCP tool invocation: tool name, arguments, policy verdict, result
  size, and success/failure. Never persisted with file content; the transcript records the tool call
  as an ACP permission/update only if the harness reports it there.
- **PermissionRequest**: One pending harness approval: owning device, proposed tool change, the
  harness's offered options, and resolution (pending / selected / cancelled). Exactly one resolution;
  only a user action may select.
- **SessionRecord**: The canonical, host-owned append-only session log: header (resume identity and
  capability snapshot) plus ordered entries for prompts, ACP updates, permissions, and turn
  boundaries. Backs the transcript, raw view, continuity, and digest.
- **ProtocolUpdate**: One stored ACP notification or prompt within a session record: sequence,
  timestamp, update kind, payload, and turn association. Never rewritten; rendered by a dedicated
  view or a generic raw row.
- **DeclaredControl**: One harness-declared mode, config option, or command: display name,
  description, type, current value, and harness identifiers. The UI renders exactly this set.
- **ResumeState**: A stored session's ability to reattach: resumable via resume, via load, digest-only
  or not resumable; the reason; and the harness fingerprint/cwd the decision was made against.
- **ShellSettings**: Persisted configuration: role/host enablement, harness command, host
  address/port/interface, paired devices, session-store location, folder blacklist, and UI
  preferences.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On desktop, a user completes a full local turn — start harness, initialize, create
  session, prompt, streamed reply, persisted record — with zero additional processes beyond the
  harness and zero additional servers, reproducible on 5 of 5 attempts.
- **SC-002**: The same build completes a real turn against two different ACP harnesses with no code
  change and no setting change beyond the harness command; 0 per-harness branches exist in the shell.
- **SC-003**: A remote device over the VPN completes a turn against the host's harness with 0
  processes spawned on the remote device, 0 listening ports opened by the remote, and 0 local
  session-history stores written on the remote; unauthenticated attach attempts create 0 sessions
  and expose 0 bytes of vault content.
- **SC-004**: 100% of filesystem requests that are outside the vault, relative, malformed,
  blacklisted, or under `.obsidian/` are refused with 0 vault reads or writes, covered by automated
  tests.
- **SC-005**: 100% of approvals in the test suite are answered with an option the harness offered and
  only after a simulated user action; automatic approvals = 0; a disconnected device's pending
  approvals are cancelled = 100%.
- **SC-006**: Dropping the remote connection mid-turn yields a visibly interrupted turn and a
  reconnect within the bounded retry budget, with 0 duplicated prompt turns and no content lost that
  had already been rendered.
- **SC-007**: Upgrading from the current host mode preserves 100% of host settings and paired-device
  credentials, an existing paired device reconnects without re-pairing, and 100% of importable old
  conversations appear in the new store with the original note files untouched.
- **SC-008**: Exactly one network listener exists on the host (ACP + MCP endpoints) and 0 legacy
  listeners/processes remain; the only extra process is the harness child.
- **SC-009**: 100% of the native vault queries required by the user — note search, backlinks,
  outgoing links, tags, outline, metadata — return correct results for a fixture vault through the
  MCP server; 0 write tools are exposed through MCP; 0 duplicate blacklist implementations exist.
- **SC-010**: A controlled harness streaming every known update kind plus one unknown kind renders
  100% of them in arrival order (dedicated renderer or generic raw row); 0 updates are silently
  dropped; 0 tool-name→verb/icon dictionaries exist in the shell.
- **SC-011**: 100% of the config options and modes a harness declares appear as working controls;
  0 fixed model/thinking/agent controls exist; 0 controls appear when nothing is declared.
- **SC-012**: Reopening a multi-turn conversation and sending a new prompt preserves prior context
  through resume or load with 0 duplicated turns and 0 silent new sessions; when neither capability
  is advertised, the digest/fresh choice appears and a new session is created only after a user
  action (5 of 5 scenarios).
- **SC-013**: The conversation record has one entry per prompt/update/turn, survives a simulated
  crash with at most the last entry lost and no whole-session loss, and contains 0 credentials,
  tokens, or image bytes.
- **SC-014**: A turn in flight survives closing the chat view and reopening it (5 of 5 attempts shows
  the complete or interrupted turn, never a truncated one).
- **SC-015**: Build, typecheck, and the automated test suite pass; the plugin loads on mobile without
  any process-spawn or Node-only failure; no token, credential, provider key, or file content appears
  in logs, status surfaces, or error messages.

## Assumptions

- Personal use: one host computer, one vault, one attached harness at a time, a small number of
  paired devices. Simultaneous hosts, multiple vaults, and per-device harness selection are out of
  scope.
- The user installs, configures, authenticates, and updates the harness themselves (model provider
  keys, MCP servers, skills). The shell runs the configured command and knows nothing else about it.
- ACP v1 is the target; the shell is always the ACP client and never implements an ACP agent of its
  own (it relays standard ACP between a remote shell and the host's harness).
- The VPN/private network (for example a tailnet) is provided and managed by the user; the shell does
  not set up, configure, or tunnel the VPN itself. Transport security over that network is the VPN's
  responsibility.
- Host role requires desktop Obsidian; mobile Obsidian has no ability to start processes or serve MCP
  and always operates as a remote.
- The harness supports multiple concurrent sessions, one per connected device; if a particular
  harness does not, the user is told rather than the shell silently serialising devices.
- The conversation store is host-owned; remote devices browse and resume the host's conversations but
  keep no local history in v1. A remote with the host offline cannot open history.
- The session log lives in a fixed hidden vault configuration folder (`.chat/sessions/`) for
  durability, backup, and vault sync, rather than in the plugin data folder. It is not a user-facing
  folder setting: there is no note-folder configuration, and legacy conversations are discovered by
  content during the one-time import.
- The chat UI is the only session viewer in v1; export to a Markdown note is deliberately out of
  scope.
- MCP vault tools are read-only; all writes go through ACP and approvals. A future write-capable
  vault tool would require its own approval routing decision and is out of scope for v1.
- The MCP server is implemented in-process over loopback with a per-session credential; it is not a
  second process and is not exposed on the public network.
- The ACP SDK (v1.4.0) is used for the client and both transports. Whether the MCP endpoint keeps its
  minimal tool-only handler or adopts the official MCP SDK transport is a plan-stage choice; the
  lean is the minimal handler while the server stays tool-only.
- The digest fallback is deterministic and built from the stored record; the shell never calls a
  model. A user-triggered "summarise this conversation" harness turn is a possible later feature, not
  part of v1.
- Old Markdown chat notes are imported on first run and left untouched; they are not deleted by the
  upgrade.
- Terminal capability and running shell commands through the shell are out of scope for v1.
- Symlinks inside the vault are treated as vault content; resolving or blocking symlink escapes
  beyond lexical path checks is a known limitation of v1.
- Undo snapshots are a host-side concern. A remote device can approve a write, but standard ACP has
  no method for it to invoke the host's undo; v1 exposes undo on the host UI only. Remote undo parity
  would require an explicit product decision and a new mechanism, and is out of scope here.
- The hidden session-store folder is inside the vault so it can be backed up/synced, but whether a
  given sync provider covers hidden folders is the user's configuration; the UI surfaces store path,
  size, and degraded state, and never assumes sync is a backup.
- Search ranking quality is a shell concern: v1 ships a small scored search over the shared document
  index (not a new service); if it proves inadequate, improving ranking is additive and does not
  change the MCP tool contract.
- This feature requires a constitution amendment (host-mode spawn, in-process read-only MCP vault
  server, host-owned session store, one shared vault service). The amendment is presented for
  approval alongside the plan and is not applied silently.

## Open product decisions (non-blocking for planning)

1. **Session-store location**: resolved — fixed hidden vault configuration folder (`.chat/sessions/`);
   not a user-facing setting (no folder configuration), recorded in plan §Storage.
2. **MCP transport implementation**: resolved — minimal tool-only handler (plan research R4); no MCP
   SDK dependency added.
3. **Digest contents and cap**: exact turn/file/plan selection and token bound are plan-stage
   details; the user-facing behaviour is fixed (deterministic, bounded, labelled, explicit).
4. **Session history search**: the list shows title/time/state in v1; full-text search across stored
   sessions is a later enhancement.
5. **Optional note export**: deliberately out of scope for v1; may return as a user-invoked export.
6. **MCP write tools**: out of scope for v1; if patch-by-heading or block edits become important,
   they must be added as approved, auditable operations rather than a second unguarded write path.
7. **Third-party MCP servers**: forwarding user-configured MCP servers in the session's server list
   is out of scope for v1.
8. **Resume across harness changes**: fingerprint mismatch currently refuses resume; a same-harness
   version change is a warning, not a refusal (plan policy).
9. **Remote undo**: v1 exposes undo on the host UI only; remote undo parity (and the mechanism it
   would need) is out of scope. Revisit only if remote write parity becomes a real requirement.
10. **Search ranking**: v1 ships a small scored search over the shared document index; whether that
    stays sufficient for very large vaults is a later quality question, not a contract change.

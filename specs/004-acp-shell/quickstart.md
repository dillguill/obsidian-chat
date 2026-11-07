# Quickstart: Validating the ACP Shell

**Feature**: `004-acp-shell` · **Status**: Phase 1 validation guide, 2026-11-07
**Spec**: [spec.md](./spec.md) · **Model**: [data-model.md](./data-model.md) · **Contracts**:
[ACP shell](./contracts/acp-shell.md) · [host transport](./contracts/host-transport.md) ·
[vault MCP](./contracts/vault-mcp.md) · [session store](./contracts/session-store.md) ·
**Research**: [research.md](./research.md)

This is a **run and accept** guide, not an implementation plan and not the test suite. It tells you
how to build the plugin, what the automated checks must prove (by reference to the contracts, not by
duplicating them), and how to validate each of the 9 user stories plus the key success criteria on
real hardware. Every scenario states the expected outcome and the failure modes that should be
visible rather than silent.

Run automated checks first. Run manual scenarios in order on a **scratch vault**, not the primary
vault, and back up `.obsidian/plugins/obsidian-chat/data.json` and any legacy `chat/` folder before
the upgrade scenario.

## 1. Prerequisites

| Requirement | Detail |
|---|---|
| **Node.js ≥ 22** | The test script uses `node --test` with TypeScript type stripping; this checkout was authored on Node **24.22.2**. `node -v` must print ≥ 22. |
| **npm** | Workspace install from the repo root (`workspaces: ["plugin"]`). |
| **Obsidian desktop** | Host role and local chat. Any recent 1.5+ build. |
| **Obsidian mobile** | Remote-only role. Community plugins enabled; mobile must load the bundle with no Node built-ins evaluated. |
| **An ACP harness** | Primary: `opencode acp` (install and authenticate per its docs). Alternatives: `gemini --experimental-acp`, `goose acp`, or a Claude Code ACP adapter. The harness owns model/provider auth; the shell must hold no provider key. |
| **A private network/VPN** | E.g. Tailscale. Both devices on the same tailnet; the host's tailnet address (e.g. `100.x.y.z`) is what the remote enters. Do **not** use a public funnel/exposure for validation. |
| **Mock ACP harness** | The repo's mock harness child added with the test suite (research R10: `plugin/test/fixtures/mock-harness.ts`, run with `node --experimental-strip-types`; it wraps the in-process mock agent over `ndJsonStream`). `npm test` starts the in-process variant automatically. For manual runs, set *Harness command* to the fixture's launch command; its header lists the scenario flags. Expect at least: normal turn, cancel, prompt-resolves-before-a-late-update, permission options, load replay, capability matrix (resume-only / load-only / neither), unknown update kind, large payload, and a crash mode. If the fixture path changed during implementation, use the launch command recorded in `tasks.md`. |
| **Fixture vault** | Markdown notes under `Inbox/`, `Projects/`, and `Private/`; add `Private/` to the blacklist. Keep one note open in an editor for the refresh test. For US9, a copy of old settings + legacy `chat/` notes. |
| **Two remote devices (recommended)** | A phone plus a second desktop. The second desktop also lets you observe the remote's process/listener state; mobile cannot run `ps`/`lsof`. |

### Install, build, and test commands

From the repo root:

```bash
npm install            # workspace install (plugin/; run again after `ws` is added per research R3)
npm run typecheck      # tsc -noEmit -skipLibCheck
npm run plugin:build   # tsc + esbuild production bundle
npm test               # node --test 'src/**/*.test.ts'
```

Research R3 adds `ws` (and types) to `plugin/`; it must be installed and is bundled by esbuild, not
left external, so the mobile bundle never loads it. `ws`'s optional native helpers (`bufferutil`,
`utf-8-validate`) are marked external and left unresolved; they are not required.

Or from `plugin/` (the scripts in `plugin/package.json`):

```bash
cd plugin
npm run dev            # watch build, for iterative UI work (not a test)
npm run build          # tsc -noEmit -skipLibCheck && esbuild production
npm test               # node --test 'src/**/*.test.ts'
```

Build artifacts are `main.js`, `manifest.json`, and `styles.css` in `plugin/`. Deploy with the
existing installer (set `OBSIDIAN_VAULT` to the scratch vault):

```bash
OBSIDIAN_VAULT="/path/to/scratch-vault" bash plugin/install.sh
```

Or copy the three files into `<vault>/.obsidian/plugins/obsidian-chat/` and enable the plugin.
Reload Obsidian after every build (toggle the plugin off/on, or the command palette's
**Reload app without saving**). For mobile, sync/copy the same plugin folder into the mobile vault's
`.obsidian/plugins/obsidian-chat/` and enable it there.

### Harness and VPN sanity checks

```bash
which opencode && opencode --version     # harness is installed
# do NOT leave `opencode acp` running in a terminal: the host plugin spawns exactly one child
tailscale status
tailscale ip -4                          # host tailnet address, e.g. 100.x.y.z
nc -vz 100.x.y.z 8765                    # from the remote device, after the host is listening
```

The harness is authenticated on its own (`opencode auth login`, provider env, etc.). If a prompt
fails with an auth/model error from the harness, that is harness configuration — not a shell defect.

## 2. Automated checks

Run all of these from a clean build; every command must exit 0.

```bash
cd plugin
npx tsc -noEmit -skipLibCheck
node esbuild.config.mjs production
npm test
```

The suite is `node --test` over `src/**/*.test.ts` (no external runner). What it must cover, by story
and by contract — do not re-derive the contracts here:

| Story / area | Suite must prove | Reference |
|---|---|---|
| **US1** local turn | Initialize → `session/new` → prompt → ordered updates → `stopReason`, one mock child, record append; cancel resolves cancelled; unexpected exit interrupts and respawns within budget; bad command fails once with the command named and no second child. | [acp-shell](./contracts/acp-shell.md) §2–4, §9; [session-store](./contracts/session-store.md) §2–3 |
| **US2** vault fs | Full path-policy matrix (in-vault, `..`, absolute-outside, relative, NUL/malformed, blacklisted, `.obsidian/`); read honours `line`/`limit`; write creates parents and refreshes; snapshot first-write and snapshot-failure behaviour; **zero** vault operations on refusal. | [acp-shell](./contracts/acp-shell.md) §7; [data-model](./data-model.md) §2.6 |
| **US3** remote attach | Loopback WebSocket attach with a mock device; auth rejection **before** any session; unreachable state and bounded retries after host close; no remote spawn/listener/store. | [host-transport](./contracts/host-transport.md) §1–3, §7 |
| **US4** approvals | Owner-only routing; one action per offered option; exact `optionId` returned; two independent requests; cancel on disconnect/teardown; zero auto-approvals. | [acp-shell](./contracts/acp-shell.md) §6; [host-transport](./contracts/host-transport.md) §3 |
| **US5** declared controls | Exact declared modes/config options/commands rendered; absent when none declared; unknown category/type still works; selections forwarded unchanged; no fixed trio. | [acp-shell](./contracts/acp-shell.md) §8; [data-model](./data-model.md) §5.3 |
| **US6** faithful renderer | Every ACP update kind plus an unknown kind; tool fields, content variants, locations, raw disclosures; arrival order; no update dropped; no tool-name dictionary. | [acp-shell](./contracts/acp-shell.md) §5; [data-model](./data-model.md) §5.2 |
| **US7** continuity | Resume-decision matrix (resume-capable/load-only/digest-only/fresh-only), load reconciliation with no duplicate and no re-persisted replay, registry reattach, fingerprint/cwd refusal, modes/config reapply, no permission restore, deterministic digest snapshot. | [session-store](./contracts/session-store.md) §5–6; [acp-shell](./contracts/acp-shell.md) §3 |
| **US8** multi-device/reconnect | Two-device isolation; `sinceSeq` reconnect dedupe; interrupted turn on loss; revocation closes access and cancels approvals. | [host-transport](./contracts/host-transport.md) §5–6 |
| **US9** upgrade/migration/removal | Canonical-block and prose-note fixtures import once, losslessly, idempotently; originals untouched; unparseable note reported; settings/devices preserved; legacy modules absent. | [session-store](./contracts/session-store.md) §7; [plan.md](./plan.md) P4/P6 |
| **MCP vault tools** | Six read-only tools return fixture results; no write-shaped tool exists; loopback + per-session token required (401 otherwise); blacklist and `.obsidian/` behave as in ACP fs; tool failure is a tool error. | [vault-mcp](./contracts/vault-mcp.md) §3–7 |
| **SC-008** single listener | Exactly one listener with the ACP-device and MCP endpoints; no second listener or port. | [host-transport](./contracts/host-transport.md) §1 |
| **Mobile load (SC-015)** | Bundle loads without evaluating Node built-ins; no spawn attempt; host UI absent. | [plan.md](./plan.md) P6 |

Static conformance checks (adjust paths only if the implementation renamed modules; the expectations
do not change):

```bash
cd plugin
# No legacy transport/completion envelope in the new runtime.
grep -rn "turn_end\|Last-Event-ID\|EventSource\|text/event-stream" src --include='*.ts'
# No tool-name presentation dictionary or persistent allow/deny table.
grep -rn "toolAllowlist\|acpConfigOverrides\|NAME_CATEGORY\|ActivityItem" src --include='*.ts'
# Only lazy desktop-only process/fs access; no top-level import in shared modules.
grep -rn "child_process\|require(\"fs\")\|from \"fs\"\|from \"path\"" src/shell src/acp src/session --include='*.ts'
# Exactly one host listener.
grep -rn "createServer\|\.listen(" src --include='*.ts'
# No provider branching anywhere in the shell/acp/vault/session layers.
grep -rniE "anthropic|openai|openrouter|deepseek|ollama|api[_-]?key" src/shell src/acp src/vault src/session --include='*.ts'
```

Expected: the first two produce no output outside `session/migrate.ts` and migration-only settings
types; process/fs access appears only behind desktop guards; exactly one listener construction; no
provider branch. The Phase 0 research (`research.md`) records the WebSocket-server and MCP-transport
decisions these checks assume; consult it if a check's expected path differs.

## 3. Host setup (desktop) and pairing

1. **Install and enable** the built plugin in the scratch vault on the desktop that will host.
2. Open **Settings → Obsidian Chat**.
3. **Host** section:
   - Enable **Host on this device**.
   - **Harness command**: `opencode acp` (or the mock fixture's launch command for deterministic
     scenarios).
   - **Port**: `8765` (or another free port).
   - **Bind**: loopback for the first local-only run. For the VPN run, select the private/tailnet
     interface; a bind reachable beyond the private network must show an explicit confirmation.
   - **Session store**: leave the default hidden `.chat/sessions/` (a setting) or choose another
     vault-relative folder.
   - **Blacklist folders**: add `Private/` (and anything else that must be invisible to the agent).
4. **Verify the harness**: the host status shows `ready`; there is exactly one harness child (see
   *Logs, records, processes, listeners* below). Send one prompt from the local chat and confirm a
   streamed reply and a record file.
5. **Pair a device**: under **Paired devices**, enter a name (`phone`, `laptop`) and add it. Copy the
   code **once** at creation; afterwards the list shows the device name, a non-secret fingerprint,
   last-seen time, and a **Revoke** action. The credential is never rendered or logged again.
6. **Configure the remote**: on the second desktop (or phone), leave host mode off/absent, open
   **Connect to host**, enter `http://<tailnet-ip>:8765` and the device code, then attach.
7. **Inspect health**: the attach indicator / connection details show mode (local vs remote),
   instance, connection health, record health, and resume state — never a token, credential, or file
   content. The session list shows title, updated time, and resume state.

### Logs, records, processes, listeners

```bash
# Obsidian developer console (desktop): Ctrl/Cmd+Shift+I → Console.
# Filter on the plugin name, the harness command, "error", and "host".

# Records (default location):
cd "<vault>/.chat/sessions"
ls -l
head -n 1 <sessionId>.jsonl      # header
tail -n 5 <sessionId>.jsonl      # recent entries

# Exactly one harness child (macOS/Linux), and one host listener:
ps -axo pid,ppid,command | grep -E '[o]pencode acp|[g]oose acp|[g]emini.*acp'
lsof -nP -iTCP:8765 -sTCP:LISTEN
# Linux alternative:
ss -ltnp | grep 8765
# Windows (PowerShell):
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'opencode acp' }
Get-NetTCPConnection -State Listen -LocalPort 8765
```

For the single-listener check, take a **baseline** before enabling host mode and compare after: the
delta must be exactly one listening socket on the configured port, owned by the Obsidian process. The
harness child is the only extra process; Obsidian's own renderer/helper processes are not harness
children and must not be counted as such.

### Host setup failure modes

| Symptom | Likely cause / expected handling |
|---|---|
| Attach indicator stuck `starting`, then `failed` with the command named | Harness binary missing/bad args; one named error, no retry loop, no second process. |
| Port already in use | Settings validation error; host does not fall back to another port silently. |
| Bind widened without confirmation | Settings refuses or requires explicit confirmation; never silently exposes the host. |
| Host enabled on mobile | Host section absent; no spawn, no MCP; mobile is remote-only. |
| Remote says "credential rejected" | Auth failure (wrong/revoked code): distinct from network failure, not retried. |
| Remote says "unreachable" | Host closed/VPN down: bounded retries, no fallback to a local/public server. |
| MCP tools unavailable while chat works | MCP failed to start or was blocked; visible notice, chat continues over ACP, no empty results. |

## 4. Manual end-to-end scenarios

Each scenario maps to a user story and the success criteria it exercises. Use the mock harness where
a real harness cannot deterministically produce the condition.

### S1 — Local host turn, cancel, crash, bad command (US1; FR-001…FR-007, FR-066; SC-001, SC-013, SC-014)

1. Enable host with a working command; open the chat; send one prompt.
   **Expect**: exactly one harness child, one `initialize`, one `session/new` with the vault as cwd,
   a streamed reply, a recorded turn boundary (internal `turn` entry; the ACP `stopReason` is the
   authoritative end), and one new JSONL record with prompt, updates, and the boundary.
2. Start a long answer and press **Cancel**.
   **Expect**: the turn stops promptly, the transcript shows cancelled, and no further content is
   appended. The record contains a cancelled turn boundary.
3. Start a turn, then kill the harness (`pkill -f 'opencode acp'` or the mock's crash flag).
   **Expect**: the turn shows **interrupted**, never completed; the host reports `reconnecting` and
   respawns with bounded backoff; the record reflects the interruption.
4. Set a deliberately bad command (`definitely-not-a-harness --acp`), reopen the chat.
   **Expect**: a specific configuration error naming the command; one failure, no retry loop, no
   second process.
5. Start a turn that streams slowly, close the chat view, wait, reopen.
   **Expect**: the complete (or interrupted) turn is present — never truncated. Two views of the same
   session show the same state and do not create a second session.

Failure modes: two harness children, a hung "completed" turn, a missing record, or a bad command
that retries forever.

### S2 — Vault read/write, blacklist, `.obsidian/`, editor refresh, snapshot (US2; FR-018…FR-025; SC-004)

Use the mock harness's filesystem scenario (flag in its header) or a real harness that reads/writes
notes.

1. Open `Inbox/welcome.md` in an editor, type an unsaved change, then ask the agent to read that
   path. **Expect**: the read returns the editor-current text (not a stale disk copy).
2. Ask the agent to create `Projects/New/nested.md`.
   **Expect**: parent folders are created, the note appears, open editors/metadata refresh without a
   reload, and the response succeeds. Before overwriting an existing note, a best-effort snapshot is
   attempted; no false "undo" promise is shown if it fails.
3. Have the mock issue each unsafe request: `../outside.md`, an absolute path outside the vault, a
   relative path, `Private/secret.md`, `.obsidian/app.json`.
   **Expect**: each is refused with a distinct error (`outside vault`, `blacklisted`,
   `config-protected`, `malformed`/`relative`), **zero** vault reads/writes, and no clamping or
   redirecting to a safe path.
4. Make the snapshot destination unwritable, then write an existing note.
   **Expect**: the write still proceeds; the UI says the previous content could not be preserved
   (no false undo).

Failure modes: a blacklist bypass, a path that is silently rewritten into the vault, a file read
returning stale content, or a write that requires an Obsidian reload to appear.

### S3 — Remote attach over the VPN (US3; FR-005, FR-008…FR-016; SC-003)

1. Host desktop runs with the harness ready and the paired device listed.
2. On the remote (second desktop or phone), confirm host mode is unavailable/off; enter the host
   address and device code; attach.
   **Expect**: connected; the remote shows the host's stored sessions it owns; opening one renders
   the transcript; sending a message streams the host harness's reply; cancel and approvals behave
   as local.
3. On the second desktop, check the listener baseline and `pgrep -fl '<configured harness command>'`.
   **Expect**: no harness child, no new listener, no `.chat/sessions` files written on the remote.
4. Ask the agent (from the remote session) to edit a note; watch the host and the remote.
   **Expect**: the edit happens in the **host** vault and the remote sees the activity; the remote
   performs no filesystem write of its own.
5. Enter a wrong/revoked device code.
   **Expect**: attach rejected with a credential error; no session is created; no vault content or
   harness state is exposed; no retry storm.
6. Quit Obsidian on the host (or drop the VPN), then try to attach from the remote.
   **Expect**: clear **unreachable** state with bounded retries; no fallback to a local/public
   server; host history is unavailable until the host returns.
7. Two devices versus one host: with both attached, send from each.
   **Expect**: independent turns/sessions; neither sees the other's conversation.

Failure modes: a remote-spawned process, a remote listener, remote-local history files, an
unauthenticated attach that reaches a session, or a silent fallback path.

### S4 — Approvals routing and options (US4; FR-034…FR-038; SC-005)

1. Attach device A and device B. From A, trigger a turn that asks to write a note.
   **Expect**: only A sees one inline card built from the proposed change; B sees none.
2. Inspect the card's actions.
   **Expect**: exactly one action per option the harness offered, labelled from the harness's option
   names; no invented Approve/Reject pair; no auto-approval.
3. Choose one offered reject option.
   **Expect**: the harness receives exactly that `optionId`; the request cannot be answered again.
4. Trigger two permission requests in one turn.
   **Expect**: both cards are visible and independently resolvable in either order.
5. Leave a request pending and disconnect A (close the app / drop the VPN).
   **Expect**: the request is resolved **cancelled**; the transcript explains why the card
   disappeared; B still cannot answer it.
6. If the harness offers "always allow", choose it.
   **Expect**: that exact option is returned; the shell keeps no persistent allow/deny table (a later
   equivalent action asks again if the harness asks).

Failure modes: a card on the wrong device, a plugin-invented option, an auto-approval, or a pending
request that survives the disconnect.

### S5 — Declared controls and harness swap (US5; FR-039…FR-042; SC-002, SC-011)

1. Attach the mock harness's declared-controls scenario: two modes, a select config option, a
   boolean config option, and two commands.
   **Expect**: every declared control appears with its own name/type/current value/description; a
   declared option category the shell has never seen still renders; selections change the session.
2. Attach a harness declaring none of these.
   **Expect**: the corresponding control areas are absent — not disabled, not placeholder text, not a
   fixed model/thinking/agent trio.
3. Change only **Harness command** to a different ACP harness and reconnect.
   **Expect**: the same build attaches and completes a turn with no other setting or code change.
4. Inspect the handshake and session payloads (raw log/connection details).
   **Expect**: no harness identity, provider identity, model name, or provider credential is sent by
   the shell.

Failure modes: a hardcoded control set, a hidden unknown category, or a harness-specific branch.

### S6 — Faithful renderer, raw rows, unknown updates (US6; FR-043…FR-050; SC-010)

Use the mock harness's all-updates scenario (every known update kind + one unknown + tool content
variants + a tool call with no title).

1. Watch the turn.
   **Expect**: one card per tool-call id, title printed verbatim (or the programmatic name, then the
   kind, when title is absent), an icon only from ACP's fixed tool-kind enum, the ACP status and
   duration; later updates mutate the same card.
2. Inspect tool content variants.
   **Expect**: text as Markdown, diff as a diff, terminal output as terminal-style text,
   image/audio/resource-link/resource each as its own preview or link — none dropped because another
   is present.
3. Expand a card.
   **Expect**: locations visible (clickable when they resolve to a vault note), raw input/output
   behind a bounded Details disclosure.
4. Let the unknown kind arrive.
   **Expect**: a generic row showing the kind and a bounded raw payload disclosure — never dropped.
5. Open the turn's **ACP updates** disclosure and connection details.
   **Expect**: the turn's raw notifications in order, and the session's full raw record; both come
   from the stored record.
6. Check default presentation and density.
   **Expect**: updates are expanded and chronological by default; compact/grouped is an explicit
   opt-in setting, not the default.

Failure modes: a missing update kind, a rewritten tool title, a tool-name vocabulary, or an
unbounded raw payload rendered eagerly.

### S7 — Continuity: resume, load, neither, fresh-only (US7; FR-060…FR-067; SC-012)

Run the three mock variants first; then repeat key steps with a real harness.

1. **Resume-capable variant**: complete several turns, close the view, reopen the conversation.
   **Expect**: the transcript appears instantly from the record; `session/resume` is attempted; the
   next prompt uses the prior context; no history is replayed into the transcript; no duplicate
   turns.
2. **Load-only variant**: repeat the close/reopen.
   **Expect**: `session/load` replays history; the shell reconciles it against the record so nothing
   is rendered twice and the replay is not persisted as new turns (check the JSONL entry count).
3. **Neither-capability variant**: repeat the close/reopen.
   **Expect**: explicit choices **Continue with digest (default)**, **Start fresh**, and advanced
   **full-transcript replay**. No harness session is created until the user chooses. The digest is
   labelled as a shell-generated digest, bounded, deterministic (same record → same digest), and
   built only from the record — no model call.
4. **Restart cases**: kill the harness and reopen; reload Obsidian and reopen.
   **Expect**: the shell attempts reattach from the persisted identity first; on failure it shows an
   explicit state with the same choices and never auto-creates a replacement session.
5. **Fingerprint mismatch**: change the harness command (or point at a different vault/cwd) and
   reopen the stored conversation.
   **Expect**: resume is refused with an explanation; digest/fresh is offered instead of attaching to
   the wrong harness/vault.
6. **Mode/config reapply and permissions**: select a mode/config value, resume, and check.
   **Expect**: the last selected values are reapplied to that session; a permission request left
   pending before the restart is **not** restored — the harness must ask again.
7. **Fresh-only / deleted record**: externally delete or move a stored record (or use an imported
   conversation whose note parsed to no messages), then reopen the list.
   **Expect**: the deleted conversation is no longer offered and no replacement history is
   fabricated; a present-but-empty record offers Start fresh only, with no resume attempt.

Failure modes: a silent empty session, duplicated turns, replay entries appended to the record, or a
digest that calls a model.

### S8 — Multi-device, drops, reconnects (US8; FR-013, FR-015, FR-017; SC-006)

1. Attach two paired devices; run simultaneous turns.
   **Expect**: isolated sessions/transcripts/approvals; no cross-talk.
2. Mid-stream on one device, drop its network/VPN (`sudo tailscale down`, airplane mode, or unplug).
   **Expect**: that device marks the turn interrupted, stops appending, and never claims success; the
   other device is unaffected.
3. Restore the network within the retry budget.
   **Expect**: reattach within bounded attempts; already-rendered content is not duplicated; the
   prompt is not resent; the conversation continues.
4. Revoke the device on the host while it is connected.
   **Expect**: its access ends on the next operation; its connection closes; its pending approvals
   are cancelled.

Failure modes: duplicate prompt turns, a replayed transcript, a completed-looking interrupted turn,
or a revoked device that keeps working.

### S9 — Upgrade, legacy import, legacy removal (US9; FR-059, FR-068…FR-070, FR-074; SC-007, SC-008)

Use a **copy** of a vault that represents the old host setup: old `data.json`, a paired device, a
legacy `chat/` folder with canonical-block and prose-only session notes, and at least one unparseable
note. Back up the copy first.

1. Replace the old plugin build with the new build; load Obsidian.
   **Expect**: the host starts on the recorded port with the recorded harness command and no
   reconfiguration; the blacklist is preserved.
2. Connect the previously paired device with its existing code.
   **Expect**: accepted without re-pairing.
3. Let the first-run import complete.
   **Expect**: every parseable old conversation appears in the new session list; the canonical block
   is preferred and older prose notes are parsed; unparseable notes are skipped and counted in a
   migration report; **original notes are untouched** (compare checksums/`git status`); re-running the
   import imports nothing twice.
4. Send a new turn in an imported conversation.
   **Expect**: the new history is appended to the JSONL record; no Markdown session note is written
   or updated as the history model.
5. Inspect the runtime for the legacy path.
   **Expect**: no HTTP/SSE relay, no custom `AcpBridgeClient`, no note-based session writer/parser in
   the runtime (import-only reader allowed), no SSE/`turn_end`/`Last-Event-ID` envelope, no tool-name
   presentation dictionary.
6. Run the listener/process check.
   **Expect**: exactly one listener carrying the ACP-device and loopback MCP endpoints; the only
   extra process is the harness child.

```bash
cd plugin
ls src/host src/acp                 # legacy relay/client modules gone
grep -rn "AcpBridgeClient\|turn_end\|Last-Event-ID\|text/event-stream\|EventSource" src --include='*.ts'
grep -rn "toolAllowlist\|acpConfigOverrides\|NAME_CATEGORY\|VERBS" src --include='*.ts'
```

Expected: no output outside migration code/docs. Any remaining legacy listener, process, or note
writer is a failure even if the UI appears to work.

### S10 — MCP search, backlinks, links, tags, outline, metadata (FR-026…FR-033; SC-009)

1. With the host running, ask the harness to search the fixture vault for a known term, then ask for
   backlinks, outgoing links, tags, headings/outline, and metadata for a known note.
   **Expect**: correct fixture results from Obsidian's live metadata cache and the shared search
   index; results use vault-relative paths; search excludes blacklisted folders and `.obsidian/`.
2. Ask the harness to write/edit/delete through an MCP tool.
   **Expect**: no such tool exists; the call fails as an unknown tool; writes still go through ACP
   filesystem + permission.
3. Direct MCP access checks (optional but recommended):
   - `POST http://127.0.0.1:8765/mcp` with no token → `401`.
   - The same request from a non-loopback address → refused.
   - Only the session's per-session token works; it is never shown in the UI or the record.
4. Force the MCP server to be unavailable for a run (e.g. a build/flag that blocks it, or an
   intentionally failed bind).
   **Expect**: chat still works through ACP; the UI visibly says native vault tools are unavailable;
   tools do not return empty success.
5. Attach a harness that does **not** advertise `mcpCapabilities.http`.
   **Expect**: the host sends `mcpServers: []`, marks native vault tools unavailable for that run,
   and chat still works; no silent empty search results.

Failure modes: a write tool exposed over MCP, a blacklisted path visible in search, empty success on
failure, or any path-policy duplicate.

### S11 — Single listener, no extra process, mobile (FR-004, FR-008, FR-012, FR-071; SC-008, SC-015)

1. With the host enabled, run the process/listener commands from *Logs, records, processes,
   listeners* above.
   **Expect**: exactly one listening socket on the configured port (Obsidian process); exactly one
   harness child; no second server, daemon, launchd job, or bridge.
2. On a remote desktop, run the same checks before and after attaching.
   **Expect**: no new listener, no harness child, no local record directory.
3. Load the build on mobile.
   **Expect**: the plugin loads with no Node-only failure; host settings are absent; no spawn is
   attempted; remote attach works; no token/credential/file content appears in logs or status.
4. Check the attach indicator and connection details for secrets.
   **Expect**: mode/instance/health only; no tokens, credentials, provider keys, or file content.

## 5. Success-criteria map

| Criterion | Primary scenario |
|---|---|
| SC-001 one local turn, one process, one listener | S1, S11 |
| SC-002 two harnesses, no per-harness branch | S5 |
| SC-003 remote turn, remote spawns/listens/stores nothing, unauthenticated attach leaks nothing | S3 |
| SC-004 100% unsafe fs requests refused, zero vault ops | S2 |
| SC-005 approvals only offered options, only user action, 100% cancel on disconnect | S4 |
| SC-006 drop mid-turn → interrupted, bounded reconnect, 0 duplicate turns | S8 |
| SC-007 settings/devices preserved, notes import, originals untouched | S9 |
| SC-008 one listener, legacy gone, only harness child | S9, S11 |
| SC-009 six native queries correct, no MCP writes, no duplicate policy | S10 |
| SC-010 every update kind rendered, 0 dropped, no dictionary | S6 |
| SC-011 every declared control works, 0 fixed trio, 0 when none | S5 |
| SC-012 resume/load/digest choice, 0 duplicates, 0 silent sessions | S7 |
| SC-013 record survives crash, 0 credentials/image bytes | S1, S9 (record inspection) |
| SC-014 in-flight turn survives view close | S1 |
| SC-015 build/typecheck/tests pass, mobile loads, no secrets in logs/status | §2, S11 |

## 6. Record inspection checklist (SC-013)

After S1 and S9, inspect the record directly:

```bash
cd "<vault>/.chat/sessions"
ls -l                                   # one .jsonl per conversation
head -n 1 <sessionId>.jsonl             # header has resume identity/fingerprint/capabilities
tail -n 20 <sessionId>.jsonl            # prompt / update / permission / turn-boundary (`turn`) entries
grep -cE '"kind"[[:space:]]*:[[:space:]]*"prompt"' <sessionId>.jsonl
grep -nE '"credential"|"authorization"|data:image/|"api[_-]?key"' *.jsonl
```

Expected: the entry count and order match the transcript/turn history; every turn has a boundary;
`session/load` replay did not add entries; no credential/token field or image bytes are present.
A simulated crash (truncate the last line of a copy, or kill the process mid-append) must still open
with all earlier entries and a degraded notice — never a lost session.

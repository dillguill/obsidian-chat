# Phase 1 Data Model: ACP Shell

**Feature**: `004-acp-shell` · **Status**: Phase 1 design, 2026-11-07
**Sources**: [spec.md](./spec.md) (approved: 9 stories, 74 FRs, 15 SCs), [plan.md](./plan.md), and
the Phase 1 contracts — [acp-shell.md](./contracts/acp-shell.md),
[host-transport.md](./contracts/host-transport.md), [vault-mcp.md](./contracts/vault-mcp.md),
[session-store.md](./contracts/session-store.md).

ACP field names below refer to `@agentclientprotocol/sdk` **1.4.0**'s `schema.json` (the installed
schema is newer than the ACP v1 narrative; only v1-stable fields are relied on). MCP tool names refer
to the vault-MCP contract. Detailed wire shapes live in those contracts; this document fixes the
**model**: what exists, what it means, what must always be true, and how it is derived.

**Conventions used in this file**

- **Required** means the field MUST be present and non-null in a valid instance. **Optional** means
  absent or null is meaningful; readers MUST tolerate both. **Derived** means it is recomputed, not
  independently authored.
- `ACP X` means the schema type named `X` verbatim; the shell stores or forwards it unchanged unless
  a rule below says it is bounded or redacted.
- Times are epoch milliseconds unless an ACP field is an ISO-8601 string. Durations are milliseconds.
- `host` = the Obsidian desktop install with host mode enabled. `remote` = any install attached over
  the private network. `local session` = a session whose owning device is the host itself.
- Every entity MUST be **provider-agnostic**: no model id, provider id, provider SDK, provider
  credential, API key, or provider-specific branch. A model name may appear only inside an opaque,
  harness-declared control value, never as a shell field or decision input. (FR-002, FR-042)
- These entities MUST contain no device tokens, MCP session tokens, provider keys, or image bytes;
  secrets live only in settings (device credentials) or process memory (MCP token). (FR-058,
  FR-071, SC-015)
- Wire spellings in `contracts/session-store.md` use snake_case (`permission_request`,
  `permission_response`, `resume`). Phase 0 research **R6 / Resolved unknown 10** renames the
  turn-boundary entry kind to `turn` (or `turn_boundary`) because `turn_end` is the deleted SSE
  envelope name and the plan's grep gate forbids it. The record uses `turn` for the turn-boundary
  entry; the Phase-1 brief's label `turn-end` is its alias, and `turn_end` appears only as the
  rejected legacy name in verification greps. Model names here are the Phase-1 names requested by
  the design brief; the alias table in §4.3 is normative for implementers.

## 1. Entity map

```text
ShellInstance (1 per install)
├─ role=host ── HarnessAttachment (exactly 0..1; 1 when host enabled)
│              ├─ PairedDevice (0..n)
│              ├─ VaultService (exactly 1)
│              │   ├─ VaultCapabilityRequest (0..n, transient)
│              │   └─ VaultToolCall (0..n, transient)
│              └─ ShellSession (0..n; one per device that started one)
│                  ├─ SessionRecord (1) ── ProtocolUpdate (0..n entries)
│                  ├─ DeclaredControl (0..n, derived)
│                  ├─ PermissionRequest (0..n; recorded as entries)
│                  └─ ResumeState (1, derived + header snapshot)
└─ role=remote ── attach channel to one host; no HarnessAttachment, no VaultService,
                   no record writes; ShellSettings (1)
```

| Entity | Cardinality | Owner (plan module) | Persisted? |
|---|---|---|---|
| **ShellInstance** | 1 per install | `main.ts`, `shell/types.ts` | Role/identity in settings; runtime state transient |
| **HarnessAttachment** | 0..1 per host (1 when enabled) | `shell/local-transport.ts`, `shell/acp-client.ts` | No — reconstructed; fingerprint mirrored into record headers |
| **PairedDevice** | 0..n per host | `shell/device-auth.ts`, `settings.ts` | Yes — host `data.json` (credential secret included) |
| **ShellSession** | 0..n per host; 0..n visible per device | `session/store.ts`, `shell/acp-client.ts` | Derived from record + registry; live fields in memory |
| **VaultService** | exactly 1 per host | `vault/service.ts`, `vault/path-policy.ts` | No |
| **VaultCapabilityRequest** | 0..n per session | `vault/acp-fs.ts` | No (transient; never with file content) |
| **VaultToolCall** | 0..n per session | `vault/mcp-server.ts` | No (transient; never with file content) |
| **PermissionRequest** | 0..n per session | `acp/permissions.ts`, `ui/approval.ts` | Request/resolution are record entries |
| **SessionRecord** | exactly 1 per session | `session/record.ts`, `session/store.ts` | Yes — one JSONL file per conversation |
| **ProtocolUpdate** | 0..n per record | `session/record.ts` | Yes — entry lines |
| **DeclaredControl** | 0..n per session | `acp/controls.ts` | Derived from responses/updates; snapshot in header |
| **ResumeState** | exactly 1 per stored session | `session/resume.ts` | Snapshot in header; authoritative value recomputed on open |
| **ShellSettings** | 1 per install | `settings.ts` | Yes — plugin `data.json` |

## 2. Entities

### 2.1 ShellInstance

One Obsidian install with the plugin. It is either the **host** (owns a harness, the vault service,
the store, and the single listener) or a **remote** (a frontend attached to one host). There is no
third role and no simultaneous host+remote role. (FR-001, FR-004, FR-009, FR-012)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `instanceId` | string (opaque id) | ✔ | Stable per install; generated once and stored in settings. Never derived from hardware, user name, or vault path. |
| `displayName` | string | ✔ | Non-secret user-visible device name (defaults to the Obsidian platform name). Used in the pair list and connection details. |
| `role` | `host \| remote` | ✔ | Derived at startup: `host` only on desktop when host mode is enabled; `remote` otherwise, and always on mobile. Never user-editable independently of host mode. |
| `platform` | `desktop \| mobile` | ✔ | Obsidian runtime class. Gates spawn, MCP serving, fs serving, and host settings visibility. |
| `pluginVersion` | string | ✔ | Build identity for diagnostics and the attach indicator. |
| `vaultRef` | object | ✔ | `{ vaultId, vaultName, rootPath? }`. `rootPath` (absolute) exists on the host only and is never rendered; `vaultId`/`vaultName` identify which vault a session belongs to. |
| `attach` | object | ✔ | Non-secret attach summary: `{ mode: "local" \| "remote", hostAddress?, connectionState, lastError? }`. `connectionState` references §3.2. No token, no file content. (FR-071) |
| `harness` | HarnessAttachment | host only | Exactly one when host mode is enabled; absent on mobile/remote. |
| `devices` | PairedDevice[] | host only | Empty until the first pairing. |
| `vaultTools` | object | host only | `{ state: "available" \| "unavailable" \| "not_started", reason? }` for the loopback MCP server. (FR-031) |
| `protocolVersion` | integer | opt. | Negotiated ACP version once attached; null before the first `initialize`. |

**Invariants**

1. Exactly one role; role and host enablement cannot disagree. A remote MUST NOT own a harness, a
   vault service, an MCP server, a listener, or a session record. (FR-004, FR-012)
2. A host MUST own at most one HarnessAttachment and therefore exactly one harness child when
   enabled. A second prompt/session/device reuses that attachment and never starts another process.
   (FR-001, FR-005)
3. Mobile MUST be `remote`: host mode is absent and no spawn/MCP/fs-serving code path is reachable.
   (FR-004, FR-030, SC-015)
4. The attach indicator and connection details expose only mode, instance identity, health, and a
   sanitized error — never a token, credential, or file content. (FR-071)
5. No field may encode harness identity as a branch input. The configured command is the only
   harness input. (FR-002, FR-042)

**Relationships**: 1:0..1 HarnessAttachment (host); 1:0..n PairedDevice (host); 1:0..n ShellSession
(host; remote sees the subset its credential owns); 1:1 ShellSettings.

---

### 2.2 HarnessAttachment

The host's supervised relationship to the one spawned ACP harness. It is the source of the harness
lifecycle state, negotiated capabilities, and the fingerprint used by continuity. It contains **no
model, provider, or credential identity**. (FR-001, FR-002, FR-003, FR-042)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `instanceId` | string | ✔ | The ShellInstance that owns this attachment (always a host). |
| `command` | string | ✔ | Harvested from settings verbatim: the configured command line (e.g. `opencode acp`). Split quote-aware at spawn time. The only harness-selection input. (FR-002) |
| `argv` | string[] | ✔ | Quote-aware tokenization of `command`, computed at spawn. Never persisted with secrets; no shell interpolation (Windows `.cmd` shim is the documented exception). |
| `commandFingerprint` | string | ✔ | Stable, deterministic hash over the normalized argv + resolved absolute `cwd` (research R7: FNV-1a 64-bit over argv joined with NUL plus normalized cwd). Stored in record headers; never includes the environment or a credential. (FR-055, FR-064) |
| `cwd` | string (absolute) | ✔ | The vault root handed to `session/new`; the working directory the harness is spawned in. A different cwd refuses resume. (FR-001, FR-064) |
| `state` | enum (see §3.1) | ✔ | `stopped \| starting \| ready \| reconnecting \| failed`. Surfaced in settings and connection details. (FR-003) |
| `protocolVersion` | integer | opt. | Negotiated ACP protocol version; set only after `initialize`. Anything other than 1 is a hard attach failure. |
| `capabilities` | object | opt. | Snapshot of `agentCapabilities` used for gating: `{ loadSession, resume, prompt: { image, audio, embeddedContext }, mcp: { http, sse, acp } }`. Never guessed; default false until `initialize` returns. (FR-061) |
| `pid` | number | opt. | Live-only process id for the diagnostics/process check; never persisted or shown as identity. |
| `restartCount` | integer | ✔ | Number of unexpected-exit respawns since the attachment was created; reset only by an explicit successful start. |
| `retry` | object | opt. | `{ attempt, nextAt, budget }` for bounded exponential backoff. Budget exhaustion transitions to `failed`. (FR-003) |
| `lastExit` | object | opt. | `{ code?, signal?, unexpected: boolean, at }`. A deliberate stop sets `unexpected: false`. |
| `lastError` | object | opt. | `{ category, message, at }` with a sanitized message (no command secrets, env, tokens, or file content). Categories: `spawn_failed \| initialize_failed \| protocol_mismatch \| exited \| timeout \| session_failed`. (SC-015) |
| `startedAt` / `readyAt` | number | opt. | Lifecycle timestamps for the status surface. |
| `deliberateStop` | boolean | ✔ | True between an explicit host stop/disable/quit and the next explicit start. Suppresses respawn. (FR-003, FR-007) |

**Invariants**

1. At most one attachment and at most one harness child per host; enabling host twice cannot create a
   second. (FR-001, SC-001, SC-008)
2. Command and cwd are the only harness inputs; there is no model/provider/user-agent field, and the
   attachment is not constructed differently for different harnesses. (FR-002, FR-042)
3. Respawn only after an **unexpected** exit, only within the bounded backoff budget, and never after
   a deliberate stop. A spawn/configuration error (missing binary, bad arguments) goes to `failed`
   with the command named and no retry loop. (FR-003; US1 scenarios 3–4)
4. Capabilities are recorded exactly as returned by `initialize`; unsupported capabilities are never
   advertised or assumed. (FR-061)
5. Capability/fingerprint/cwd are copied into the SessionRecord header so continuity can be decided
   after a restart without re-handshaking. (FR-055, FR-063)
6. A harness failure never takes Obsidian down and never fabricates a completed turn. (FR-007, US1)

**Relationships**: 1:1 ShellInstance (host). 1:0..n ShellSession sessions run on it. Its capabilities
and fingerprint feed every ResumeState.

---

### 2.3 PairedDevice

A device credential that lets one remote attach to this host. Pairing is a host-side action; the
remote stores only its own credential. Credentials are secrets. (FR-009, FR-010, FR-017, FR-035)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `deviceId` | string (opaque) | ✔ | Stable internal identity, independent of the display name. Sessions reference this id. |
| `displayName` | string | ✔ | User-visible name (`phone`, `laptop`). Not unique: two devices may share a name and still get distinct ids/credentials. |
| `credentialSecret` | string | ✔ | The bearer credential presented on attach. Host-side settings only; never rendered after pairing, logged, recorded, or included in errors. (FR-071, SC-015) |
| `credentialFingerprint` | string | ✔ | Non-secret hash used in settings/connection details to distinguish devices without revealing the credential. |
| `createdAt` | number | ✔ | Pairing time. |
| `lastSeenAt` | number | opt. | Last successful authenticated attach; for the list only. |
| `state` | `active \| revoked` | ✔ | Revocation is immediate for subsequent operations and closes an already-open connection. (FR-017; US8 scenario 4) |
| `revokedAt` | number | opt. | Set with `state=revoked`; retained so the device list explains itself. |
| `sessionIds` | string[] | derived | Sessions owned by this device; scoping, never persisted as authority (the record/registry is). |

**Invariants**

1. Pairing and revocation are possible from plugin UI without hand-editing configuration files, and
   take effect without restarting Obsidian. (FR-017)
2. An unknown, malformed, or revoked credential is rejected **before** any session is created or any
   vault data is read; rejection is an auth failure, not a retryable network failure. (FR-010,
   FR-016, SC-003)
3. Every session is owned by exactly one device; another device can neither see nor answer that
   session's requests. (FR-013, FR-035)
4. Two devices with the same display name still get distinct `deviceId`s and distinct credentials.
   (Edge case, FR-017)
5. The credential never appears in the record, logs, status surfaces, transcript, or error text.
   (FR-071, SC-015)
6. Revocation cancels that device's parked permissions and stops serving its sessions. (FR-017,
   FR-036; US8 scenario 4)

**Relationships**: host ShellInstance 1:0..n; PairedDevice 1:0..n ShellSession; approval routing uses
`owningDeviceId`.

---

### 2.4 ShellSession

One conversation between one owning device and the host's harness. It is session-scoped, not
view-scoped: closing the chat view does not end it, and two views of the same session share it.
(FR-005, FR-013, FR-066, FR-067)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `sessionId` | string (opaque) | ✔ | Host-generated id used in ACP payloads, the record filename, and replay metadata. Contains no device or harness name. |
| `owningDeviceId` | string | ✔ | `instanceId` for a local session, otherwise the PairedDevice `deviceId`. Immutable; every operation is ownership-checked. (FR-013, FR-035) |
| `title` | string | opt. | Harness-declared title (from `session_info_update` / `session/list`) or an explicit user rename. |
| `titleSource` | `harness \| user \| first_prompt \| none` | ✔ | Keeps provenance honest; `first_prompt` is a UI-only truncation, not a fabricated title sent to the harness. (FR-049) |
| `harnessSessionId` | string | opt. | The ACP session id returned by `session/new`/`session/resume`/`session/load`. Required for resume/load; null for imported records and before creation. Never invented. |
| `effectiveResumeIdentity` | object | derived | Latest harness session identity: the header's `harnessSessionId` unless a later `resume-event` entry recorded a new one (digest/fresh continuation). See §4.3. |
| `cwd` | string (absolute) | ✔ | Host vault root used for this session. Must equal the current attach cwd for resume. (FR-064) |
| `commandFingerprint` | string | ✔ | Harness fingerprint the session was created/attached with. Must equal the current attach for resume. (FR-064) |
| `protocolVersion` | integer | opt. | Negotiated version for this session's attach. |
| `capabilities` | object | opt. | Capability snapshot used for this session's continuity decision (same shape as §2.2). |
| `recordRef` | object | ✔ | `{ sessionId, path, formatVersion }` — the one SessionRecord backing this session. |
| `recordState` | enum | ✔ | `live \| degraded \| write_failed \| unreadable \| deleted`. Degraded/write-failed/unreadable are surfaced in the session list and transcript. (FR-057; edge "store write fails") |
| `resumeState` | ResumeState | ✔ | Current continuity classification; recomputed on open/reattach. |
| `controls` | object | ✔ | `{ modes?, configOptions?, commands? }` exactly as the harness declared. Empty/absent means the corresponding UI control is absent. (FR-039, FR-040) |
| `lastSelected` | object | opt. | `{ modeId?, configValues: Record<configId, value> }` — the session's last user selections, persisted so they can be reapplied after resume. Values are opaque. (FR-065) |
| `turn` | object | ✔ | `{ number, state: idle \| prompting \| cancelling \| interrupted, startedAt?, promptSeq?, pendingPermissionIds: string[] }`. At most one active turn. |
| `viewCount` | number | derived | Number of open chat views attached to this session; used to prove the two-view invariant. (FR-067) |
| `createdAt` / `updatedAt` | number | ✔ | Session lifecycle; `updatedAt` is the last record entry time, not view activity. |
| `deletedAt` | number | opt. | Explicit user deletion; the record and registry entry are removed after confirmation. |

**Invariants**

1. One owning device and one record per session; ownership is checked on every request and never
   transferred. (FR-013, FR-035)
2. Sessions are isolated: two devices on the same host never share a session, transcript, or
   approval. (FR-013; US3 scenario 6, US8 scenario 1)
3. Session state (turn accumulation, streaming status, pending permissions) lives with the session,
   not the view. View attach/detach never closes the harness session, and reopening shows the
   complete or interrupted turn. (FR-066, SC-014)
4. Two views of the same session render the same state and never create a second session or a
   duplicated turn. (FR-067)
5. At most one prompt is in flight. A second prompt while `turn.state=prompting` is rejected locally
   with a clear error; the session is not corrupted. (Spec edge case; FR-015)
6. The session is never created as a side effect of reconnect or view open. A new harness session is
   created only by an explicit user action in the continuity choice, or by starting a new
   conversation. (FR-060, FR-062)
7. After resume, `lastSelected` is reapplied; pending permissions are never restored — the harness
   must ask again. (FR-065)
8. `controls` reflects declarations only; an undeclared mode/config/command is absent, never
   defaulted or replaced with a plugin-owned set. (FR-039, FR-040, FR-052)

**Relationships**: 1:1 SessionRecord; 1:0..n PermissionRequest; 1:0..n DeclaredControl; 1:1
ResumeState; belongs to 1 HarnessAttachment (host) and 1 PairedDevice/owner.

---

### 2.5 VaultService

The single in-process implementation of vault semantics for the host. It is called by the ACP
filesystem adapter, the read-only MCP tools, and the shell's own `@mention` index; none of them may
read files, build a second index, or implement a second policy. (FR-023, FR-024, FR-029)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `instanceId` | string | ✔ | One instance per host process; remote/mobile never construct a serving instance. |
| `vaultRoot` | string (absolute) | ✔ | Host vault root; the base for lexical confinement and the cwd fingerprint. Never rendered to a remote. |
| `vaultName` / `vaultId` | string | ✔ | Identity used in session headers and attach indicators. |
| `policy` | PathPolicy | ✔ | `{ vaultRoot, blacklistFolders, protectedPaths: [".obsidian", ".trash", <session-store folder>], caseSensitivity, reservedNames }`. Pure lexical normalization/verdict logic; no I/O. `.obsidian/` is unconditional; the store folder and `.trash/` are protected config paths per research R9. (FR-022) |
| `blacklistSource` | reference to ShellSettings | ✔ | The **same** live list used by ACP fs, MCP, and the mention index; no copies. (FR-023) |
| `searchIndex` | object | ✔ | `{ docs, builtAt, dirty }` BM25 index over vault Markdown; backs MCP `search_notes` and `@mention`; invalidated by vault events. (FR-027) |
| `metadata` | adapter | ✔ | Obsidian `MetadataCache` queries: `resolvedLinks`, backlinks, tags, headings, frontmatter. Live cache, not a second store. (FR-027) |
| `editor` | adapter | ✔ | Open-editor awareness: current text for reads, refresh after writes. (FR-019, FR-020) |
| `snapshots` | object | ✔ | `{ mode: "best_effort", captured: Map<sessionId, Set<path>> }` — first-write-per-path bookkeeping; the captured content is a recovery aid, not history. (FR-021) |
| `availability` | `ready \| degraded \| unavailable` | ✔ | `unavailable` disables MCP tools visibly while ACP chat continues. (FR-031) |
| `lastError` | object | opt. | `{ category, message, at }`, sanitized. |
| `writesExposedToMcp` | `false` (constant) | ✔ | Structural marker of the one-write-path rule. (FR-025, FR-028) |

**Invariants**

1. Path normalization/confinement and the blacklist exist once, in this service's policy, and are
   used identically by ACP fs, MCP tools, and the mention index. (FR-023, FR-029, SC-009)
2. No direct disk I/O and no second content index; all reads/writes go through Obsidian's Vault API
   and its metadata cache. (FR-024)
3. Reads return what Obsidian currently sees, including an open editor, and honour `line`/`limit`.
   (FR-019)
4. Writes create missing parent folders, create/overwrite through Vault operations, refresh open
   editors and metadata without reload, and return success. (FR-020)
5. Before the first write to a path in a session, a best-effort snapshot is attempted; failure is
   reported and never blocks the write. (FR-021)
6. Refused paths perform zero vault operations, are never clamped/redirected, and error text names
   the policy (`outside vault`, `blacklisted`, `config-protected`, `malformed`), never the file's
   content. (FR-022, SC-004, SC-015)
7. The service is host-only and desktop-only for serving; a remote never serves vault capabilities or
   MCP. (FR-012, FR-018, FR-030)
8. Local vault side effects are limited to the session store, the read-only mention index, advisory
   rules reads, pre-write snapshots, and the read-only MCP tools. (FR-072)

**Relationships**: called by 0..n VaultCapabilityRequest and 0..n VaultToolCall; backs the mention
index; provides metadata to the session/store layers.

---

### 2.6 VaultCapabilityRequest

One ACP filesystem request handled by the host through the shared service. It is a transient audit
record, not a session-record entry and never persisted with file content. (FR-018…FR-025)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `requestId` | string/number | ✔ | JSON-RPC id on the harness↔host transport, for response correlation. |
| `sessionId` | string | ✔ | The session that asked. The request is served by the host even for a remote-owned session. |
| `turn` | number | opt. | Turn association when the request occurs inside a prompt. |
| `method` | `fs/read_text_file \| fs/write_text_file` | ✔ | Only these two are registered. `terminal/*` and any other method are unhandled. (FR-018) |
| `rawPath` | string | ✔ | Path exactly as received (absolute per ACP). Never normalized in place. |
| `normalizedPath` | string | opt. | Vault-relative path after lexical normalization; null when refused (escapes, relative, NUL, malformed). |
| `policyVerdict` | `allowed \| outside_vault \| blacklisted \| config_protected \| malformed \| relative` | ✔ | One verdict per request, before any vault operation. (FR-022) |
| `line` / `limit` | number | opt. | Read-only line window, 1-based `line`; both bounded. (FR-019) |
| `contentChars` | number | opt. | Write-only size for diagnostics; the content itself is never retained here. |
| `snapshot` | object | opt. | Write-only: `{ attempted, captured, reason? }`, indicating the best-effort pre-write snapshot. (FR-021) |
| `editorRefresh` | object | opt. | `{ requested, refreshedPaths }` after a successful write. (FR-020) |
| `outcome` | `ok \| refused \| error` | ✔ | Result classification. `refused` implies zero vault operations. |
| `errorCategory` | enum | opt. | `outside_vault \| blacklisted \| config_protected \| malformed \| relative \| not_found \| io_error`. Distinct from the snapshot notice. |
| `startedAt` / `durationMs` | number | ✔ | Latency and audit. |

**Invariants**

1. Confinement is evaluated after lexical normalization; `..` escapes, absolute-outside, relative,
   NUL, and malformed paths are refused. (FR-022; US2 scenario 3)
2. `.obsidian/` is refused unconditionally, even if absent from the blacklist; blacklist refusals
   are distinguishable from outside-vault refusals. (FR-022; US2 scenarios 4–5)
3. Refusal means zero vault reads/writes and no clamping or redirection. (FR-022, SC-004)
4. Reads reflect the current editor content and apply the optional line window. (FR-019)
5. Writes create missing parents, create/overwrite, refresh editors/metadata, and succeed before the
   response is returned. (FR-020)
6. Snapshot is attempted before the first write to a given path in a session; failure is reported but
   never blocks or silently implies a valid undo. (FR-021; US2 scenario 6)
7. The ACP fs path is the only write path; there is no MCP write equivalent. (FR-025)
8. The request carries no file content to the record or the UI status surface. (FR-058, FR-071)

**Relationships**: N:1 ShellSession; N:1 VaultService. May be preceded by a PermissionRequest for the
same proposed write (the shell does not itself decide permission; the harness asks).

---

### 2.7 VaultToolCall

One read-only MCP vault tool invocation served by the host's in-process MCP server. It is transient
and never persisted with file content; the transcript only shows it if the harness reports an ACP
tool call/update. (FR-026…FR-033)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `callId` | string/number | ✔ | JSON-RPC id for the MCP response. |
| `sessionId` | string | ✔ | Session whose per-session MCP token authorized the call. |
| `mcpTokenId` | string | ✔ | Identity/fingerprint of the per-session token, never the token. (FR-026) |
| `toolName` | enum | ✔ | `search_notes \| get_backlinks \| get_links \| list_tags \| get_outline \| get_note_metadata`; anything else is `unknown`. (FR-027, FR-028) |
| `arguments` | object | ✔ | Validated arguments only (`query`, `path`, `limit`, `folder`, `tags`, `prefix`); bounded sizes. |
| `policyVerdict` | `allowed \| outside_vault \| blacklisted \| config_protected \| malformed \| not_found \| not_applicable` | ✔ | Same policy/engine as ACP fs; `not_applicable` for pathless tools. (FR-029) |
| `result` | object | ✔ | `{ ok, isError, resultCount, resultBytes, truncated }`; no content copy. |
| `errorCategory` | string | opt. | Safe category/message; no file content or token. |
| `startedAt` / `durationMs` | number | ✔ | Bounds/observability. |
| `unknownTool` | boolean | ✔ | True for any write-shaped or unrecognized tool attempt; returned as a standard MCP unknown-tool error, never executed. (FR-028; edge "write-shaped MCP tool") |

**Invariants**

1. Only the six read-only tools exist; no write/edit/append/move/delete/rename/command/terminal tool
   may be registered. (FR-028, SC-009)
2. Every tool calls VaultService; no tool reads files directly or duplicates path/blacklist logic.
   (FR-029)
3. Search excludes blacklisted folders and `.obsidian/` invisibly; direct path tools return an
   `isError` tool result with a safe message. (FR-027, FR-029)
4. The server is in-process on the host, loopback-only, authenticated by a per-session token, and
   advertised in `session/new`'s `mcpServers` when the harness advertises HTTP MCP; otherwise the
   host sends `mcpServers: []` and shows the tools unavailable. It is absent on mobile/remote.
   (FR-026, FR-030; research R4)
5. Only the shell's vault server is advertised; no third-party MCP servers are forwarded. (FR-033)
6. If the server is unavailable, chat still works over ACP and the UI says the native vault tools are
   unavailable for this run; tools never return empty success. (FR-031)
7. A tool failure is an MCP tool result (`isError`), not a transport/protocol failure. (FR-032; MCP
   contract)
8. No token, credential, or file content appears in arguments logged, errors, or the record. (SC-015)

**Relationships**: N:1 ShellSession; N:1 VaultService; 1:1 per-session MCP token (memory only).

---

### 2.8 PermissionRequest

One harness approval request, routed only to the owning device. Exactly one resolution is possible,
and only an explicit user action may select an option. (FR-034…FR-038)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `requestId` | string | ✔ | Stable id for this pending request (host-generated when multiplexing the transport; mirrors the ACP request). |
| `sessionId` | string | ✔ | The session that owns the request. |
| `owningDeviceId` | string | ✔ | Routing target; no other device sees the request. (FR-035) |
| `turn` | number | ✔ | Turn in which the harness asked. |
| `toolCall` | ACP `ToolCallUpdate` (bounded) | ✔ | The real proposed change: `toolCallId`, `title`, `name?`, `kind`, `status`, `content[]`, `locations[]`, `rawInput?`, `rawOutput?`. Rendered from these fields alone. (FR-034) |
| `options` | ACP `PermissionOption[]` | ✔ | The harness's own offered options, in order: `{ optionId, name, kind }`. At least one. Never invented, renamed, or collapsed into Approve/Reject. (FR-034, FR-037) |
| `state` | `pending \| selected \| cancelled` | ✔ | Terminal after one resolution. |
| `resolution` | object | opt. | `{ outcome: "selected", optionId } \| { outcome: "cancelled" }`, `resolvedAt`, `resolvedByDeviceId?`, `reason?`. |
| `cancelReason` | enum | opt. | `user_cancel \| session_teardown \| device_disconnect \| transport_loss \| device_revoked \| host_shutdown`. (FR-036) |
| `transcriptNotice` | string | opt. | Reference to the visible explanation appended when a pending card disappears. (FR-036) |
| `createdAt` | number | ✔ | Arrival time. |

**Invariants**

1. Exactly one resolution per request; `pending` is the only non-terminal state. (FR-034, FR-036)
2. Visible to and answerable by only the owning device; other devices receive a policy error, not
   data. (FR-035, FR-013)
3. The response is exactly one of the harness's `optionId`s (`selected`) or `cancelled`; one action
   per offered option; the shell never invents an option or answers for the user. (FR-034, FR-037,
   SC-005)
4. No auto-approval, no timeout-approval, no persistent allow/deny table, and no inspection of the
   tool call to decide whether it may run. (FR-037)
5. On explicit cancel, session teardown, device disconnect, revocation, or transport loss, every
   parked request for the session is resolved `cancelled` **before** the session ends, and the
   transcript explains why the card disappeared. (FR-036)
6. The shell never executes the proposed tool call; the approval gates the harness's action only.
   (FR-038)
7. Pending requests are never restored after resume; the harness must ask again. (FR-065)
8. Card content and raw details are bounded/lazy in the UI; the record stores the request and
   resolution as entries, not the rendered card. (FR-046, FR-050)

**Relationships**: N:1 ShellSession; 1:1 ProtocolUpdate (`permission-request` / `permission-resolution`
entries); routed by PairedDevice ownership.

---

### 2.9 SessionRecord

The canonical, host-owned, append-only structured log for one conversation. It backs the transcript,
the raw view, continuity, session listing, and the digest. It is **not** a Markdown note and has no
second source of truth. (FR-053…FR-058)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `sessionId` | string | ✔ | Record identity, same as ShellSession. |
| `path` | string (vault-relative) | ✔ | `<storeFolder>/<sessionId>.jsonl`; `storeFolder` is a setting, default `.chat/sessions/`. (FR-056) |
| `formatVersion` | integer | ✔ | `1` for v1; readers tolerate unknown fields/entry kinds. |
| `header` | Header object | ✔ | One header first line: resume identity, capability snapshot, owning device, cwd/fingerprint, initial title, last selected controls, origin. See §4.2. |
| `entries` | ProtocolUpdate[] | ✔ | Ordered append-only entries; sequence strictly increasing. |
| `lastSeq` | integer | derived | Highest valid entry `seq`; the authoritative tail (header `lastSeq` is best-effort). |
| `byteSize` | number | derived | For list/health diagnostics. |
| `degraded` | object | opt. | `{ flag, reasons: [malformed_line, truncated_tail, seq_gap, external_modification, write_error], skippedLines, gapRanges, tailTruncated }`. (FR-057) |
| `writeState` | `ok \| write_failed \| read_only` | ✔ | A write failure is visible in the UI and never silently loses live content. |
| `createdAt` / `updatedAt` | number | ✔ | Created from the header; updated from the last valid entry. |
| `origin` | `live \| legacy_import` | ✔ | Imported records carry provenance and have no harness session identity. (FR-059) |
| `provenance` | object | opt. | `{ originPath, originMtime, originHash, importedAt, tokens? }` for imported records (research R6; `migration` is a model alias). (FR-059) |

**Invariants**

1. Exactly one record per conversation; append-only: never rewrite, reorder, or truncate earlier
   entries. (FR-053, FR-057)
2. Contains an ordered entry for every prompt, ACP session update, permission request/resolution,
   and turn boundary. (FR-053, SC-013)
3. The header records resume identity and the capability snapshot: harness session id, cwd, harness
   command fingerprint, protocol version, capabilities, last known sequence, and the session's last
   selected modes/config values. (FR-055)
4. Stored in the vault's configured session folder (default hidden `.chat/sessions/`), durable with
   the vault, outside the ordinary note surface. (FR-056)
5. A malformed/truncated entry is skipped; the affected session is reported degraded; the rest of the
   session and all other sessions are preserved. (FR-057; edge "record malformed/truncated")
6. The record contains no provider credential, device/MCP token, image bytes, or audio bytes; image
   and binary tool content is represented by name/type/size only. (FR-058, SC-013)
7. `session/load` replay is reconciled against the record and never persisted as new entries; live
   updates during the session are appended normally. (FR-061)
8. The digest and the raw view are projections of this record, never separate stores. (FR-048,
   FR-062)
9. External deletion removes the session from the list; the chat never fabricates replacement
   history. (Edge "record deleted externally")
10. No Markdown session history is written; optional note export is out of scope. (FR-054)

**Relationships**: 1:1 ShellSession; 1:0..n ProtocolUpdate; its header feeds the session list and the
ResumeState; `migration.json` references imported records.

---

### 2.10 ProtocolUpdate

One stored prompt or ACP notification inside a SessionRecord: sequence, timestamp, turn association,
kind, and payload. Entries are immutable once appended and rendered either by a dedicated view or as
a generic raw row. (FR-043, FR-048, FR-053)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `seq` | integer ≥ 1 | ✔ | Monotonic per record, assigned by the single writer; replay/dedupe key. |
| `ts` | number | ✔ | Arrival/record time (epoch ms). |
| `turn` | integer | opt. | 1-based turn number; prompts start it, updates/permissions carry it, the `turn` entry (wire kind `turn`) closes it. Absent/irrelevant for record-level `resume`/`meta`/`error`. |
| `kind` | enum | ✔ | `prompt \| update \| permission-request \| permission-resolution \| turn \| resume-event \| error` (+ the contract's `meta`, §4.3). `turn` is both the model variant and the wire kind (research R6; brief alias `turn-end`). |
| `v` | integer | ✔ | Entry format version (`1`), so unknown future fields can be tolerated. |
| `origin` | `live \| legacy_import` | ✔ | Imported entries are labelled and never emitted as live traffic. |
| `payload` | variant object | ✔ | Kind-specific body (§4.3). ACP fields are stored verbatim except for documented bounds/redactions. |
| `late` | boolean | opt. | True for an update that arrived after its turn's `turn` entry; still stored and shown in raw; transcript attaches it after the settled answer with a late marker. (ACP contract §4) |
| `truncated` | object | opt. | `{ flag: true, originalBytes }` when the per-entry raw bound truncated the payload; never presented as complete. (FR-050; store contract §8) |

**Invariants**

1. Every ACP `session/update` kind the harness sends is recorded, including unknown/unstable kinds;
   none is dropped. (FR-043, SC-010)
2. Entries are never rewritten or deleted individually. (FR-053)
3. `seq` is strictly increasing with no reuse; a gap can only result from a crash/malformed line and
   is reported as degraded, never back-filled. (§4.4)
4. A control-only update (`current_mode_update`, `config_option_update`,
   `available_commands_update`, `session_info_update`) is recorded as an `update` entry and applied to
   derived control state; it does not become transcript prose. (FR-039, FR-043)
5. A prompt entry stores only that turn's blocks; image attachments are name/type only, never bytes.
   The same rule applies to binary tool-content payloads (image/audio): the record stores a type/name/
   size marker, never the bytes. (FR-058, SC-013)
6. The `turn` boundary entry is appended only from the prompt's actual resolution (`stopReason`); an interrupted
   harness or transport loss is recorded explicitly as interrupted/error, never fabricated as a
   normal completion. (US1 scenarios 2–3; ACP contract §4)
7. Raw payloads remain local-only and are not copied into visible transcript text or error messages.
   (FR-050)
8. Permission entries appear in arrival order, and exactly one resolution entry follows each request.
   (FR-034, FR-036)
9. Imported entries are marked `legacy_import`, are never re-emitted live, and preserve only fields
   the legacy note actually contained. (FR-059)

**Relationships**: N:1 SessionRecord; N:0..1 turn; N:0..1 `toolCallId` (derived from update payload);
`permission-resolution` references a `permission-request` by `requestId`.

---

### 2.11 DeclaredControl

One mode, config option, or slash command exactly as the connected harness declares it. The composer
renders exactly this set — no hardcoded model/thinking/agent trio, no fallback set. (FR-039…FR-042,
FR-052)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `kind` | `mode \| config_option \| command` | ✔ | Which declaration surface it came from. |
| `id` | string | ✔ | Harness identifier: `modeId`, `configId`, or command `name`. Opaque; forwarded unchanged. |
| `displayName` | string | ✔ | The harness's declared name/label, rendered verbatim. For a command, the command name. |
| `description` | string | opt. | Harness description, rendered when present; never invented. |
| `type` | `mode \| select \| boolean \| command` | ✔ | The declared ACP shape. A config option is `select` or `boolean`; an unknown/future type is rendered generically, not hidden. |
| `currentValue` | string \| boolean | opt. | Current mode id / selected value id / boolean. Never defaulted by the shell. |
| `options` | object[] | opt. | For `select`: flattened `{ valueId, name, description?, group? }` in declared order, groups preserved for display. For commands: absent. |
| `category` | string | opt. | ACP's optional UX category. Stored for presentation only; **never** used to hide/filter a control. |
| `sourceSeq` | integer | ✔ | The session response or update `seq` that declared/refreshed it. |
| `declared` | boolean | ✔ | Always true for an existing instance; absence of an instance is what "not declared" means. |

**Invariants**

1. The rendered set equals the declared set, including unknown categories and never-before-seen
   option types. (FR-039, FR-040; US5 scenario 5)
2. No control appears when the harness declares none; the composer control area is empty, not
   disabled or defaulted. (FR-040, FR-052; US5 scenario 2)
3. Selecting a mode/config option sends the harness's own id/value unchanged, and affects only the
   current session. (FR-041)
4. Config-option updates replace the declared set; current-mode updates change only the current
   value; command updates replace the command list. (FR-039)
5. The shell never interprets a value (e.g. it does not know what a model/thinking value means) and
   never synthesizes provider semantics. A declared value named after a model is still opaque.
   (FR-040, FR-042)
6. Nothing in the handshake or session payload is populated from harness/provider identity. (FR-042)

**Relationships**: N:1 ShellSession; sourced from 1 `NewSessionResponse` / `ResumeSessionResponse` /
`LoadSessionResponse` and subsequent `update` entries; changes are recorded as `update` entries.

---

### 2.12 ResumeState

A stored session's ability to reattach: resumable via `session/resume`, only via `session/load`,
digest-only, or fresh-only — plus the reason and the identity the decision was made against.
(FR-060…FR-067)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `sessionId` | string | ✔ | The stored session being evaluated. |
| `state` | `resume-capable \| load-only \| digest-only \| fresh-only` | ✔ | Capability class for this open/attach attempt (see §3.3). This is the canonical vocabulary, matching the store contract and research R7. |
| `reason` | enum | ✔ | Why this class was chosen: `resume_advertised`, `load_advertised`, `no_capability`, `fingerprint_mismatch`, `cwd_mismatch`, `protocol_version_mismatch`, `session_missing_on_harness`, `reattach_failed`, `record_missing`, `record_empty`, `record_unreadable`, `imported_no_harness_session`, `harness_unreachable`. |
| `evaluatedAgainst` | object | ✔ | `{ commandFingerprint, cwd, protocolVersion?, capabilities }` — the current attach used for the decision. (FR-055, FR-064) |
| `evaluatedAt` | number | ✔ | Last evaluation time. |
| `lastAttempt` | object | opt. | `{ method: resume \| load \| digest \| fresh \| full_replay, result: success \| failed \| refused, reason?, at, replay?: { replayed, deduped, ephemeral, gaps } }`. |
| `lastUserChoice` | enum | opt. | `resume \| load \| digest \| fresh \| full_replay`, recorded only after an explicit user action. |
| `digest` | object | opt. | `{ available, turnsIncluded, turnsOmitted, chars, hash }` — metadata of the deterministic digest, not the digest text. (FR-062) |
| `recordState` | enum | ✔ | Mirrors the record's usability (`live \| degraded \| unreadable \| missing`) because continuity depends on it. |

**Invariants**

1. The ladder is strict: `session/resume` when advertised, else `session/load` when advertised, else
   the explicit digest/fresh/full-replay choice. Never a silent `session/new`. (FR-060, FR-061,
   FR-062; SC-012)
2. Resume never replays history into the transcript; load replays are reconciled and not persisted as
   new turns. (FR-061)
3. Fingerprint or cwd mismatch refuses resume with an explanation and offers digest/fresh; it never
   attaches to the wrong harness or vault. A changed agent software version is a warning, not a
   refusal (research R7); a changed command/fingerprint, cwd, or protocol version is a refusal.
4. After an Obsidian reload or harness respawn, the persisted registry is used to attempt reattach
   before declaring the session dead; failure exposes the same explicit choices. (FR-063)
5. A successful resume reapplies the session's last selected modes/config values; pending permissions
   are not restored. (FR-065)
6. The digest is deterministic, bounded, labelled, built only from the record, and requires no model
   call. (FR-062)
7. Imported records (no harness session id) are never resume-capable; they are digest-only or
   fresh-only. (FR-059; continuity)
8. The state is recomputed, not taken blindly from the header; the header snapshot is the last
   known state used for listing and restart recovery. (FR-055, FR-063)

**Relationships**: 1:1 ShellSession; derived from SessionRecord header + current HarnessAttachment +
the persisted registry; its attempts are recorded as `resume-event` entries.

---

### 2.13 ShellSettings

Persisted configuration for one install. It holds role/host enablement, the harness command, host
address/port/interface, paired devices and credentials, session-store location, folder blacklist,
attach target for a remote, and UI preferences. (FR-006, FR-056, FR-068, FR-069)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `role` / `host.enabled` | boolean + derived role | ✔ | Desktop-only host enablement; mobile always remote. Role is derived, not independently stored as truth. (FR-004) |
| `host.command` | string | host only | The configured ACP harness command. The only harness input. (FR-002) |
| `host.port` | integer 1024–65535 | host only | Listener port; validated with a visible error. (FR-068) |
| `host.bind` | object | host only | `{ mode: "loopback" \| "private" \| "custom", addresses[], widerBindConfirmed: boolean }`. Default loopback; wider bind requires explicit confirmation. (FR-006) |
| `host.devices` | PairedDevice[] | host only | Display name + credential secret + state. Credentials never rendered after pairing. (FR-017, FR-071) |
| `remote` | object | remote only | `{ hostAddress, deviceCredential, retryBudget? }`. The credential is a secret; no host/MCP serving is configured here. (FR-009, FR-012) |
| `store.folder` | string | ✔ | Vault-relative session-store folder; default `.chat/sessions/`. (FR-056) |
| `blacklistFolders` | string[] | ✔ | The single blacklist list used by ACP fs, MCP, and the mention index. (FR-023) |
| `ui` | object | ✔ | `{ spacing: "comfortable" \| "compact", activityDensity: "chronological" \| "grouped", sendShortcut }`. `activityDensity` defaults to `chronological`; expanded/chronological is the default presentation, grouping/collapsing is opt-in only. (FR-047, FR-073) |
| `migration` | object | opt. | `{ completedAt, legacyFolder, report: { imported, skipped, failed, reasons[] }, idempotencyLedgerPath }`. (FR-059, FR-069) |
| `legacy` | object | transitional | Old `gateway`/`chatFolder`/`host`/tool-allowlist values read once for upgrade. Not a runtime fallback; deleted with the legacy path. (FR-069, FR-070) |
| `validation` | object | derived | Per-field validity/message for the settings UI; never contains secrets. (FR-068) |

**Invariants**

1. Validation is explicit and visible for every field (port range, absolute store folder, non-empty
   command, bind confirmation, blacklist normalization). (FR-068)
2. Upgrade preserves host settings, harness command, port, paired-device credentials, session-folder
   discovery, and blacklist; no re-pairing and no reconfiguration. (FR-069, SC-007)
3. The default bind is loopback; listening beyond the private network requires explicit user
   confirmation and is never implicit. (FR-006)
4. There is exactly one blacklist setting, shared by every consumer. (FR-023)
5. No provider/model/API-key field exists anywhere; the shell holds only device credentials and
   (in memory) the per-session MCP token. (FR-042)
6. Secrets are masked in the UI, excluded from logs/errors/status, and never copied into records.
   (FR-071, SC-015)
7. Host fields are absent on mobile; remote fields are absent on a host's local chat. (FR-004)
8. UI preferences change presentation only; they never alter protocol payloads, approvals, path
   policy, or the record. (FR-047, FR-073)
9. Legacy settings are migration input only and MUST be removed with the legacy path. (FR-070,
   FR-074)

**Relationships**: 1:1 ShellInstance; supplies VaultService policy/blacklist, HarnessAttachment
command/port/cwd, PairedDevice credentials, and ResumeState's expected fingerprint inputs.

## 3. State machines

### 3.1 Harness lifecycle

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `stopped` | host enabled / Obsidian starts with host enabled | desktop, command configured, no deliberate stop | `starting` | Spawn exactly one child; no other process |
| `starting` | `initialize` succeeds, protocol version 1 | — | `ready` | Cache capabilities; persist fingerprint/capabilities in new session headers; resume existing registry sessions |
| `starting` | spawn ENOENT / bad arguments / invalid command | — | `failed` | Named configuration error; no retry loop; no second process (US1 scenario 4) |
| `starting` | `initialize` timeout / protocol mismatch | timeout/mismatch | `failed` | Sanitized error; attach impossible until settings change or manual retry |
| `ready` | unexpected child exit / stream error | `deliberateStop=false` | `reconnecting` | Interrupt in-flight turn; cancel parked permissions; mark sessions needing reattach |
| `reconnecting` | backoff elapsed | attempt < budget | `starting` | Respawn one child; increment `restartCount` |
| `reconnecting` | budget exhausted | attempt ≥ budget | `failed` | Stop retrying; surface failure with manual retry/config link |
| `ready` / `starting` / `reconnecting` | host disabled / Obsidian quit | deliberate stop | `stopped` | Kill child; clear retry timer; cancel sessions/permissions cleanly; no respawn |
| `failed` | command changed / manual retry / host re-enabled | valid config | `starting` | New attempt from a clean state |
| `failed` / `stopped` | host disabled | — | `stopped` | No process; state surfaced as disabled |

Rules: never two children (FR-001/005); never respawn after a deliberate stop (FR-003); a harness
failure never takes Obsidian down (FR-007); mobile never enters this machine (FR-004); state is
visible in settings/connection details (FR-003).

### 3.2 Connection state

Used for a remote's attach channel and, host-side, for each paired device's connection. The local
host's own chat uses the harness lifecycle above plus this state for its transport health.

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | attach requested (app open / view open / retry) | valid host address | `connecting` | Open one ACP-over-WebSocket connection; no harness spawn on the remote |
| `connecting` | auth accepted + `initialize` negotiates v1 | valid credential | `connected` | Cache capabilities; expose attach indicator; start heartbeat |
| `connecting` | 401 / unknown or revoked credential / policy error | auth failure | `dead` | Distinct credential error; **no retry** as a network fault; no session created (FR-010/016) |
| `connecting` | timeout / refused / network error | no auth rejection | `unreachable` | Bounded backoff retry scheduled; no local fallback (FR-015) |
| `unreachable` | retry timer fires / network returns | attempt < budget | `connecting` | One attempt per timer; no request storm |
| `unreachable` | budget exhausted | attempt ≥ budget | `dead` | Stop retrying; show unreachable/dead state and a manual retry action |
| `connected` | transport loss / missed heartbeat / socket close | — | `unreachable` | Mark in-flight turn interrupted; stop appending; cancel parked permissions; never report success (FR-015/036) |
| `connected` | device revoked / session deleted / ownership violation | policy | `dead` | Close connection; cancel that device's pending approvals; stop serving its sessions |
| `dead` | explicit retry / re-pair / config change | user action | `connecting` | Sticky otherwise; no silent recovery |
| any | user closes/leaves deliberately | — | `idle` | Close transport cleanly; the host session record is preserved |

Rules: auth failures are never retried as transient (FR-016); no fallback to a local/public server
(US3 scenario 4); an in-flight turn is interrupted, not completed (FR-015); remote never opens a
listening port or spawns a process (FR-012, SC-003).

### 3.3 Session resume state

This state is the **continuity capability class** for one stored session, recomputed whenever it is
opened or reattached. Attachment liveness is separate (3.2); a session can be `digest-only` while its
device is `connected` to the host. A stored `unknown` value (store-contract header) means "not yet
evaluated"; it is not a fifth state — the session is evaluated on open.

| State | Derivation | UI / next action |
|---|---|---|
| `resume-capable` | Current harness advertises `sessionCapabilities.resume`; stored fingerprint + cwd match; record is readable and has a harness session id | Attempt `session/resume`; on success attach and send the next prompt with prior context; no history replay |
| `load-only` | Resume not advertised, but `loadSession: true`; fingerprint + cwd match; record readable | Attempt `session/load`; reconcile replay against the record; no duplicate turns, no re-persisted replay |
| `digest-only` | Neither capability, or resume/load failed, or fingerprint/cwd mismatch, or harness unreachable, **and** the record has digestable content | Offer **Continue with digest (default)**, **Start fresh**, and advanced **full-transcript replay**; no new session until the user chooses |
| `fresh-only` | Record missing/empty/unreadable, or imported record with no usable transcript, so there is no digest material and no identity to reattach | Offer **Start fresh** (and full replay only if any transcript remains); no resume attempt |

Transitions (all record a `resume-event` entry):

- (unevaluated) → any: first open/attach evaluation from capabilities + fingerprint + record state.
- `resume-capable` → `resume-capable` (attached): `session/resume` succeeds. Modes/config reapplied.
- `resume-capable` → `digest-only`: resume fails (`session_missing_on_harness`, timeout) or
  fingerprint/cwd mismatch (`fingerprint_mismatch`/`cwd_mismatch`) — reason recorded; explicit choice
  shown; never a silent new session. (FR-064)
- `load-only` → `load-only` (attached): `session/load` succeeds; replay reconciled; not persisted.
- `load-only` → `digest-only`: load fails or mismatch.
- `digest-only` → `digest-only` (attached): user chooses digest; the host creates a new harness
  session seeded with the labelled digest, records a `resume-event` with the new harness session id
  and digest metadata, and continues the same conversation record.
- `digest-only` → `digest-only` (attached): user chooses full-transcript replay; same as digest but
  the seeded prompt is the bounded full projection, recorded as `full_replay`.
- `digest-only` → `digest-only` (attached): user chooses Start fresh; a new harness session starts
  with no seeded context; the existing record remains the conversation history, the capability class
  stays `digest-only` (the harness still advertises neither resume nor load), and `lastUserChoice`
  records `fresh`.
- `digest-only`/`fresh-only` → `fresh-only`: record deleted/unreadable or no digest material remains.
- Any → `resume-capable`/`load-only`: on a later open, if the current harness advertises the
  capability and the stored identity still matches (the effective resume identity may have advanced
  after a digest/fresh continuation).
- Reattach after host reload/harness respawn: attempt first; only on failure move to `digest-only`
  with `reattach_failed` (FR-063).

Rules: ladder order is mandatory (FR-060/061/062); resume never replays; load replay is reconciled
and not persisted (FR-061); imported records never resume (FR-059); modes/config are reapplied and
pending permissions are not (FR-065); the digest is deterministic, bounded, model-free, and labelled
(FR-062). If the harness is not currently attachable, the choices remain visible but their actions
stay disabled until an attachment is ready; nothing is created automatically in the meantime.

### 3.4 Permission lifecycle

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| (arrival) | `session/request_permission` from harness | session owned by a device | `pending` | Append `permission-request` entry; route card only to the owner; add to `turn.pendingPermissionIds` |
| `pending` | owning user selects an offered option | optionId ∈ offered options | `selected` | Append `permission-resolution` entry with exactly that optionId; remove card; forward response to harness |
| `pending` | explicit user cancel / `session/cancel` | — | `cancelled` | Append resolution `cancelled`; explain in transcript; harness receives `{outcome:"cancelled"}` |
| `pending` | session teardown / device disconnect / transport loss / revocation / host shutdown | — | `cancelled` | Resolve all parked requests before the session ends; append one explanation per hidden card; no other device may answer |
| `pending` | another device attempts a response | not owner | `pending` | Policy error to the caller; request unchanged |
| `selected` / `cancelled` | any | — | terminal | Exactly one resolution forever; never restored on resume |

Rules: no auto-approval; no invented options; no persistent allow/deny table; no tool execution
(FR-034/035/036/037/038); exactly one resolution (SC-005).

### 3.5 Session-record entry lifecycle

| Stage | What happens | Failure handling |
|---|---|---|
| **Constructed** | The session owner maps one event (prompt, update, permission request/resolution, turn end, resume attempt, error, meta) to one entry; assigns `seq = lastSeq + 1`, `turn`, `ts`, `v`, `origin` | Invalid/oversized payload: apply the store bound and mark `truncated`; never drop the event silently |
| **Appended** | Serialize as one JSON line + `\n`, append through the vault adapter, flush; `lastSeq` advances only after a complete line is written | Write error (disk full/permissions): set `writeState=write_failed`, keep the turn visible in the live UI, surface the failure, retry append without duplicating seq; never claim persistence |
| **Durable** | Line is complete; at most the last unflushed entry can be lost on crash | Crash/partial tail: reader ignores the partial line, marks a degraded tail, preserves all prior entries (SC-013) |
| **Read/validated** | Header parsed; entries scanned; `seq` strictly increasing; known kinds mapped, unknown kinds kept raw | Malformed interior line: skip, count, mark degraded; gap: report range; never rewrite the file to repair |
| **Projected** | Valid entries feed transcript projection, raw view, digest, session list | Degraded session: render valid content + a persistent degraded notice; never invent missing turns |
| **Reconciled** | `session/load` replay entries are matched against stored entries and are **not appended** | Unmatched replay entries may be shown as ephemeral "replayed, not recorded" rows and counted in the `resume-event`; no new turn, no duplicate |
| **Imported** | Legacy note parsed once into prompt/update entries with `origin=legacy_import` + a provenance `meta` entry | Unparseable note: skipped and counted; original never modified |
| **Deleted** | Explicit user deletion removes the record + registry entry after confirmation; external deletion drops it from the list | No replacement history is fabricated |

## 4. Persistence model

### 4.1 Files and location

Default root: the vault folder `.chat/sessions/` (a setting, not hardcoded; hidden from the ordinary
note surface). Per the store contract: `<sessionId>.jsonl` (canonical), `index.json` (rebuildable
cache only; headers win), `registry.json` (host reattach registry: sessionId → device, harness
identity, cwd, lastSeq, state), `migration.json` (legacy-import ledger). The store is host-owned:
remote devices browse through ACP and keep no local history. (FR-053, FR-056, FR-063)

**Host session registry** (`registry.json`, host-only, never synced to a remote): one row per stored
session — `{ sessionId, deviceId, harnessSessionId, cwd, commandFingerprint, protocolVersion,
lastSeq, state: "live" | "detached" | "dead", lastSeen }`. It is written debounced on create, turn
end, and attach; read on open; reconciled against records (drop rows with no record, adopt records
with no row as `dead`, mark rows whose `lastSeq` is ahead of the record tail as degraded). It is how
an Obsidian reload or harness respawn attempts reattach before declaring a session dead (FR-063), and
it never contains tokens. The record remains canonical; the registry is reattach state only. The
store writer is the only internal component allowed to write inside the protected session folder;
capability requests and MCP tools are refused there (research R9), so protecting it does not block
persistence.

### 4.2 Header (first line)

| Field | Type | Req. | Semantics |
|---|---|---|---|
| `kind` | `"header"` | ✔ | Line discriminator. |
| `v` | integer | ✔ | Record format version (1). |
| `sessionId` | string | ✔ | Host-generated opaque id; also the filename. |
| `deviceId` | string | ✔ | Owning device id (host instance or paired device). |
| `title` | string | opt. | Initial harness title or user rename at creation. |
| `createdAt` / `updatedAt` | number | ✔ | Header write time / last known activity. |
| `lastSeq` | integer | ✔ | Best-effort sequence known when the header was written (0 for new). The tail entry is authoritative; the registry caches the live value. |
| `harnessSessionId` | string | opt. | ACP session id at creation; null for imported records. The **effective** resume identity may advance through a later `resume-event`. |
| `harness` | object | ✔ | `commandLabel` (redacted display; the store contract's name), `commandFingerprint`, `cwd`, `protocolVersion`, optional `agentInfo`/`agentName`/`agentVersion` for diagnostics only (never branched on), and `capabilities` (`loadSession`, `resume`, prompt flags, MCP flags). (FR-055) |
| `resume` | object | ✔ | Last known `{ state, reason }` snapshot, used for listing/restart; recomputed before any attempt. |
| `modes` | object | opt. | Last known current mode + available modes (opaque ids/names). |
| `config` | object | opt. | Map of last selected config option id → value (opaque), reapplied after resume. (FR-065) |
| `origin` | `live \| legacy_import` | ✔ | Provenance. |
| `provenance` | object | opt. | `{ originPath, originMtime, originHash, importedAt, tokens? }` for imported records (research R6). (FR-059) |

Header notes:

- `lastSeq` cannot be kept perfectly current in an append-only file. The model treats it as a lower
  bound; the authoritative last sequence is derived from the last valid entry (and cached in the
  registry). See §7 for this FR-055 interpretation.
- The raw harness command is **not** stored; only a redacted display form + fingerprint go into the
  header, so a command containing a token cannot leak into the vault record. The full command lives
  only in settings. (§7)
- `agentInfo`, if retained, is diagnostic metadata; it may inform the same-harness version **warning**
  policy (research R7: a changed agent version is a warning, not a refusal) but is never used for
  routing, capability decisions, provider detection, or UI labels (FR-042).

### 4.3 Entry variants

The seven required model variants, with wire aliases from `contracts/session-store.md` and the
turn-boundary rename from research R6:

| Model variant | Wire kind | Core payload | Notes |
|---|---|---|---|
| **prompt** | `prompt` | `blocks[]` (`ContentBlock` text/resource-link; image by name/type only; optional bounded note context), `textChars` | User turn; starts a turn number. No image bytes. (FR-058) |
| **update** | `update` | `sessionUpdate` (the ACP discriminator, stored verbatim), `payload` (the update object), optional `toolCallId`, `late?`, `truncated?` | One ACP `session/update`; unknown kinds are stored, never dropped. (FR-043) |
| **permission-request** | `permission_request` | `requestId`, `toolCall` (bounded ACP `ToolCallUpdate`), `options[]` (`optionId`, `name`, `kind`) | Arrival order preserved. (FR-034) |
| **permission-resolution** | `permission_response` | `requestId`, `outcome` (`selected(optionId)` or `cancelled`), `reason?`, `resolvedByDeviceId?` | Exactly one per request. (FR-036) |
| **turn** | `turn`. **Do not use `turn_end`** — it is the deleted SSE envelope name and fails the plan's grep gate. | `stopReason?` (ACP `StopReason`), `interrupted: boolean`, `errorCategory?` | The only turn terminator; interrupted is explicit, never fabricated. |
| **resume-event** | `resume` | `method` (`resume \| load \| digest \| fresh \| full_replay`), `result`, `reason?`, `harnessSessionId?` (new/effective), `replay?: { replayed, deduped, ephemeral, gaps }`, `digest?: { turnsIncluded, turnsOmitted, chars, hash }`, `fingerprint`, `cwd` | Records every continuity decision; no decision is silent. (FR-060/061/062) |
| **error** | `error` | `scope` (`harness \| transport \| store \| mcp \| device \| policy`), `message` (sanitized), `code?`, `retryable` | Visible failures; never file content, token, or credential. (FR-071) |

The store contract additionally defines a `meta` entry (`title?`, `updatedAt?`) for harness session
info and legacy provenance. The model accepts it as an eighth **presentation/provenance** entry, not
as a new protocol event; the seven required variants above remain the complete set for conversation
events. A reader MUST tolerate unknown entry kinds/fields and render/skip them safely. Implementers
use `turn` as the single wire kind and variant name; the store contract has been updated to match,
and `turn_end` survives only as the rejected legacy name in verification greps.

Small schema sketch (values abbreviated; wire shapes are fixed in the store contract):

```json
{ "kind": "header", "v": 1, "sessionId": "s_…", "deviceId": "d_…", "lastSeq": 0,
  "harness": { "commandFingerprint": "…", "cwd": "/…/vault", "protocolVersion": 1,
               "capabilities": { "loadSession": true, "resume": true } },
  "harnessSessionId": "…", "resume": { "state": "resume-capable", "reason": "resume_advertised" } }
```

```json
{ "seq": 7, "ts": 1762550000000, "turn": 2, "kind": "update", "v": 1, "origin": "live",
  "payload": { "sessionUpdate": "tool_call", "toolCallId": "t1", "title": "…", "kind": "edit" } }
```

### 4.4 Sequence rules

1. `seq` starts at 1 and increases by 1 for every appended entry; the header occupies no sequence.
   (Store contract §2)
2. Sequence is global across entry kinds (prompt/update/permission/turn/resume/error/meta); it is
   the replay and dedupe key, mirrored into ACP `_meta` as `obsidian-chat/seq` on replay.
3. A single writer (the session owner) assigns sequence; concurrent appends from two views are
   serialized through the session, not the view. (FR-067)
4. `turn` starts at 1 at each `prompt`; all entries for that turn carry it until the `turn` entry. `resume`,
   `error`, and `meta` entries may sit between turns and need no turn.
5. Permission entries are ordered by `seq`; a response references its request by `requestId`. There is
   exactly one response entry per request.
6. A `resume-event` may carry a new `harnessSessionId` (digest/fresh/full replay continuation). The
   effective resume identity is the latest successful resume event's id, falling back to the header.
7. A gap or duplicate seq can only come from corruption/crash; it is reported as degraded, never
   filled, renumbered, or rewritten. New appends continue at `maxValidSeq + 1`. (FR-057)
8. Replay entries emitted by the host to a remote are read from the record and are **not** new
   entries; replay never changes `seq`. (FR-061)

### 4.5 Append and read semantics

- **Append**: one event → one complete JSON line + `\n`; flush after each entry; never rewrite,
  reorder, or truncate earlier lines. If the vault adapter lacks an append primitive, a bounded
  read-modify-write fallback is allowed (store contract §3); the record size then bounds it.
- **Writer**: exactly one owner per record; two views share the session owner. A second writer is a
  bug, not a supported path.
- **Read (list)**: header scan only — derive title, updated time, device, resume snapshot, lastSeq.
  `index.json` is a cache; on disagreement, headers win.
- **Read (open)**: full scan with validation; produce valid entries + degraded metadata; never fail
  the session for one bad line.
- **Write failure** (disk full, permissions): the live turn remains visible; `writeState` becomes
  `write_failed`; the failure is surfaced in the chat/status; no silent loss and no fabricated
  persistence. Recovered writes continue from the last durable seq.
- **External modification** (sync conflict/manual edit): detect via tail/seq; surface degraded; do
  not rewrite to "fix"; the host remains the only writer in v1. (FR-057)
- **Deletion**: explicit user action removes record + registry entry after confirmation; external
  deletion removes it from the list; no Markdown replacement. (FR-054; edge "record deleted
  externally")

### 4.6 Crash recovery

- A trailing partial line without `\n` is discarded and reported as a degraded tail. All earlier
  entries remain readable. At most the last entry is lost. (SC-013)
- Before the next append after a partial tail, the writer appends a single `\n` first (still
  append-only, no rewrite), so the fragment becomes an isolated skipped line and the next entry
  starts clean (research R6).
- A malformed interior line is skipped and counted; the session is marked degraded; other entries
  and sessions are untouched. (FR-057)
- On reopen, `lastSeq` = highest valid seq; new appends continue from there. Missing ranges are
  reported, not reconstructed.
- A corrupt header does not delete the record: entries may still project a read-only transcript, but
  the session is not resume-capable (fresh-only/digest-only depending on recoverable content), and
  the list labels it degraded. The store never fabricates a new header over the old one.
- A crash between `prompt` and the `turn` entry leaves an incomplete turn; the projection renders it as
  interrupted/incomplete (never completed), and reopening shows the partial content.
- A crash between a permission request and its resolution leaves a pending request; on recovery it is
  resolved `cancelled` with an explanation, not restored to the UI as answerable. (FR-036, FR-065)

### 4.7 Migration from the legacy Markdown note format

**Source**: the configured legacy chat folder (old `chatFolder`, default `chat/`), discovered on the
first run after upgrade. Notes carry `type: chat-session` frontmatter and either a canonical
`<!-- oc-transcript-b64: … -->` transcript block or older rendered prose with role headings
(`## 👤 User (timestamp)`, `## 🤖 Assistant`, `## 🔑 System`, `## 🔧 Tool`), `### 🧠 Thought (Ns)`,
and `<!-- oc-activity-b64: … -->` blocks. (FR-059)

**Mapping** (one note → one record; `origin=legacy_import` on every entry):

| Legacy content | Record entry | Preservation |
|---|---|---|
| Note metadata (created/updated/tokens) | Header `createdAt`/`updatedAt`, optional `provenance.tokens`, provenance `meta` entry | Byte-level note left untouched |
| `user` message | `prompt` with text block (plus context if the note stored it); images name/type only | Text exact; image bytes were never in the note |
| `assistant` message | `update` with `sessionUpdate:"agent_message_chunk"`, `content:{type:"text",text}`, `origin:"legacy_import"` | Text exact; per-message timestamp from the legacy heading when parseable |
| `assistant.reasoning[]` | one `update` with `agent_thought_chunk` per burst, plus `legacyDurationSeconds` when present | Text/duration preserved; no raw ACP existed |
| `assistant.activity[]` | `update` with `tool_call` synthesized from the stored item id/title/status/target, marked `synthetic: true`, keeping the legacy item in `payload.legacy` | Rendered with the generic tool card; no name→verb dictionary is reintroduced |
| `system` / `tool` messages | `update` with `agent_message_chunk` + `origin` and a `legacyRole` marker | Content exact |
| Raw ACP record | none exists in legacy notes | Raw view says "not recorded in the legacy note"; never fabricated |
| Images | name/type placeholder | No bytes were ever stored |

**Import rules**

1. Prefer the canonical block; fall back to the prose parser for older notes; if neither parses, skip
   the note and count it in the migration report. (FR-059; edge "old note cannot be parsed")
2. Imported records have no `harnessSessionId`; their ResumeState is `digest-only` (or `fresh-only`
   if the parsed transcript is empty). (FR-059; continuity)
3. Idempotency: `migration.json` records `note path + content hash → imported sessionId`. Re-running
   the import imports nothing twice. If a note's hash changed after import, skip it and report it
   (never duplicate); a missing ledger is recovered by scanning imported headers for
   `provenance.originPath`. (FR-059, SC-007; research R6)
4. Originals are never modified or deleted; the import reads and copies. (FR-059)
5. A skipped note is reported with its path and a reason category only — never its content. (FR-059,
   SC-015)
6. After migration, the legacy note writer/parser is not a runtime history path; only the import
   reader remains until the legacy removal task deletes it. (FR-054, FR-070)
7. The store folder and import ledger are settings-driven; imported records appear in the normal
   conversation list like any other conversation. (FR-056, FR-051)

## 5. Derived state

### 5.1 Transcript projection (record → chat view)

Deterministic: same valid entries → same transcript. No model call, no invented content.

1. Read valid entries in `seq` order; stop treating a turn as complete without its `turn` entry.
2. Create one user message per `prompt`; append adjacent `agent_message_chunk` payloads of the same
   turn into one assistant message; append `agent_thought_chunk` payloads into a reasoning burst;
   a tool call is one card keyed by `toolCallId`, mutated by later `tool_call_update` (never a new
   row per update). (US6 scenario 1)
3. Keep arrival order. Grouping/collapsing is opt-in density only; the default is chronological and
   expanded. (FR-047)
4. Permission entries render as inline cards at their position; a resolution updates the card and/or
   leaves a one-line outcome; a cancelled card leaves a visible explanation. (FR-036)
5. `plan`, `plan_update`, `plan_removed`, `usage_update` render their views; `session_info_update`
   affects the title only; control updates affect the composer only. They remain in raw.
6. Unknown/unstable update kinds render as a generic row with the kind and a bounded raw payload;
   they are never dropped. (FR-043)
7. A `turn` entry with `interrupted` or an `error` renders an explicit status line; never a success
   label. (US1)
8. Late updates (arriving after the `turn` entry) are appended after the settled answer with a late marker
   in the raw view; the transcript never rewrites earlier content.
9. A degraded record shows valid content plus a persistent degraded notice; gaps are not invented.
10. `origin=legacy_import` entries render as normal messages/tool rows with an "imported" marker; raw
    view does not pretend they are ACP traffic.
11. A replay (`session/load`) never adds duplicate rows: matched entries are dropped, unmatched ones
    are ephemeral and labelled.

### 5.2 Generic renderer mappings

| ACP update / content | View | Raw row? |
|---|---|---|
| `user_message_chunk` | user message bubble (append; live prompts come from `prompt` entries) | also stored |
| `agent_message_chunk` | assistant Markdown bubble (append) | also stored |
| `agent_thought_chunk` | reasoning block (streaming → collapsed on interruption, expandable) | also stored |
| `tool_call` | one tool card: title verbatim, name fallback, kind-based fixed ACP icon, status, duration; content variants below | details disclosure |
| `tool_call_update` | mutate the same card (partial-object merge; unchanged fields kept) | details disclosure |
| `plan` / `plan_update` / `plan_removed` | plan panel; entries/removal verbatim; no fabricated plan | raw |
| `usage_update` | usage row/panel | raw |
| `session_info_update` | session title/metadata only (no transcript prose) | raw |
| `current_mode_update` | composer mode state only | raw |
| `config_option_update` | composer config controls replaced | raw |
| `available_commands_update` | command menu replaced | raw |
| `compaction_update` / `compaction_summary_chunk` | generic raw row (unstable kind) | always |
| any other/unknown `sessionUpdate` | generic row: kind + bounded raw payload disclosure | always |
| content block `text` | Markdown | — |
| content block `image` / `audio` | preview/link | — |
| content block `resource_link` / `resource` | link/preview | — |
| tool content `content` | per content block above | — |
| tool content `diff` | diff view (old/new text; terminal status-aware) | raw available |
| tool content `terminal` | terminal-style output block (terminal capability itself is off) | raw available |
| tool location | clickable when it resolves to a vault note; otherwise inert | details |
| missing title | programmatic `name` verbatim, then `kind`; never invented | — |
| imported `legacy_*`/marked entries | normal message/tool/reasoning view + "imported" marker | provenance |

No tool-name→verb/icon/label dictionary exists; icons may come only from ACP's fixed `ToolKind` enum.
(FR-044, FR-049, SC-010)

UI bounds (research R8): raw input/output and unknown-kind disclosures display at most 16 KiB with an
explicit "truncated, N bytes total"; live raw rows are capped at 2,000 per turn (with "N more in the
record"); reopening a long session renders the last 50 turns and pages earlier content in 50-turn
chunks; raw JSON is serialized only on expand. These are presentation bounds — the record keeps the
stored payload (itself capped by the 256 KiB per-entry store bound, §4.3).

### 5.3 Control projection

`controls` is derived from the latest session response and subsequent control updates: modes
(`currentModeId` + `availableModes`), config options (full replacement on each
`config_option_update`), commands (full replacement on `available_commands_update`). Render exactly
this set by declared name/type, including unknown categories and boolean options; render an empty
area when nothing is declared. Selections forward the harness's own ids/values unchanged and are
recorded in `lastSelected` for reapply after resume. (FR-039…FR-042, FR-052, FR-065)

### 5.4 Digest input selection

The digest is a labelled, deterministic, bounded **seed prompt** for a new harness session — never a
model summary, never a second source of truth. (FR-062)

**Inputs (record only)**: header title/created time; completed turns (prefer a `turn` entry); per turn:
the user prompt text, the final assistant message text, a compact list of tool targets
(title/locations/status only), any plan summary, and notable unresolved errors. **Excluded**:
permission payloads, raw input/output, tool content bodies, unknown raw payloads, image bytes, tokens,
credentials, and anything not in the record.

**Selection algorithm**

1. Walk turns newest → oldest; take at most **6** complete turns (research R7; constants live in one
   place and are pinned by a snapshot test).
2. Per turn: cap user text at **600** chars and assistant text at **900** chars with an explicit `…`
   truncation marker; include at most **8** tool lines (`status kind: title (path)`), a compact plan
   summary, and at most **30** deduped files touched; skip turns with no text and no tool targets.
3. Stop when the digest reaches the hard cap of **8,000 characters**; then emit a header line stating
   the digest is shell-generated from the local record, the session title/time, the number of turns
   included and omitted, and the truncation rule. Prefix the first line with the fixed label
   `[Conversation digest — generated by Obsidian Chat from the stored record; not written by the model]`.
4. Include the last selected modes/config values as an opaque "last session settings" line (ids
   and values as declared), the last completed turn's stop state, and at most **5** safe error
   messages (never file content or credentials).
5. Never include raw ACP payloads, file contents, or credentials; never call a model.
6. Deterministic: same record + same constants → byte-identical digest; a snapshot test pins it.
7. The `resume-event` records `{ turnsIncluded, turnsOmitted, chars, hash }` — not a second copy of
   the digest text. The digest itself is sent only in the new session's first prompt, labelled as a
   digest. (FR-062; US7 scenario 4)

The advanced **full-transcript replay** option projects the same transcript (text, tool targets,
statuses) without the "last N turns" cap, still bounded by the harness/prompt safety cap, and is
recorded as `method=full_replay`. It seeds a new session; it does not replay into the UI.

### 5.5 Session list projection

One row per stored session the requesting device owns, read from headers (fast path): title (harness
title or first-prompt truncation; labelled if derived), `updatedAt`, owning device, record health
(live/degraded/write_failed), and resume state (resume-capable / load-only / digest-only /
fresh-only). A remote never sees another device's rows. No separate note-based history surface. (FR-051,
FR-013)

### 5.6 Raw view projection

- **Per-turn "ACP updates"**: all entries with that `turn`, in `seq` order, showing the raw ACP
  notification/entry payload (bounded/paged, lazy: ≤16 KiB per disclosure, 2,000 live rows per turn).
- **Connection details**: the session's full raw update record, read from the same record, bounded
  and lazily paged (last 50 turns first, "+ load earlier" in 50-turn pages); no token/credential/file
  content.
- Raw payload disclosures are local-only; they never become visible transcript text or a second
  persisted form. (FR-048, FR-050)

## 6. Validation rules

| # | Rule | FR |
|---|---|---|
| V1 | A host has at most one HarnessAttachment and one harness child; every local/remote session reuses it. | FR-001, FR-005 |
| V2 | The harness command is the only harness-selection input; no model/provider/credential field or branch exists anywhere; the same build works against any ACP harness. | FR-002, FR-042, SC-002 |
| V3 | Unexpected exits respawn with bounded backoff; deliberate stops never respawn; configuration failures do not loop. | FR-003, FR-007 |
| V4 | Mobile and remote-only installs never spawn, never host, and never start the MCP server. | FR-004, FR-012, FR-030 |
| V5 | Exactly one host listener carries the ACP-device and loopback MCP endpoints behind one auth boundary; no other listener/port. | FR-008 |
| V6 | Bind defaults to loopback; a wider bind requires explicit confirmation. | FR-006 |
| V7 | A device is authenticated before any session is created; unknown/revoked credentials are rejected without exposing vault content or harness state. | FR-009, FR-010, FR-016, FR-017 |
| V8 | Sessions and approvals are owned by exactly one device; other devices cannot see or answer them. | FR-013, FR-035 |
| V9 | A remote is a frontend only: no spawn, no vault read/write, no MCP/fs serving, no local history store. | FR-011, FR-012, FR-014, FR-054 |
| V10 | Mid-turn transport loss marks the turn interrupted, stops appending, never reports success; reconnect is bounded and does not duplicate the prompt/turn. | FR-015, FR-016, SC-006 |
| V11 | Vault fs capabilities are served only by the host; a remote never serves them. | FR-018 |
| V12 | Reads return the current vault/editor content and honour the optional line window. | FR-019 |
| V13 | Writes go through Obsidian vault operations, create parents, refresh open editors/metadata, and return success. | FR-020 |
| V14 | A best-effort snapshot is attempted before the first write to a path per session; failure is reported, never blocks the write, never implies a false undo. | FR-021 |
| V15 | Every capability path is lexically confined; escapes/absolute-outside/relative/NUL/malformed/blacklisted/`.obsidian/`/`.trash/`/session-store are refused with zero vault operations and no clamping. | FR-022 |
| V16 | One blacklist and one enforcement path serve ACP fs, MCP, and the mention index; one shared VaultService and one content index. | FR-023, FR-024, FR-029, FR-072 |
| V17 | MCP exposes no write/edit/append/move/delete tool; a write-shaped call is an unknown-tool error, not an action. | FR-025, FR-028 |
| V18 | The MCP server is in-process, loopback-only, per-session-token authenticated, and advertised in `session/new` when the harness advertises HTTP MCP (otherwise `mcpServers: []` and a visible "native tools unavailable"); only the shell's server is forwarded. | FR-026, FR-030, FR-033 |
| V19 | MCP exposes the six native read tools from the live metadata cache/search index. | FR-027 |
| V20 | MCP failure leaves ACP chat working and is visibly reported; no empty success. | FR-031 |
| V21 | MCP is used as standard MCP; tool failures are tool results, not a custom envelope. | FR-032 |
| V22 | Permission answers use exactly an offered `optionId` (one action per option) on explicit user action; no invented option, no auto-approval, no persistent table, no tool execution. | FR-034, FR-037, FR-038 |
| V23 | Every parked permission is resolved `cancelled` before session teardown/disconnect/loss, with a transcript explanation. | FR-036 |
| V24 | Modes/config options/commands render exactly as declared, by declared name/type; undeclared controls are absent, never defaulted or replaced by a fixed trio. | FR-039, FR-040, FR-052, SC-011 |
| V25 | Selections are forwarded unchanged and affect only the current session. | FR-041 |
| V26 | Every ACP update kind is surfaced, including unknown/unstable kinds; none is dropped. | FR-043, SC-010 |
| V27 | Tool calls render from ACP fields (title verbatim, name fallback, kind, status, content, locations, raw input/output) with no name→verb/icon dictionary. | FR-044, FR-049 |
| V28 | Every tool content variant renders as its own type; none is dropped because another exists. | FR-045 |
| V29 | Details/raw disclosures are explicit, lazy, bounded, local-only; updates stay in arrival order and expanded by default; grouping is opt-in. | FR-046, FR-047, FR-048, FR-050 |
| V30 | Raw views derive from the session record; raw payloads never become transcript text or a second store. | FR-048, FR-050 |
| V31 | The conversation list is store-backed (title/time/resume state) and opens any stored session; no note-based history surface. | FR-051 |
| V32 | Each conversation has one append-only record with one ordered entry per prompt/update/permission/turn boundary; entries are never rewritten. | FR-053, FR-055, FR-057 |
| V33 | No Markdown session notes are written as the history model; export is out of scope. | FR-054 |
| V34 | The record lives in the configured vault session folder, outside the ordinary note surface. | FR-056 |
| V35 | The record contains no credentials, tokens, provider keys, or image bytes; images are name/type only. | FR-058, SC-013 |
| V36 | Legacy notes import losslessly for the content the note actually contains (never for raw ACP that was never stored), idempotently; originals untouched, skipped notes reported; upgrade preserves settings/devices with no re-pairing. | FR-059, FR-069 |
| V37 | Reopening renders from the record immediately and follows the resume → load → explicit-choice ladder; no silent new session. | FR-060, FR-061, FR-062 |
| V38 | Resume is refused with an explanation on fingerprint/cwd mismatch; imported records never resume. | FR-064 |
| V39 | Resume/load replay is reconciled against the record: no duplicate turns and no re-persisted replay. | FR-061 |
| V40 | The persisted registry supports reattach after reload/respawn before declaring a session dead; failure exposes the same choices. | FR-063 |
| V41 | After resume, last modes/config values are reapplied; pending permissions are not restored. | FR-065 |
| V42 | A turn survives view close and reopening shows the complete/interrupted turn; two views share one session and never duplicate it. | FR-066, FR-067 |
| V43 | Settings validate visibly and preserve host settings, credentials, store location, and blacklist across upgrade. | FR-068, FR-069 |
| V44 | The legacy relay, custom client, note history writer, SSE envelope, and tool-name dictionary are deleted; the result is one greenfield module set. | FR-070, FR-074 |
| V45 | The attach indicator/connection details are non-secret and never show tokens, credentials, provider keys, or file content. | FR-071, SC-015 |
| V46 | Local vault side effects are limited to the store, mention index, advisory rules, snapshots, and read-only MCP tools. | FR-072 |
| V47 | The existing shell UX (transcript, approvals, context chips, mention index, history, composer, mobile) continues to work. | FR-073 |
| V48 | The digest is deterministic, bounded, labelled, record-only, and model-free. | FR-062 |
| V49 | At most one prompt is in flight per session; a second is rejected locally without corrupting the session. | Spec edge case |
| V50 | A malformed/truncated record skips the bad line, marks the session degraded, and preserves the rest; store write failures are visible and never silently lose live content. | FR-057 |

## 7. Assumptions, tensions, and plan-stage constants

These are model-level decisions made here; none edits the spec, constitution, plan, or contracts.
Where the concurrently written Phase 0 [research.md](./research.md) settled a detail after this
model's first draft, the item below adopts that decision and names any remaining contract mismatch.

1. **FR-055 "last recorded sequence" in an append-only header.** A header line written once cannot
   stay perfectly current. Research R6 allows a best-effort header refresh at turn boundaries; this
   model treats `header.lastSeq` as a best-effort hint (0 for new records), derives the authoritative
   last sequence from the last valid entry, and caches it in `registry.json`. That preserves the
   requirement's intent (reattach/replay position) without depending on header rewrites. If strict
   append-only is enforced, the header stays a lower bound and the tail remains authoritative.
2. **Resume-state naming — resolved.** `resume-capable / load-only / digest-only / fresh-only` is
   the single vocabulary, now used by the store contract and plan as well. `resumable`/`dead` are not
   separate resume states; an attach failure still offers the digest/fresh choice while the record
   has content.
3. **Entry-variant naming — reconciled.** Wire kinds are `prompt`, `update`,
   `permission_request`, `permission_response`, `turn`, `resume`, plus the store contract's `meta`.
   The turn boundary is named `turn` in both the model and the wire (the Phase-1 brief's label is
   `turn-end`); the store contract uses `turn`. `turn_end` is deleted from the record and code and
   appears only as the rejected legacy name in verification greps.
4. **Command storage and secrets — resolved.** The store header stores a **redacted display form**
   plus the fingerprint, never the raw command (a user could embed a token in it). The full command
   stays in settings; the store contract has been updated to say so.
5. **`agentInfo` in the header.** The store contract includes `agentName`/`agentVersion`. This model
   keeps harness identity as optional diagnostic metadata; research R7 uses the version only for a
   "same harness, upgraded" **warning**, never for a refusal or provider detection, and it is never
   used for routing, capability decisions, or UI labels (FR-042). Omitting it is also valid.
6. **New-harness-session continuation keeps the conversation record.** A digest/fresh/full-replay
   continuation creates a new ACP session but appends to the same record and records the new
   `harnessSessionId` in a `resume-event`; the header's original id becomes the fallback. This keeps
   one conversation history per record. If "Start fresh" is meant to fork a new conversation, the
   plan/tasks must say so.
7. **Imported content shape.** Legacy notes have no raw ACP notifications. The import maps legacy
   messages/reasoning/activity to ACP-shaped `update` entries with `origin=legacy_import` (and
   `synthetic: true` for reconstructed tool summaries), keeps the original item in the payload where
   useful, and records header `provenance {originPath, originMtime, originHash}`. The raw view labels
   these as not-recorded. This is the closest honest reconstruction and avoids reintroducing a
   name→verb dictionary.
8. **Transcript projection of incomplete turns.** A crash between `prompt` and the `turn` entry is
   rendered as incomplete/interrupted, never completed. The store contract says "never renders a turn
   as complete without its `turn` entry"; this model follows that.
9. **Digest constants.** Research R7 fixes them: 6 complete turns, 600 user chars / 900 assistant
   chars per turn, 8 tool lines, ≤30 files, ≤5 errors, 8,000-char hard cap; full-transcript replay is
   bounded by the 100,000-char prompt cap. They live in one place and are pinned by a snapshot test.
10. **Session-store location** remains the spec's pending product decision (hidden `.chat/sessions/`
    default vs plugin data folder). The model treats it as a setting (FR-056); if the default changes,
    only the setting default and migration path change.
11. **MCP transport** is modelled as the contract's stateless Streamable HTTP JSON handler with the
    six read-only tools; research R4 confirms keeping the minimal handler and adding no MCP SDK, so
    the spec's open decision resolves to the minimal handler. Only the adapter internals are affected.
12. **TLS** is out of scope: the VPN provides transport security; `wss://` is only possible when the
    user fronts the listener with their own terminator. The model does not assume it.
13. **Local chat transport.** Research R3/R7 chooses the host's own view to attach over the same
    loopback WebSocket with a per-host-run local token, rather than a second in-process client path.
    This model therefore treats the local chat as a session whose `owningDeviceId` is the host
    instance and whose connection health uses the same §3.2 connection state; no model change beyond
    that is needed.
14. **Approval timeout.** Research R9 proposes a 10-minute approval timeout (today's behaviour). The
    spec does not require it and FR-036 lists only explicit cancel/teardown/disconnect/loss. If it is
    adopted, model it as `pending → cancelled` with `cancelReason: timeout` — a cancellation, never
    an approval; it does not add a fifth permission state. This is an operational bound, not a
    permit-by-default.
15. **MCP availability vs harness capability.** Research R4 says: if the harness does not advertise
    `mcpCapabilities.http`, send `mcpServers: []`, show native tools unavailable, and keep chat
    working. The model's V18 reflects this; the "never empty on the host" wording in the MCP contract
    applies only when the capability is advertised.
16. **Fingerprint algorithm.** Research R7 defines `attachFingerprint` as FNV-1a 64-bit over the
    quote-aware argv joined with NUL plus the normalized cwd. The model only requires a stable,
    deterministic, non-secret fingerprint; the algorithm is fixed by research and must not include
    the environment or credentials.

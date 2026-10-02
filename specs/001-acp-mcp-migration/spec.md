# Feature Specification: ACP/MCP Standards Migration

**Feature Branch**: `001-acp-mcp-migration`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Re-architect obsidian-chat around standard protocols instead of custom code. The plugin (Obsidian webview) becomes an ACP (Agent Client Protocol) client only: it starts sessions, sends prompts, streams session/update notifications, and can cancel — it never knows which harness or model provider is behind it. On an always-on host machine, a thin ACP bridge spawns the configured harness (opencode, Claude Code, Gemini CLI, or Goose — any ACP-speaking agent) as a local subprocess and fronts it over the tailnet as HTTP/SSE with per-device auth and replay-on-reconnect, since ACP's remote transport isn't yet standardized and the plugin can't spawn a stdio subprocess from a webview. The configured harness talks to the vault exclusively through MCP vault tools (not custom retrieval/rules code), and to whatever model provider (Anthropic, OpenRouter, DeepSeek, Ollama) is configured on the harness itself — provider choice is a config value, never code. This replaces the existing custom stack: gateway.mjs, agent-worker.mjs, relay-worker.mjs, lra-tools.mjs, retrieve.mjs, rules.mjs, and the custom /jobs protocol are all deleted. Existing plugin-side UX (chat UI, @mention, approval-mode UX, sessions-as-notes) is preserved and adapted to run on top of the ACP client instead of the old custom protocol. Support for Pi (which speaks neither ACP nor MCP natively) is explicitly out of scope for this feature and deferred to a later spec if/when needed."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chat from the phone through a locally-configured harness (Priority: P1)

A user opens the Obsidian chat plugin on their phone, starts a new conversation, and sends a message. The message reaches whatever AI harness is configured on their always-on host machine, gets a streamed response back, and the user can read it appear incrementally, just as they can today.

**Why this priority**: This is the core value of the product — chat from any device against a remote brain — and it must keep working through the re-architecture or the migration has failed.

**Independent Test**: Can be fully tested by sending a prompt from the plugin and confirming a streamed reply arrives and renders, with no visible difference in behavior from the user's perspective compared to before the migration.

**Acceptance Scenarios**:

1. **Given** the host machine has a supported harness configured and running, **When** the user sends a chat message from the plugin, **Then** the plugin starts a session, the message is delivered, and the reply streams back incrementally until complete.
2. **Given** a response is streaming, **When** the user cancels the in-progress request, **Then** streaming stops promptly and the plugin reflects the cancelled state.
3. **Given** the connection between plugin and host drops mid-stream, **When** the plugin reconnects, **Then** the user does not lose the parts of the response that were already delivered.

---

### User Story 2 - Swap the underlying harness without touching the plugin (Priority: P1)

An operator changes which AI harness is configured on the host (for example, from opencode to Claude Code), or changes which model provider that harness uses (for example, from Anthropic to DeepSeek). They do this by editing configuration on the host only.

**Why this priority**: Harness/provider agnosticism is the entire point of this re-architecture; if switching requires plugin or bridge code changes, the migration has not achieved its goal.

**Independent Test**: Can be fully tested by reconfiguring the host to point at a different supported harness or provider, restarting only the host-side process, and confirming chat continues to work from the plugin with zero plugin-side changes or redeploys.

**Acceptance Scenarios**:

1. **Given** the plugin is already configured to talk to the host, **When** the operator points the host at a different supported harness, **Then** the plugin continues to function without any update to plugin code or settings related to the harness identity.
2. **Given** a harness is running against one model provider, **When** the operator changes the provider configuration on the host, **Then** subsequent chat turns use the new provider with no plugin-visible change other than response content/behavior.

---

### User Story 3 - Vault-grounded conversations keep working (Priority: P2)

A user references a specific note with `@mention`, or asks a question that requires the assistant to search or read vault content, and expects the assistant to ground its answer in that vault content just as it does today.

**Why this priority**: Vault-grounding is a signature feature of the product; it must survive the move from custom retrieval code to standardized vault tools.

**Independent Test**: Can be fully tested by `@mention`-ing a note and confirming its content is used in the reply, and by asking a question answerable only via vault search and confirming the assistant finds and cites the right note.

**Acceptance Scenarios**:

1. **Given** a user `@mentions` a specific note in their message, **When** the message is sent, **Then** the note's content is available to the assistant for that turn.
2. **Given** a user asks a question without an explicit mention, **When** the configured harness determines a vault search is needed, **Then** it retrieves relevant notes through the vault tool interface and the answer reflects that content.
3. **Given** a folder or note is covered by an existing exclusion rule (e.g. blacklisted folder or `.chat/rules.md`), **When** a vault search or read is attempted, **Then** the excluded content is not surfaced to the assistant.

---

### User Story 4 - Approval-gated actions on the vault still protect the user (Priority: P2)

A user asks the assistant to make a change to the vault (create, edit, or delete a note). Depending on their configured approval mode (Auto / Review / Plan), they either see the change applied immediately, get prompted to approve it first, or see a proposed plan without changes being applied.

**Why this priority**: Write actions are the highest-risk part of the system; approval UX must not regress when the underlying execution path changes from custom tool code to standardized vault tools invoked by a harness.

**Independent Test**: Can be fully tested by setting each approval mode in turn, asking the assistant to perform a vault write, and confirming the plugin's behavior (apply / prompt / plan-only) matches the configured mode.

**Acceptance Scenarios**:

1. **Given** approval mode is set to Review, **When** the assistant proposes a vault write, **Then** the user sees an approval prompt with enough detail (e.g. a diff) to decide, and the write is applied only after explicit approval.
2. **Given** approval mode is set to Auto, **When** the assistant proposes a vault write within previously allowed scope, **Then** it is applied without an additional prompt.
3. **Given** an approval prompt is pending, **When** the app is backgrounded or the connection drops and later resumes, **Then** the pending approval state is preserved and can still be acted on.

---

### User Story 5 - Sessions remain visible and organized as vault notes (Priority: P3)

A user expects each chat session to be persisted as a note in their configured sessions folder, exactly as before, so they can browse, search, and revisit past conversations using normal Obsidian navigation.

**Why this priority**: Sessions-as-notes is a differentiating UX pattern; it's lower priority than core chat and safety because it's an established, lower-risk feature to carry forward, but it must not silently break.

**Independent Test**: Can be fully tested by completing a conversation and confirming a corresponding note appears in the configured sessions folder with the expected conversation content.

**Acceptance Scenarios**:

1. **Given** a user completes a chat exchange, **When** the exchange finishes, **Then** a note representing that session exists (or is updated) in the configured sessions folder.
2. **Given** a user reopens a past session note, **When** they resume the conversation, **Then** the prior conversation context is available to continue from.

---

### Edge Cases

- What happens when the plugin tries to start a session but the host's ACP bridge or configured harness is unreachable (host offline, harness crashed)? User must see a clear connection/error state rather than a silent hang.
- What happens when the configured harness itself does not support a feature the plugin relies on (e.g. cancellation, a specific tool)? The plugin's behavior in that gap must be defined, not assumed away.
- What happens when two devices open sessions against the same host/harness concurrently? Session isolation must hold — one device's conversation must not leak into another's.
- What happens when an approval is pending and the user's device changes network paths (e.g. wifi to cellular) before responding? The prompt must not be lost or duplicated on reconnect.
- What happens when a vault tool call from the harness targets an excluded/blacklisted folder or a rule explicitly denies it? The denial must be enforced at the vault-tool boundary, not merely assumed to be respected by the harness.
- What happens during the cutover itself — is there a moment where old and new stacks must coexist, or is this a hard replace? (See Assumptions.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The plugin MUST act solely as a client of a standard agent communication protocol (ACP) for all chat interactions — creating sessions, sending prompts, receiving streamed updates, and cancelling in-progress turns — without embedding any harness-specific or provider-specific logic.
- **FR-002**: The system MUST support connecting the plugin to any of the following harnesses, selected by host-side configuration alone: opencode, Claude Code, Gemini CLI, Goose.
- **FR-003**: The host MUST run a bridge component that spawns the configured harness locally and exposes the conversation to the plugin over the network, without the plugin needing to spawn any local process itself.
- **FR-004**: The bridge MUST authenticate each connecting device before allowing it to start or resume a session.
- **FR-005**: The bridge MUST allow a reconnecting device to receive any portion of a streamed response it missed due to a dropped connection, without duplicating already-delivered content.
- **FR-006**: The choice of model provider (e.g. Anthropic, OpenRouter, DeepSeek, Ollama) MUST be a configuration setting on the host/harness only, and changing it MUST NOT require any change to the plugin or the bridge.
- **FR-007**: All vault access performed on behalf of a conversation (reading notes, searching content, writing/editing/deleting notes or folders) MUST go through a standardized vault-tool interface (MCP), not through bespoke retrieval or rules code.
- **FR-008**: Existing vault-access restrictions (blacklisted folders, nearest-wins `.chat/rules.md` rules) MUST continue to be enforced for every vault tool invocation, regardless of which harness or provider is in use.
- **FR-009**: The plugin MUST preserve existing user-facing behaviors: chat UI (sidebar/full-screen/mobile), `@mention` of notes, approval-mode UX (Auto/Review/Plan) with persistent per-tool allow/deny, and sessions persisted as notes in a configurable vault folder.
- **FR-010**: Approval prompts for vault-write actions MUST survive connection drops and app backgrounding, remaining resolvable when connectivity is restored.
- **FR-011**: The following custom components MUST be removed as part of this migration once their standardized replacements are in place: the custom job/gateway protocol, the custom agent-worker execution path, the custom relay-worker, the custom vault tool-calling layer, the custom retrieval logic, and the custom rules-evaluation code — none may be retained as a fallback path.
- **FR-012**: The system MUST clearly surface a connection/availability error to the user when the host, bridge, or configured harness is unreachable, rather than leaving the plugin in an indefinite waiting state.
- **FR-013**: Adding support for a new ACP-speaking harness MUST require only a host-side configuration change (pointing the bridge at a different command), with no changes to plugin code or the bridge's own code.
- **FR-014**: Support for harnesses that do not natively speak ACP (e.g. Pi) is explicitly out of scope for this feature.

### Key Entities

- **Session**: A single ongoing conversation between the plugin and a configured harness, identified consistently across reconnects, and ultimately represented to the user as a note in their vault.
- **Harness**: The configured ACP-speaking agent process (opencode, Claude Code, Gemini CLI, or Goose) that owns the conversation loop, decides when to call vault tools, and talks to a model provider.
- **Bridge**: The host-side component that spawns a harness, exposes it to remote plugin devices over the network with per-device authentication, and relays streamed updates including replay after reconnect.
- **Vault Tool Call**: A single request from the harness to read, search, or modify vault content, subject to folder exclusions and rules, and — for writes — subject to the user's configured approval mode.
- **Approval Request**: A pending decision point presented to the user when a proposed vault write requires confirmation under the active approval mode, which must remain valid and resolvable across connectivity interruptions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can send a chat message from the plugin and see the first part of a streamed response within the same time it takes today, with no perceptible regression in responsiveness.
- **SC-002**: An operator can switch the host's configured harness or model provider and resume chatting from the plugin within minutes, without installing a plugin update or changing any plugin setting related to harness identity.
- **SC-003**: 100% of vault reads/writes performed during a conversation respect existing folder-exclusion and rules configuration, verified across all supported harnesses.
- **SC-004**: Approval-gated vault writes are never applied without satisfying the user's configured approval mode, across at least one full reconnect/backgrounding cycle during a pending approval.
- **SC-005**: After migration, zero references to the removed custom components (job/gateway protocol, agent-worker, relay-worker, custom vault tool layer, retrieval, rules engine) remain in the active codebase.
- **SC-006**: All previously-supported chat UX capabilities (`@mention`, sessions-as-notes, approval modes with persistent allow/deny) are demonstrably present and working after migration, with no feature silently dropped.

## Assumptions

- This is a hard cutover for a personal-use project: the old custom stack (gateway.mjs, agent-worker.mjs, relay-worker.mjs, lra-tools.mjs, retrieve.mjs, rules.mjs, `/jobs`) is removed once the new stack covers its functionality, rather than run in parallel indefinitely.
- "Always-on host machine" and its network reachability (e.g. via an existing tailnet) are pre-existing infrastructure and not something this feature needs to stand up from scratch.
- Exactly one harness is configured and active on the host at a time; multi-harness routing or per-conversation harness selection is out of scope.
- The set of first-class supported harnesses for this feature is opencode, Claude Code, Gemini CLI, and Goose; Pi and any other non-ACP-speaking harness are explicitly deferred.
- MCP vault tools provide equivalent or superior capability to the existing custom retrieval/rules code for grounding and folder-based access control; no functional gap analysis beyond what's captured in FR-007/FR-008 is assumed necessary before starting design.
- The remote transport gap in ACP (no standardized HTTP/WebSocket transport yet) is a known, accepted constraint that justifies the bridge component's existence; this assumption should be revisited if ACP standardizes remote transport before implementation completes.

# Phase 3 — Harness power + mobile polish (spec + plan)

> Status: **IN PROGRESS** (2026-09-03). The **plugin-side** chat + research-assistant tool
> framework is built and verified (BYOK chat works end-to-end). The **harness** (always-on
> machine remote agent) is still to be built. Goal: a focused **MVP** that hits the Phase 3 exit
> ("phone starts a 10-minute multi-step research job, locks the phone, finds results waiting"),
> then optional increments. This doc is the implementation spec + plan.

---

## 1. MVP statement

The Phase 3 exit is explicitly about a **long-running, multi-step research job that the
phone can start and walk away from**. The MVP is the smallest cut that demonstrates that
end-to-end:

> **From the phone:** start an agent research task via the harness → worker explores the
> vault + web (LRA tools + Tavily), writes a deliverable note into `Inbox/` → you lock the
> phone → on return the job is done and the result note is waiting.

**What "MVP" includes (and what it deliberately leaves out) is the whole point of this doc.**

**Build order (user, 2026-09-03):** first wire the **model + web search** into the harness
**chat** and confirm streaming/replies look good (Stage A), then build the **remote agent**
(job lifecycle + tool loop) on top (Stages B–E). The plugin-side chat + tool framework
(§2.1) is substantially complete as a prerequisite.

---

## 2. Scope

### 2.0 Build order

1. **Stage A — Chat via harness (model + web search):** validate streaming + reply quality on
   mobile. No agent, no job lifecycle, no vault tools yet.
2. **Stages B–E — Remote agent:** job-capable agentic worker, harness grounding/rules, plugin
   job client + UI, hardening.

### 2.1 Current state (built 2026-09-03) — plugin-side

The chat + research-assistant tool framework is built and verified end-to-end with BYOK
providers.

- **Provider model:** preset `ProviderType` (`openrouter/openai/anthropic/groq/ollama/mistral/xai/opencode/custom`)
  with auto-filled base URLs; settings UI is per-provider cards (name, provider dropdown, base
  URL, API key, model picker, "Advanced" collapsible).
- **Model picker (chat):** lists **all** of a provider's models (fetched from `/models`), pinned
  models first; the active/default model auto-pins to the top; pin icon = crossed pin when pinned
  (tap to unpin), plain pin when unpinned.
- **Research mode** (default) + **Auto / Review / Plan** write-approval modes in the composer
  mode selector.
- **Grounding policy:** `groundingMode: "tools" | "auto"` (default `tools`) — see §2.2.
- **Tool framework:** a single tool contract; read tools always on; write tools gated by
  approval; persistent per-tool allow/deny (Always allow / Deny / Allow once); Tools modal to
  enable/disable tools; `search_vault` uses the BM25 relevance cascade; folder `.chat/rules.md`
  (nearest-wins); blacklist folders with autocomplete.
- **Durability:** sessions persist to a configurable vault folder (default `chat/`);
  relevance-filtered retrieval (no random notes); no per-query full re-index.

### 2.2 Grounding & tool-calling policy (research mode)

Vault notes enter a turn **only** via one of:

1. **`@`-mention** — `[[wikilink]]` targets are always force-attached to the turn.
2. **Tool call** — the model calls `search_vault` / `read_file` / `list_folder` to pull notes
   on demand (the default path in **Research** mode).
3. **Auto/agent mode** (`groundingMode: "auto"`) — the assistant proactively retrieves the
   top-k notes into the system prompt (old behavior).

Otherwise the assistant is a plain tool-using research assistant. The system prompt instructs it
to use `search_vault`/`read_file` to find context, cite `[[wikilinks]]`, and say plainly when the
vault lacks the answer. Read tools are always available; **write** tools are gated by the
approval mode (default **review**). A per-folder blacklist prevents the agent from reading,
searching, or editing excluded folders.

### 2.3 Provider / network stack (verified)

The direct plugin → provider path must handle three layers; lessons learned (all verified by
curl/python):

1. **CORS** — browser `fetch` is CORS-bound. Use Obsidian's `requestUrl` (no CORS) as a
   fallback.
2. **Cloudflare WAF** — OpenCode blocks non-browser User-Agents (400/403 "error code 1010").
   Send a browser-like `User-Agent`.
3. **Tools wire format** — the upstream requires OpenAI's `{ type: "function", function: {…} }`
   wrapping; a flat `{ name, description, parameters }` yields `400 invalid_request_error:
   Failed to serialize`.

Result: streaming via `fetch` is attempted first; on CORS/network failure it falls back to a
non-streaming `requestUrl` call (browser UA + wrapped tools). Providers that block browser CORS
(like OpenCode) therefore reply **all at once**; true token streaming requires the harness/gateway
SSE relay (below).

### 2.4 In the MVP

| # | Piece | Where | Why it's in the cut |
|---|---|---|---|
| 1 | **Job lifecycle** in the gateway | `harness/src/gateway.mjs` | The core of "start a job, walk away, results waiting". Jobs survive client disconnect, are pollable, and are cancelled by TTL/`DELETE`. |
| 2 | **Agentic worker** (our own tool loop) | `harness/src/agent-worker.mjs` (new) | A worker that actually does multi-step tool work — reuses the proven `engine.ts` loop shape + provider streaming parser. |
| 3 | **Harness-side vault tools** | `harness/src/lra-tools.mjs` (extend) | The same tool contract run on the machine via LRA: `read_file`, `list_folder`, `search_vault` (BM25+wikilink), and a write to the result path. |
| 4 | **Folder-scoped rules (minimal)** | worker + `harness/src/rules.mjs` (new) | Reads root `vault-rules.md` + nearest `.chat/rules.md` (nearest-wins) into the system prompt. Low cost, listed in Phase 3. |
| 5 | **Job HTTP+SSE protocol** | gateway + `plugin/src/chat/gateway.ts` | `POST /jobs`, `GET /jobs/:id`, `GET /jobs/:id/events` (SSE replay), `DELETE /jobs/:id`. Reuses G4 last-event-id replay. |
| 6 | **Plugin job client** | `plugin/src/chat/gateway.ts` (add `GatewayJob`) | start/subscribe/status/cancel, reusing the existing SSE reader/parser. |
| 7 | **Plugin job UI** | `plugin/src/ui/chat-view.ts` | An **Agent** mode toggle; sending in Agent mode starts a job and renders a **progress card** that survives view reload/phone lock (reconnect + poll), and opens the result note on completion. |
| 8 | **Health indicator (minimal)** | `plugin/src/main.ts` + ribbon | Show gateway reachable/unreachable so the "start a job" flow is trustworthy. |
| 9 | **Job settings** | `plugin/src/settings.ts` | Default job target path (`Inbox/`), job model override, harness provider/model. |
| 10 | **Chat via harness: model + web search (Stage A)** | relay/chat worker + `plugin/src/chat/gateway.ts` | Validate streaming + reply quality on mobile before the agent. `web_search` goes **harness-side** (key stays on the machine). |

**Chat storage (user, 2026-09-03):** chat sessions are stored in a **user-designated
vault-relative folder**, default `chat/` (previously hardcoded `Obsidian Chat/`). Added as a
`chatFolder` setting; `persistSession` / `showHistory` read it.

### 2.5 Explicitly deferred out of the MVP (later Phase 3 increments)

- **ACP sessions with opencode/Pi managed binaries.** The MVP uses our **own tool loop**
  (the PLAN explicitly allows this: "own tool-calling loop (light chats, mobile-safe)").
  ACP is a bigger, later increment that plugs a managed CLI behind the same worker contract.
- **Failover matrix** (plugin-relayed path vs LRA vs direct-fs). MVP requires LRA/desktop
  Obsidian to be running on the always-on machine; a cleaner fallback is a later increment.
- **Share-sheet capture → `Inbox/`** (OS entry point, not needed for the research-job exit).
- **Touch polish pass** (long-press actions, keyboard accessory bar) — polish, not the exit.
- **Richer folder-rules engine** (glob priority, interpolation, `AGENTS.md` layering).
- **Job history panel / cost meter** (Phase 4, per plan).
- **Gateway `--tls` + Tailscale cert hardening** — dev runs plain HTTP on the tailnet; real
  certs are a later hardening pass (G3 already validated `tailscale cert`).

---

## 3. Architecture change

### Shift: from "thin relay" to "harness is the agent"

Today the plugin grounds locally and the relay worker only forwards a completion
(`sendViaGateway` → `relay-worker.mjs`). For the MVP the **harness does the work**.
**Stage A** doesn't change this split yet — it keeps the plugin-grounded chat relay and just
adds harness-side web search so the model can answer web questions in the chat. The full shift
(below) lands in **Stage B** when the worker becomes the agent.

```mermaid
flowchart LR
    subgraph Phone["📱 Obsidian mobile"]
        UI[Chat view]
        JOB[GatewayJob client]
    end
    subgraph Harness["🖥️ always-on machine"]
        GW[gateway.mjs]
        AW[agent-worker.mjs]
        LRA[Local REST API → vault]
        KEYS[provider keys]
    end
    subgraph Cloud["☁️ providers"]
        LLM[OpenRouter / Ollama]
        TV[Tavily]
    end

    UI -->|POST /jobs| GW
    UI <--|SSE /jobs:id/events| GW
    UI -->|GET /jobs:id + /health| GW
    GW -->|spawn+task| AW
    AW -->|tools via LRA| LRA
    AW -->|chat completions| LLM
    AW -->|web_search| TV
    AW -->|write result note via LRA| LRA
```

**Key principle:** the phone sends a **task** (instruction + target output path). The worker
resolves grounding, rules, tools, and the final write **itself** using LRA + provider keys
that never leave the machine. The phone only starts/polls/cancels.

### Job vs session (both live in the gateway)

The existing `/sessions` (interactive, grounded relay) stays as the quick-chat path. The new
`/jobs` is the **long-running agentic path**. They are orthogonal.

| | Session (chat) | Job (agent) |
|---|---|---|
| Trigger | interactive turn | explicit "run as agent" task |
| Worker | relay-worker (completion only) | agent-worker (tool loop) |
| Lifetime | idle/TTL, killed after turn | long-lived (minutes-hours), survives disconnect |
| Client needs | stream in real time | start → poll/reconnect → open result |
| Writes | none (plugin grounds + relays) | writes a deliverable note to a target path |

---

## 4. Protocols

### 4.1 Job HTTP surface (gateway)

```
POST   /jobs                       auth. body { task, targetPath?, model? } -> { jobId, status:"running" }
GET    /jobs                       auth. -> [{ jobId, status, createdAt, updatedAt, resultPath? }]
GET    /jobs/:id                   auth. -> { jobId, status, task, resultPath?, events, createdAt, updatedAt, error? }
GET    /jobs/:id/events            auth. SSE, last-event-id replay (G4)      -> progress events
DELETE /jobs/:id                   auth. -> cancel worker, status:"cancelled"
```

Statuses: `queued` · `running` · `done` · `failed` · `cancelled`. A `done`/`failed` job keeps
a small metadata record (with `resultPath`) for `GET /jobs/:id` so the phone can find the
result after reconnecting, even though the worker process is gone.

### 4.2 Job events (SSE)

Reuse the existing worker stdout → gateway SSE ring. The agent worker emits:

```
{"event":"progress","data":{"step":"reading Inbox/note.md"}}
{"event":"reasoning","data":{"text":"…"}}           # thinking stream
{"event":"token","data":{"text":"…"}}               # assistant content (rare in tool loop)
{"event":"tool_call","data":{"name":"search_vault","args":{"query":"…"}}}
{"event":"tool_result","data":{"name":"search_vault","output":"…"}}
{"event":"done","data":{"resultPath":"Inbox/…-research.md","outline":true}}
{"event":"error","data":{"text":"…"}}
```

The gateway assigns monotonically increasing event ids (reuse `Session.push`) so the plugin's
`last-event-id` replay works unchanged.

### 4.3 Safety model (critical — no interactive approval on a background job)

There is **no human in the loop** while the phone is locked. So jobs are **safe by
construction**, not by approval:

- **Read access everywhere** (vault + web) — `read_file`, `list_folder`, `search_vault`, `web_search`.
- **Write access to ONE output location only** — the job's `targetPath` (default `Inbox/`).
  The only write tool exposed is `create_note` (or a job-scoped `write_note`), and the worker
  **rejects** any write whose path is not under `targetPath`'s folder.
- **No destructive tools** in a job: no `edit_note` in-place, no `delete_file`, no
  `rename_move_file`, no `set_property`/`manage_tags` on arbitrary notes. This makes stray
  agent behavior non-destructive by design.
- **Job opts in.** The user explicitly starts an agent job; the system prompt states the
  output path and read-only-elsewhere constraint.

This posture is the MVP's answer to "user is always in control" for the background case. A
richer per-folder permission policy is a later increment.

---

## 5. Implementation sequence (staged, each with an exit)

### Stage A — Chat via harness: model + web search, validate streaming/replies
Wire the **model** and **web search** into the **harness chat path** and confirm it looks good
before building the agent. The relay chat path (`sendViaGateway` → relay worker) already
streams the model; this stage (1) makes web search **harness-side** so the model can call a
`web_search` tool on the machine (key stays on the box), and (2) validates the streaming +
reply UX end-to-end on mobile over Tailscale.
- Upgrade the relay/chat worker to run a **minimal tool loop for `web_search`** (Tavily via
  env key) — accumulate tool calls from the streaming response, run them harness-side, feed
  the results back so the model can synthesize.
- Confirm the model streams well (token + `delta.reasoning` first-class) and replies render
  nicely (Markdown, citations, reasoning blocks) in the chat surface.
- Add/verify a harness-side `web_search` tool + settings switch (`search = harness-side`).
- **Exit:** from the phone, the harness chat streams a good-looking, web-grounded reply
  end-to-end. **No job lifecycle, no vault tools, no rules yet.**

### Stage B — Remote agent worker + job protocol (harness only)
Build `agent-worker.mjs` that runs a single tool-loop turn against a provider (no retrieval
yet): read/list/search via LRA, bounded rounds + token budget (port `engine.ts` logic), emit
progress events. Add `/jobs*` routes + job reaper to `gateway.mjs`. Test with a curl/Node
client.
- **Exit:** `POST /jobs` with `{task:"list Inbox and write a summary note"}` → worker runs →
  a note is written → `GET /jobs/:id` shows `done` with `resultPath` → `GET /jobs/:id/events`
  replays progress on a fresh connection (disconnect+reconnect).

### Stage C — Grounding on the harness
Add a `search_vault` tool that does BM25 + wikilink boost **over LRA** (port the plugin's
`VaultIndex`/cascade to the harness; cache the index in-memory, invalidate by mtime). Add the
minimal folder-rules reader (`rules.mjs`). Seed the worker system prompt with rules + context.
Iterate on a sample "research X" task for answer quality.
- **Exit:** a research task retrieves the right notes and produces a grounded, cited result note.

### Stage D — Plugin job client + UI
Add `GatewayJob` (start/subscribe/status/cancel, reusing the SSE parser). In `chat-view.ts`,
add an **Agent** mode toggle; sending in Agent mode starts a job and renders a **progress card**
(spinner, current step/tool, token count) that reconnects/polls on view reload or phone lock,
and shows an "Open result note" action on completion. Add the ribbon **health indicator**.
Add job settings (target path, model) to the settings tab.
- **Exit:** on the phone, start a research task, lock the phone, reopen → the job card shows
  completed and opens the result note.

### Stage E — Hardening / validation (optional pre-"Phase 3 done")
Add cancel job, error surfacing, job list, target-path guard tests, and validate the full flow
on the actual iPad over Tailscale (the G3-validated transport). Wire the desktop "run as job"
path too (same protocol, local).
- **Exit:** the Phase 3 exit is demonstrably met on real hardware.

---

## 6. Key files (new / changed)

**Harness (`harness/`)**
- `src/gateway.mjs` — add `/jobs*` routes, job store, job reaper, job event ring.
- `src/agent-worker.mjs` — **new**: agentic tool loop, provider streaming, LRA tools, rules, write result.
- `src/lra-tools.mjs` — **extend**: add `search_vault` (BM25+wikilink over LRA), `write_note` (path-guarded), job-safe tool subset.
- `src/rules.mjs` — **new**: read root `vault-rules.md` + `.chat/rules.md` nearest-wins.
- `src/retrieve.mjs` — **new**: harness BM25 + wikilink boost over LRA (port of plugin retrieval).
- `package.json` — add `agent-worker` script.

**Plugin (`plugin/src/`)**
- `chat/gateway.ts` — add `GatewayJob` client.
- `ui/chat-view.ts` — Agent mode toggle, job progress card, reconnect/poll, open result.
- `main.ts` — ribbon health indicator.
- `settings.ts` — job target path / model settings.
- `chat/runtime.ts` — (no change; harness path bypasses the provider runtime).

---

## 7. Risks & unknowns

| Risk | Mitigation |
|---|---|
| **LRA must be up** for a long job (worker makes many LRA calls; LRA only exists while desktop Obsidian runs) | MVP requires the always-on machine to run desktop Obsidian + LRA; worker treats LRA errors as job-failure with a clear message. Direct-fs fallback is a later increment. |
| **Retrieval-over-LRA cost** (BM25 index over 4k notes via HTTP) | Cache an in-memory index (lazily built, invalidated by vault mtime/ETag); accept a slower first search on the always-on machine. |
| **Stream parser + tool-call accumulation** for long tool loops | Reuse the proven relay-worker fetch/parse + `engine.ts` loop shape; enforce `maxToolRounds` + token budget. |
| **Job lost on gateway restart** | MVP: jobs are best-effort; persist a small `jobs.json` (status + `resultPath`) so `GET /jobs/:id` survives restart for `done` jobs. |
| **Runaway / runaway cost** | Token budget + round cap per job (reuse Phase 2a settings), plus a job TTL reaper. |
| **Agent writes to wrong place** | Path-guarded write tool: only `targetPath` (default `Inbox/`) is writable; all other writes rejected. |

---

## 8. Next action

Start with **Stage A**. Concretely:
1. Create `harness/src/agent-worker.mjs` (tool loop + provider stream + LRA tools + write).
2. Add `/jobs*` to `harness/src/gateway.mjs`.
3. Smoke-test a job from the CLI, then validate disconnect/reconnect replay.

Then confirm the exact UX for the Agent mode toggle (separate toggle vs. `/agent` slash
command vs. auto-detect "long task" on mobile) before building Stage C.

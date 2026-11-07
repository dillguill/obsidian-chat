# Contract: Read-Only Vault MCP Server

**Status**: Design contract for spec `004-acp-shell` (approved 2026-11-07).
**Applies to**: `plugin/src/vault/mcp-server.ts`, `plugin/src/host/` route in
`plugin/src/shell/host-server.ts`.
**Spec**: FR-023…FR-033, FR-026…FR-031, FR-058, FR-072.

The host plugin serves native Obsidian read/search to the harness through a **read-only** MCP
server that runs in the Obsidian host process. It is not a separate process, not a proxy, and not a
second policy implementation: every tool calls the shared `VaultService`
(`plugin/src/vault/service.ts`).

## 1. Transport and endpoint

- MCP **Streamable HTTP**, stateless JSON-response mode, on the same single host listener as the ACP
  endpoint: `POST /mcp`.
- Each POST carries one JSON-RPC message (batch tolerated) and receives an `application/json`
  response; requests that contain only notifications/responses return `202` with no body. `GET
  /mcp` returns `405` (no optional SSE stream), which the MCP specification allows for a
  request/response tool server.
- Protocol version: `2025-06-18` (as today's handler). `initialize` responds with
  `serverInfo: { name: "obsidian-vault", version: <plugin version> }` and
  `capabilities: { tools: {} }` only. No resources, prompts, sampling, or elicitation.
- The server is mounted only on the host process; mobile and remote-only instances do not start it.

## 2. Authentication and exposure

- **Loopback only**: the request's socket address must be `127.0.0.1`, `::1`, or
  `::ffff:127.0.0.1`; anything else is `401` before dispatch.
- **Per-session bearer token**: the host mints an unguessable token for each ACP session and passes
  it in the `mcpServers` entry of `session/new` (as an `Authorization: Bearer` header, MCP's
  standard HTTP header). The token is validated in constant time; wrong/absent → `401`.
- The token is never logged, rendered, stored in the session record, or reused across sessions; it
  is revoked when the session closes.
- The server never trusts the harness's claimed identity beyond the token; session-scoped tokens
  mean a harness can only see the vault it was attached to.
- Host bind rules and the single-listener guarantee are in `contracts/host-transport.md` §1.

## 3. Tool surface (read-only)

All tools are read-only and side-effect free. Paths are vault-relative or absolute inside the vault;
the service normalizes them and applies the same path policy as ACP fs. Results use vault-relative
paths. `get_note_metadata`/`get_outline`/`get_links`/`get_backlinks` return an `isError` tool result
for a path outside the vault, blacklisted, under `.obsidian/`, or missing.

| Tool | Input | Output |
|---|---|---|
| `search_notes` | `{ query: string; limit?: number (1–50, default 10); folder?: string; tags?: string[] }` | `[{ path, title, snippet, score }]` — scored search over the shared corpus the shell's mention picker also uses. Implement a small pure BM25 in `vault/search.ts` over the existing document cache (`plugin/src/retrieval/index.ts` is a raw cache with no scoring today); if BM25 is not shipped, the honest fallback is bounded substring + title boost and the tool description must say so. |
| `get_backlinks` | `{ path: string; limit?: number (1–50, default 20) }` | `[{ path, title, count }]` — derived by inverting `metadataCache.resolvedLinks`; the installed Obsidian API has no `getBacklinksForFile` |
| `get_links` | `{ path: string }` | `[{ path, title, resolved: boolean }]` — outgoing links from `getFileCache` + `getFirstLinkpathDest`; unresolved links are shown as unresolved |
| `list_tags` | `{ prefix?: string; limit?: number (1–200, default 100) }` | `[{ tag, count }]` — `getAllTags` aggregated across markdown files |
| `get_outline` | `{ path: string }` | `[{ level: 1–6, heading, line }]` — `cache.headings` in document order |
| `get_note_metadata` | `{ path: string }` | `{ path, title, size, mtime, tags, frontmatter, links, backlinkCount }` — bounded/safely serialized |

Rules:

- Search results **exclude** blacklisted folders and `.obsidian/` silently (they are invisible), and
  never include file content beyond a bounded snippet.
- No write, edit, append, patch, move, delete, rename, command, or terminal tool exists. A harness
  attempt at such a tool gets a standard "unknown tool" tool error, and the shell records it as a
  tool-call failure in the transcript (the harness reported it), never as a shell action.
- Tool arguments are validated against the schemas above; invalid arguments are tool errors with a
  safe message, not protocol errors.
- The tool list is stable; adding a tool later is additive and must respect the read-only and
  shared-policy rules.

## 4. Shared policy and data source

- Every tool calls `VaultService`; no tool reads files directly, builds a second index, or
  duplicates path/blacklist logic (FR-024/FR-029).
- Search uses the shell's own scored index (a small BM25 implemented in `vault/search.ts` over the
  document cache the `@mention` picker already builds), refreshed from the vault; metadata queries
  use Obsidian's live `MetadataCache` (`resolvedLinks` inversion for backlinks, `getFileCache` for
  links/headings, `getAllTags` for tags, `frontmatter`). No new dependency, index service, or
  external process.
- The ACP filesystem handlers use the same service for read/write; writes are **not** exposed here
  (FR-028).
- Blacklist and `.obsidian/` rules are the same setting and the same code path as ACP fs
  (FR-022/FR-023).

## 5. Bounds and failure behaviour

- Bounds: default/max limits as in §3; snippets ≤ 400 characters; each response ≤ ~256 KB; per-call
  timeout 5 s (search 2 s). Excess results are truncated with a `truncated: true` hint in the
  result, never silently.
- Tool failures are MCP tool results with `isError: true` and a safe message; the JSON-RPC layer
  only errors on malformed requests.
- If the MCP server cannot start or is unavailable (e.g. listener failed), the host MUST keep chat
  working through ACP and surface "native vault tools unavailable" in the UI; tools must not return
  empty success (FR-031).
- No token, credential, or file content in error messages or logs.

## 6. Harness wiring

- The host passes this server in `session/new`'s `mcpServers`:
  `{ name: "vault", type: "http", url: "http://127.0.0.1:<port>/mcp", headers: [{ name: "Authorization", value: "Bearer <session token>" }] }` —
  **only when the harness advertises `agentCapabilities.mcpCapabilities.http === true`**. Otherwise
  the host sends `mcpServers: []`, marks native vault tools unavailable for that run, and keeps chat
  working over ACP (FR-031); it never claims the tools are present.
- The shell passes only this server in v1 (FR-033); no user-configured third-party MCP servers are
  forwarded.
- If the harness reports the server as unavailable, the UI surfaces it; the shell does not retry the
  harness's MCP connection itself.

## 6a. Protocol dispatch details (minimal handler)

Implement `initialize`, `notifications/initialized` (ignore), `ping`, `tools/list`, `tools/call`;
tolerate `MCP-Protocol-Version` / `Accept` headers; unknown methods → `-32601`, unknown tools →
tool error `-32602`, malformed JSON → `-32700`. Every tool declares
`annotations: { readOnlyHint: true, destructiveHint: false }`. Result payloads are text content
(one JSON value or line-oriented text as listed in §3), capped per §5.

## 7. Conformance checks (plan gates)

- Tool list contains exactly the read-only tools in §3; a grep for write-shaped tool names returns
  none in `vault/mcp-server.ts`.
- Fake-vault tests: search, backlinks, links, tags, outline, metadata return expected fixture
  results; a blacklisted path is invisible to search and errors on direct access; `.obsidian/` is
  refused; non-loopback and missing/wrong token are `401`; invalid args produce tool errors.
- Shared-service proof: removing/altering `VaultService` behaviour changes both ACP fs and MCP
  results identically; no second path-policy implementation exists.

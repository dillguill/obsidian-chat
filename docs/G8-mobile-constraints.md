# Gate G8 — Mobile constraints & architecture implications

> Phase 0 gate. **Purpose:** document the hard iOS/Android + Obsidian-mobile constraints a plugin must respect, and state how the architecture (§2.4) is shaped by them. Grounded in hands-on Phase 0 evidence (G2, G4, G5) plus the official Obsidian developer docs.

## 1. The non-negotiables (authoritative)

| Constraint | Authority | Consequence / rule |
|---|---|---|
| **No Node.js / no Electron APIs on mobile** | Obsidian docs (Mobile development) | `child_process`, `fs`, `path`, `crypto` (Node) will **crash** on mobile. All shared code must be browser-safe. Anything heavy → the harness. |
| **`requestUrl()` = no CORS restrictions** | Obsidian `requestUrl` reference ("without any CORS restrictions") | Use `requestUrl` for ALL network calls in the plugin — it bypasses browser CORS entirely (privileged Electron/plugin API, not `fetch`). This is the plugin-direct path. |
| **Raw browser `fetch` IS CORS-bound** | G2 spike | In a web/page context `fetch` faces CORS; LRA sends `Access-Control-Allow-Origin: *` but **rejects `credentials:"include"`**. The plugin should use `requestUrl`, not `fetch`, to avoid this. |
| **Capacitor webview backgrounding suspends timers & network** | G4 spike (iOS Safari/webview) | Backgrounding kills in-flight SSE streams (`Load failed`). Need durable event stream with replay (last-event-id) + exponential backoff + retry cap (G4 already proved the fix). |
| **iOS regex lookbehind only on iOS 16.4+** | Obsidian docs | Avoid lookbehind regex, or feature-detect via `Platform`/capability check if it's truly needed. |
| **`Platform.isIosApp` / `isAndroidApp`** | Obsidian docs | Platform detection for two-layout + copy/UI differences. Desktop-only plugins set `isDesktopOnly: true` — we must NOT. |
| **No native code shipped** | PLAN §2.3 / community-plugin rule | Mobile is a Capacitor webview; no native nav/sheets/gestures. OS-level hard parts must be handled in webview with CSS/JS, not native modules. |
| **Keys: keychain-backed secret storage** | PLAN §2.4 | Use `SecretStorage` for tokens; never store API keys in `data.json`. Always-on machine keeps provider keys; phone sends a per-device bearer to the gateway. |

## 2. Transport reality on mobile (from the spikes)

- **Direct-BYOUK from iOS is fragile.** `fetch` streaming from a browser webview stalls/backgrounds; CORS on cloud providers is real. → The gateway path is the primary mobile route.
- **Harness path (chosen):** iOS app → Tailscale → HTTPS to a launchd gateway on the always-on machine → per-device bearer token → ephemeral worker. Keys never leave the machine. Validated end-to-end in **G2/G3/G4**.
- **Streaming must tolerate suspension.** Tab/webview backgrounding kills the stream. The client reconnects with `Last-Event-ID`; the gateway replays buffered events (G4: ids 3–15 cleanly replayed after a drop). Any approval cards / long-running turns MUST survive backgrounding via this replay.
- **Local REST API (LRA) is reachable from the harness** on `127.0.0.1:27124` with `Authorization: Bearer <apiKey>` (G2). The plugin-direct path can also call LRA via `requestUrl` (no CORS) as a fallback/mobile-relay, so the plugin doesn't depend on the harness being up.

## 3. Two-layout UX constraints (mobile-first)

- **One component library, two layouts.** Mobile is a full-screen workspace, not a shrunken sidebar. `isMobileApp`-aware; responsive switch on pane width.
- **Approval cards / diffs as bottom sheets** (PLAN §4) — because there are no native modals on the webview-safe path to rely on; use Obsidian components.
- **No `child_process`/`fs` anywhere in shared paths** — the harness owns all file-system + agent execution; the plugin only talks HTTP and obsidian Vault API.
- **Share-sheet entry** (capture idea on phone → chat → "file this under Inbox/…") is an OS entry point that must be handled via Obsidian's mobile share integration / protocol handler, then hand off to the harness. Documented here; built in Phase 2.

## 4. Architecture rules locked by G8

1. **Plugin never stores provider API keys** for the harness path; uses `SecretStorage` for the per-device bearer token.
2. **All network via `requestUrl`** (no raw `fetch`) in the plugin; the browser-fetch CORS issue is avoided entirely.
3. **Stream parser must emit `delta.reasoning` as a first-class event** (G7 finding) and support `Last-Event-ID` replay.
4. **No Node/Electron APIs** in shared module graph; enforce with a lint guard (e.g. forbid `child_process`/`fs` imports outside `harness/`).
5. **Retrieval is pure TS, no deps** (lex + wikilink graph, G6) — safe on mobile, no vector DB.

## 5. Reference links
- Obsidian `requestUrl` — https://docs.obsidian.md/Reference/TypeScript+API/requestUrl
- Mobile development — https://docs.obsidian.md/Plugins/Getting+started/Mobile+development
- G2 LRA reachability + `requestUrl` CORS — `SPIKES.md` (§G2)
- G4 stream-suspension/replay — `SPIKES.md` (§G4)
- G7 provider streaming & `delta.reasoning` — `SPIKES.md` (§G7)

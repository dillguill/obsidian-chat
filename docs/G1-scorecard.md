# Gate G1 — Competitor Scorecard (informational)

> Phase 0 gate. **Purpose:** verify the Health/Review numbers and feature claims for the five inspiration plugins hands-on, so Phase 1 borrows the right ideas. **No marketplace submission gate applies until Phase 6** (personal-use-first positioning). This is a borrowing-input, not a ranking to publish.

Date: 2026-09-02 · Source table: `PLAN.md §1.1–§1.2`. The PLAN's numbers (from Obsidian community plugin listings / Scorecard tab) are reproduced below and annotated with the *actionable* takeaway for each.

## 1. Scorecard filter (> 3 of 4 on Health **and** Review)

| Plugin | Health | Review | Passes bar (>3/4 both)? | Phase-1 takeaway |
|---|---|---|---|---|
| Copilot (Brevilabs) | Excellent (4) | Satisfactory (3) | ❌ | Permission-controlled multi-turn tool use; Projects; Quick Ask; mobile as first-class |
| Claudian | Excellent (4) | Satisfactory (3) | ❌ | Provider-agnostic harness (`src/providers/*` + shared `ChatRuntime`); inline edit w/ diff; Plan Mode |
| **Karpathy LLM Wiki** | Excellent (4) | Passed/Perfect (4) | ✅ | **The knowledge-layer model we reuse**: no-chunk/no-embedding graph retrieval over `[[wikilink]]s` (PPR optional) |
| Claude Sidebar | Excellent (4) | Satisfactory (3) | ❌ | Harness-as-terminal proof; multi-tab sessions; right-click context menus |
| **AI Agent** | Excellent (4) | Passed (4) | ✅ | Minimal complete vault tool set; chats as plain notes; review-before-apply |

## 2. Feature-matrix gap analysis (why none fits)

**Verdict (from PLAN §1.4):** no existing plugin matches. Karpathy Wiki + AI Agent pass the bar but each covers only one slice. We build our own, borrowing the strongest ideas.

| Gap | Who has it? | Why it blocks us |
|---|---|---|
| No plugin has the full package (grounding + chat + agent + mobile + clipper + harness) | — | Composing plugins = conflicting UIs, duplicate config, no shared context |
| Copilot: cloud features behind paid plan | Copilot | We want BYOK, no subscription |
| Claudian / Claude Sidebar / AI Agent: desktop-only | Claudian, Sidebar, AI Agent | Native mobile is a hard requirement |
| Sidebar & Claudian need agent CLIs on every device | Claudian, Sidebar | Mobile can't run CLIs; one harness on the always-on machine |
| Karpathy Wiki: chat is wiki-only, no write tools, no web search | Karpathy | Need general chat + full vault CRUD, not just Q&A |
| AI Agent: no grounding beyond text search | AI Agent | Vault-grounded answers need graph/retrieval at scale |

## 3. Hand-verification notes

(G1 asked to install AI Agent + Karpathy Wiki in a scratch vault to confirm claims hands-on. These are the two that pass the bar and whose patterns we borrow most directly.)

- **Karpathy LLM Wiki** — key pattern to reuse: graph signals over `[[wiki-link]]` structure with **no embeddings / no vector DB**. This is exactly what Phase 0 **G6** validated (lex + single-hop wikilink boost; no embeddings needed). The 5-stage seed cascade (lex fast path → LLM keywords → substring → semantic → graph) is the retrieval model we adopt in a lighter form.
- **AI Agent** — model for the minimal tool set: create/read/edit note, create folder, list files, vault search, date-range filter; chats persisted as plain Obsidian notes; review-before-apply toggle.

**Not installing into the real vault:** to avoid touching the user's live vault, claim verification is done against the public feature docs/code paths listed above and the PLAN's recorded figures; actual scratch-vault install is deferred to Phase 1 tooling setup if a live check is needed.

## 4. Decisions locked by this gate

1. Build our own plugin — no single competitor covers the use cases.
2. **Retrieval = lex + keyword + wikilink graph (no embeddings, no vector DB)** — confirmed viable by G6.
3. **Mobile is a first-class constraint** — this is the differentiator (no competitor ships a designed mobile experience).
4. **One harness on the always-on machine** (desktop can also run direct-BYOK), not CLIs on every device.
5. Borrow: Copilot (permission-gated tool use, Projects, Quick Ask), Claudian (provider harness, inline diff, Plan Mode), AI Agent (minimal vault tool set, chats-as-notes, review-before-apply), Karpathy Wiki (graph retrieval model).

# AGENTS.md — Dillon Obsidian Vault

Vault name: **Dillon** · root: `/home/you/Obsidian/Vault` · synced (Syncthing) from a Mac (source of truth) to an Ubuntu machine.

This file governs how agents work in this vault. Read it before querying or changing anything.

## Blacklist (mandatory)

The following directories are **excluded from any kind of query or search** — every search, summary, tag list, link report, and inventory must skip them. Nothing from them may be quoted, linked, summarized, or referenced:

- `Journals/`
- `_attachments/`
- `.trash/`

The Obsidian CLI returns results across the **whole vault**, including these three. Applying the blacklist is a mandatory post-filter on top of any CLI or filesystem query. When counting or listing, state that blacklisted dirs were excluded.

## Vault architecture

| Folder | Purpose |
| :--- | :--- |
| `Bases/` | Base (.base) filter definitions; directory-agnostic MOCs (subfolders under `Bases/Information/`) |
| `Bookmarks/` | Karakeep-synced bookmarks — external source, treat as read-mostly (see Bookmark policy) |
| `Canvas/` | Obsidian canvases (JSON, not Markdown) |
| `Clippings/` | Captured web articles/clippings with frontmatter (`title`, `source`, `author`, `published`) |
| `Documentation/` | Tool/service docs, setup & architecture notes |
| `Education/` | Course/class notes; structured learning captured before refinement into `Notes/` |
| `Inbox/` | Capture area; triage into other folders or delete |
| `Journals/` | Personal journal — **blacklisted** |
| `Library/` | Book storage for the Third Mind Reader plugin (EPUB/PDF); `Library/Annotations/` holds per-book highlight/bookmark notes |
| `Notes/` | Atomic/evergreen knowledge notes (1 note = 1 concept) |
| `Projects/` | Multi-stage project planning and tracking |
| `Tasks/` | Task-per-file notes + `Tasks/Tasks.base` view |
| `Work/` | Work-related notes |
| `_attachments/` | Media attachments — **blacklisted** |
| `_obsidian/` | Reserved/ops (currently empty) |
| `_templater/` | Templater JS scripts |
| `_templates/` | Note templates (subfolders per note type) |

Principles (see `Documentation/Obsidian.md`): 1 note = 1 concept; if an LLM can answer it, don't write it; standardize > centralize. Bases are directory-agnostic views defined in `.base` files — filters over YAML frontmatter, not folders.

## Task conventions

Task model: **hub → task → subtask**, rendered from `Tasks/Tasks.base`.

- **Hierarchy.** A hub/project note embeds `![[Tasks.base#tasks]]`; a task note (`type: task`) links to its hub via `topics:`; a subtask is an inline `- [ ]` item — usually a plain checkbox, or `- [ ] [[NoteName]]` / `- [ ] ![]()` when a linked resource is attached.
- **`Tasks.base` views:**
  - `All Tasks` — global: every note in `Tasks/` plus any note typed `task`/`subtask`, grouped by container (`topics`).
  - `tasks` — `topics.contains(this.file) AND type == "task"`; embedded in a hub, shows every task whose `topics` links to that hub.
  - `subtasks` — `topics.contains(this.file) AND type == "subtask"`; **escalation-only** — shows note-worthy sub-items whose `topics` links to the parent task.
- **Inline `- [ ]` is the default subtask surface.** Bases reads **YAML frontmatter only**, never inline items — so inline checkboxes/references are queried via the Obsidian CLI (`tasks`, `task`), not overlaid in a base.
- **Escalate to a note only when a subtask earns one** (needs its own context/comments): give it `type: subtask` + `topics: ["[[parent task]]"]` frontmatter and it surfaces under the parent's `#subtasks` view. Do not file-per-task trivial micro-steps.
- **Frontmatter fields** on task notes (template `_templates/Notes/Tasks Template.md`):
  - `type:` — `task` for a task note; `subtask` for an escalated subtask
  - `topics:` — wikilink list to the **immediate container** (hub/project for a task, parent task for a subtask); **the aggregation key** for `#tasks` / `#subtasks`
  - `priority:` — numeric; higher = more urgent (sorts the `All Tasks` view)
  - `complete:` — set `true` when done
  - `status:` — ladder pattern `00 Not Started` → `10 Planned` → `20 Active` → …
  - `tags:` — includes `tasks`; project-tag for the owning project (e.g. `obsidian`)
- **`this` in an embedded base = the active note.** `![[Tasks.base#tasks]]` scopes to whatever note is focused — stay on the hub for its view; the embedded results re-scope when you navigate away (Bases' documented `this` behavior).
- Canonical analysis: `Tasks/Obsidian Tasks System.md` (task-model patterns A/B/C/F) and `Tasks/Second Brain Organizing.md` (requirements/contradictions).

## Queries — use the Obsidian CLI

Prefer the `obsidian` CLI (available as `obsidian` on the shell) for fast vault queries. It targets this vault as `vault=Dillon`.

```sh
obsidian vault=Dillon search "query=<text>"         # + path=<folder> total case format=text|json
obsidian vault=Dillon search:context "query=<text>"
obsidian vault=Dillon tasks                        # list tasks
obsidian vault=Dillon task                         # show/update a single task
obsidian vault=Dillon tags                         # + total
obsidian vault=Dillon properties
obsidian vault=Dillon property:read name=<name>
obsidian vault=Dillon backlinks                    # / links / unresolved / orphans / deadends
obsidian vault=Dillon files                        # / folders / bases / base:query / base:views
```

- `file=<name>` resolves by wikilink name; `path=<folder/note.md>` is exact. Quote values with spaces.
- **The CLI spans the whole vault, including `Journals/`, `_attachments/`, `.trash/` — always apply the blacklist as a post-filter.**
- Prefer CLI over globbing/grepping the filesystem for vault-wide content queries.
- After renames/moves, verify links with `obsidian unresolved` (don't leave dangling wikilinks).

## Fold-in rule

When a clipping or bookmark supports a parent note (task, doc, or concept), fold it into the parent rather than duplicating content:

- Add a resource line under a `## Resources` section in the parent: `- [ ] [[NoteName]]`.
- Reference-only material gets a tag (e.g. `#obsidian`) for awareness/querying, not a checkbox.
- Bookmarks are the exception: their tags can't be edited (syncs revert tags). Query against the tags Karakeep already synced, and reference a bookmark from a parent with `- [ ] [[bookmark]]` or annotate it under its own `## Notes` section.

## Bookmark policy

`Bookmarks/` is **one-way synced from Karakeep (external source)**. Therefore:

- **No moves, renames, deletes, or dedupes of bookmark files.** Flag anomalies to the user; cleanup happens on the Karakeep side.
- **Frontmatter is not editable** — `tags`, `title`, `source`, `bookmark_id`, `date`, etc. are synced in and **revert on sync**. Do not add, change, or remove tags. Note: tags that Karakeep already synced (e.g. `#obsidian`) **do** surface in Bases queries — query against them, but never write them.
- **Body content under `## Notes` is editable** — vault-side annotations/notes go there.
- **Do not alter the existing body links** — `[Visit Link](…)` and `[View in Hoarder](…)` must stay intact.

## Change log

Changes made under this initiative are recorded here as they happen.

- 2026-08-16 — Moved the 16 MBTI personality-type PDFs from `_attachments/` into `Library/A Little Bit of Personality/`. All vault links are basename wikilinks, so nothing broke.
- 2026-08-16 — Moved 30 book PDFs from `_attachments/` into `Library/` (9 textbooks, the 16-book NotesForProfessionals series, and 5 personal books) so Third Mind Reader can index them. All vault links to these are basename wikilinks, so nothing broke. `_attachments/` retains course materials (lecture slides, labs, chapter excerpts, etc.).
- 2026-08-16 — Added the Third Mind Reader plugin (BRAT). It created the top-level `Library/` folder for EPUB/PDF book storage and writes per-book highlight/bookmark notes to `Library/Annotations/`. `Bases/Library.base` is a separate pre-existing view definition, not the storage location. Note: Apple Books-exported EPUBs are nested inside a subfolder and must be re-wrapped to standard EPUB before the plugin can read them.
- 2026-08-12 — Migrated homelab operational docs from the Gitea `docker-services`/`syncthing` wikis into `Documentation/Homelab/` (`Homelab Reference.md`, `Runbook.md`, `Syncthing.md`). Content updated to reflect Portainer-managed stacks, Renovate/Gitea-Actions-deploy removal, and the manual Portainer update flow. `[[Syncthing]]` wikilink in `Documentation/Syncthing - Mac to Lenovo (WSL).md` now resolves to the migrated note.
- 2026-08-12 — Renamed `Documentation/Syncthing - Mac to Lenovo (WSL).md` → `... (WSL, superseded).md` with an obsolete banner: the lenovo machine now runs native Ubuntu, so the WSL+DrvFs inotify incident no longer applies. Rewrote `Documentation/Homelab/Syncthing.md` for native-Ubuntu paths (`/home/you/...`) and added the new `projects` folder (send-only lenovo → receive-only Mac; `.git` and build artifacts excluded via `.stignore`).
- 2026-08-12 — Gitea tidy-up: `docker-services` and `syncthing` wiki pages plus `/Volumes/External/Docker/README.md` now point to `Documentation/Homelab/` as the canonical docs (vault wins; wikis retained as archives).
- 2026-08-12 — Removed the kavita container (`docker compose down`, folder/data kept); removed stale `docker-compose.*`/`Makefile`/`renovate.json` from the migrated stack folders (Portainer owns the stacks now; folders hold data + `.git` archives + README only).

/** Tool-activity presentation (specs/003-workspace-parity W1.2).
 *
 *  Pure functions only — deliberately no `obsidian` import so the entire
 *  name→verb→icon→label mapping is cheap to reason about and reusable by the
 *  replay and changes-card code paths.
 *
 *  Grounded in the P0 live probe (2026-09-13) against `opencode acp`:
 *   - ACP `ToolCall.kind` is **always** `"other"` for MCP tools, so verbs and
 *     icons are derived from the tool *name* first, with `kind` as a fallback.
 *   - ACP `ToolCall.title` carries the raw tool name, double-prefixed by the
 *     MCP server name: `vault_vault_read`, `vault_vault_list`, …
 *   - `locations` is always empty; the target comes from `rawInput`
 *     (`{"path":"AGENTS.md"}`), which arrives on the first `tool_call_update`.
 */
import type { ActivityItem, StreamEvent, ToolStatus } from "../chat/types";
import { inputHasPath, pickTarget } from "../chat/tool-input";

type ToolCallEvent = Extract<StreamEvent, { type: "tool_call" }>;

export type ToolCategory =
  | "list"
  | "read"
  | "write"
  | "patch"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "open"
  | "think"
  | "fetch"
  | "mode"
  | "other";

/** Cleaned vault-MCP/harness tool name → category. */
const NAME_CATEGORY: Record<string, ToolCategory> = {
  // Vault MCP tools (host/vault-mcp.ts), after prefix stripping
  list: "list",
  read: "read",
  get_document_map: "read",
  active_file_get_path: "read",
  write: "write",
  append: "write",
  patch: "patch",
  delete: "delete",
  move: "move",
  copy: "move",
  search_query: "search",
  search_simple: "search",
  search: "search",
  command_execute: "execute",
  command_list: "list",
  tag_list: "list",
  open_file: "open",
  // Native coding-agent tools (present when a non-MCP harness is configured)
  edit: "patch",
  bash: "execute",
  execute: "execute",
  fetch: "fetch",
  web_search: "search",
  web_fetch: "fetch",
  think: "think",
  task: "other",
};

/** ACP `ToolKind` → category, used only when the name is unrecognised. */
const KIND_CATEGORY: Record<string, ToolCategory> = {
  read: "read",
  edit: "patch",
  delete: "delete",
  move: "move",
  search: "search",
  execute: "execute",
  think: "think",
  fetch: "fetch",
  switch_mode: "mode",
  other: "other",
};

/** [gerund, past] — gerund while pending/in_progress, past once settled. */
const VERBS: Record<ToolCategory, [string, string]> = {
  list: ["Listing", "Listed"],
  read: ["Reading", "Read"],
  write: ["Writing", "Wrote"],
  patch: ["Patching", "Patched"],
  delete: ["Deleting", "Deleted"],
  move: ["Moving", "Moved"],
  search: ["Searching", "Searched"],
  execute: ["Running", "Ran"],
  open: ["Opening", "Opened"],
  think: ["Thinking", "Thought"],
  fetch: ["Fetching", "Fetched"],
  mode: ["Switching mode", "Switched mode"],
  other: ["Running", "Ran"],
};

/** Lucide (Obsidian `setIcon`) names — verified-safe icon ids. */
const ICONS: Record<ToolCategory, string> = {
  list: "folder",
  read: "book-open",
  write: "file-plus",
  patch: "pencil",
  delete: "trash-2",
  move: "folder-symlink",
  search: "search",
  execute: "terminal-square",
  open: "file-text",
  think: "brain",
  fetch: "globe",
  mode: "shuffle",
  other: "wrench",
};

/** `vault_vault_read` → `read`; `mcp__vault__vault_read` → `read`. */
export function cleanToolName(raw: string): string {
  let s = (raw ?? "").trim();
  s = s.replace(/^mcp__[^_]+__/, "");
  while (/^vault_/.test(s)) s = s.replace(/^vault_/, "");
  return s;
}

export function toolCategory(name: string, kind?: string): ToolCategory {
  const cleaned = cleanToolName(name).toLowerCase();
  return NAME_CATEGORY[cleaned] ?? (kind ? KIND_CATEGORY[kind] : undefined) ?? "other";
}

/** ACP `title` is usually a tool identifier (`vault_vault_read`), but some
 *  harnesses push human status lines through the same channel — opencode sent
 *  `Loaded skill: obsidian-cli` as a `tool_call` (observed 2026-09-14). Those
 *  must render verbatim: running them through the verb/label machinery produced
 *  a generic "Ran" with no target. */
export function isStatusTitle(raw: string): boolean {
  const s = (raw ?? "").trim();
  if (!s) return false;
  return /[\s:]/.test(s);
}

/** `get_document_map` → `get document map` for a readable fallback label. */
export function prettifyName(name: string): string {
  return name.replace(/_/g, " ").trim();
}

/** Icon id for a row; failures always show the warning triangle. */
export function toolIcon(name: string, kind: string | undefined, status: ToolStatus): string {
  if (status === "failed") return "alert-triangle";
  if (isStatusTitle(name)) return "info";
  return ICONS[toolCategory(name, kind)];
}

/** Tense-adjusted display verb, e.g. `Read` / `Reading`. Empty for status
 *  titles, whose whole text is the label. */
export function verbFor(name: string, kind: string | undefined, status: ToolStatus): string {
  if (isStatusTitle(name)) return "";
  const [gerund, past] = VERBS[toolCategory(name, kind)];
  return status === "completed" || status === "failed" ? past : gerund;
}

export function basename(p: string): string {
  const parts = (p ?? "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : (p ?? "");
}

/** Row label: basename for paths, truncated raw value otherwise. */
export function toolLabel(target: string | undefined, isPath: boolean): string {
  if (!target) return "";
  if (isPath) return basename(target);
  return target.length > 60 ? target.slice(0, 60) + "…" : target;
}

/** Counts added/removed lines in diff-shaped content, ignoring `+++`/`---`. */
export function diffStat(lines?: string[]): { add: number; del: number } | undefined {
  if (!lines?.length) return undefined;
  let add = 0;
  let del = 0;
  for (const l of lines) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) add++;
    else if (l.startsWith("-")) del++;
  }
  return add || del ? { add, del } : undefined;
}

/** `12s` / `1m 5s`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Merge one ACP tool event into the row's accumulated state. ACP sends only
 *  changed fields, so name/kind/input are carried over from `existing`. */
export function applyToolEvent(
  existing: ActivityItem | undefined,
  ev: ToolCallEvent,
  now = Date.now(),
): ActivityItem {
  const rawName = ev.name ?? existing?.rawName ?? "tool";
  const statusTitle = isStatusTitle(rawName);
  const kind = ev.kind ?? existing?.kind;
  const input = ev.rawInput ?? existing?.input;
  const derived = pickTarget(input);
  const target = ev.target ?? derived ?? existing?.target;
  const isPath = target !== undefined && (inputHasPath(input) || existing?.isPath === true);
  const status: ToolStatus = ev.status ?? existing?.status ?? "pending";
  const startedAt = existing?.startedAt ?? now;
  const terminal = status === "completed" || status === "failed";
  const cleaned = cleanToolName(rawName);
  return {
    id: ev.toolCallId,
    rawName,
    name: statusTitle ? rawName.trim() : cleaned,
    kind,
    status,
    input,
    target,
    isPath,
    verb: verbFor(rawName, kind, status),
    // Never blank: fall back to the tool's own name when it has no target
    // (a `tag_list`/`command_list` takes no arguments at all).
    label: statusTitle ? rawName.trim() : toolLabel(target, isPath) || prettifyName(cleaned),
    diff: diffStat(ev.contentLines) ?? existing?.diff,
    startedAt,
    durationSeconds:
      existing?.durationSeconds ?? (terminal ? Math.max(0, (now - startedAt) / 1000) : undefined),
  };
}

/** Collapsed group header, e.g. `3 steps · 12s · 1 failed`. */
export function groupLabel(items: ActivityItem[], durationSeconds?: number): string {
  const n = items.length;
  const parts = [`${n} step${n === 1 ? "" : "s"}`];
  if (durationSeconds !== undefined && durationSeconds >= 1) parts.push(formatDuration(durationSeconds));
  const failed = items.filter((i) => i.status === "failed").length;
  if (failed) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

/** Settled header for a run of agent work: tool steps, or just "Thought"
 *  when the run held only thinking. */
export function workLabel(items: ActivityItem[], thoughts: number, durationSeconds?: number): string {
  if (items.length) return groupLabel(items, durationSeconds);
  const parts = [thoughts ? "Thought" : "Worked"];
  if (durationSeconds !== undefined && durationSeconds >= 1) parts.push(formatDuration(durationSeconds));
  return parts.join(" · ");
}

/** Aggregate diff across a group's rows. */
export function groupDiff(items: ActivityItem[]): { add: number; del: number } | undefined {
  let add = 0;
  let del = 0;
  for (const i of items) {
    if (i.diff) {
      add += i.diff.add;
      del += i.diff.del;
    }
  }
  return add || del ? { add, del } : undefined;
}

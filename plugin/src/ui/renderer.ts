/** Generic ACP transcript renderer (FR-043…FR-050).
 *
 *  Everything comes from ACP's own fields: title verbatim, programmatic name
 *  only as a missing-title fallback, kind/status/content/locations/raw I/O.
 *  There is no tool-name dictionary and no invented labels; unknown update
 *  kinds become a generic raw row and are never dropped. Icons are limited to
 *  ACP's fixed ToolKind enum.
 *
 *  This module is pure (no Obsidian runtime import) so it is unit-testable;
 *  DOM rendering lives in transcript.ts.
 */
import type { RenderUpdate, ToolCallView, ToolContentView } from "../acp/types.ts";
import { boundedJson } from "./raw-bounds.ts";
import { formatDuration } from "./format.ts";

export type ActivityPresentation = "chronological" | "grouped";

/** "grouped" collapses each run of agent activity; "chronological" shows the
 *  same rows with the groups expanded. Unknown settings fall back to it. */
export function activityPresentation(setting: string | null | undefined): ActivityPresentation {
  return setting === "grouped" ? "grouped" : "chronological";
}

export interface ToolCardModel {
  toolCallId: string;
  /** Harness title verbatim; programmatic name only when absent; then kind. */
  title: string;
  kind?: string;
  status?: string;
  late: boolean;
  durationText?: string;
  content: ToolContentView[];
  locations: Array<{ path: string; line?: number }>;
  rawInput?: ReturnType<typeof boundedJson>;
  rawOutput?: ReturnType<typeof boundedJson>;
}

export function toolCardModel(call: ToolCallView, startedAt?: number, now = Date.now()): ToolCardModel {
  const durationText = startedAt !== undefined && call.status && call.status !== "pending" && call.status !== "in_progress"
    ? formatDuration(now - startedAt)
    : undefined;
  return {
    toolCallId: call.toolCallId,
    title: call.title ?? call.name ?? call.kind ?? "Tool call",
    kind: call.kind,
    status: call.status,
    late: call.late === true,
    durationText,
    content: call.content ?? [],
    locations: call.locations ?? [],
    rawInput: call.rawInput === undefined ? undefined : boundedJson(call.rawInput),
    rawOutput: call.rawOutput === undefined ? undefined : boundedJson(call.rawOutput),
  };
}

/** ACP `tool_call_update` carries only the fields that changed: every absent
 *  field keeps its previous value (title, kind, input, …). */
export function mergeToolCall(previous: ToolCallView | undefined, next: ToolCallView): ToolCallView {
  if (!previous) return next;
  const merged: ToolCallView = { ...previous };
  for (const [key, value] of Object.entries(next) as Array<[keyof ToolCallView, unknown]>) {
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** One short, generic detail line for a tool row: the first location, else
 *  the first few primitive input values. Never keyed on tool names. */
export function toolDetail(call: ToolCallView): string {
  const location = call.locations?.[0];
  if (location) return location.line ? `${location.path}:${location.line}` : location.path;
  const input = call.rawInput;
  if (typeof input === "string") return clip(input, 90);
  if (!input || typeof input !== "object") return "";
  const parts: string[] = [];
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
    else if (typeof value === "number" || typeof value === "boolean") parts.push(String(value));
    if (parts.length === 2) break;
  }
  return clip(parts.join(" · ").replace(/\s+/g, " "), 90);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** ACP's fixed ToolKind enum → an icon name. Never a tool-name mapping. */
export const TOOL_KIND_ICONS: Record<string, string> = {
  read: "file-text",
  edit: "pencil",
  delete: "trash-2",
  move: "folder-symlink",
  search: "search",
  execute: "terminal",
  think: "brain",
  fetch: "globe",
  other: "wrench",
};

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}


export interface PromptDisplay {
  /** What the user typed. */
  text: string;
  /** Labels of attached context (notes, selections, vault rules). */
  context: string[];
  images: number;
}

const LEGACY_CONTEXT_HEADER = /^### (?:Context|Vault rules): (.+)$/gm;
const LEGACY_SEPARATOR = "\n\n---\n\n";

/** Splits stored prompt blocks into the typed text and context labels. Context
 *  blocks carry `_meta["obsidian-chat/context"]`; older records prepended the
 *  context to the typed text behind a `---` separator, which is unwrapped. */
export function promptDisplay(blocks: unknown): PromptDisplay {
  const out: PromptDisplay = { text: "", context: [], images: 0 };
  if (!Array.isArray(blocks)) return out;
  const typed: string[] = [];
  for (const block of blocks as Array<Record<string, unknown>>) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "image") {
      out.images += 1;
      continue;
    }
    if (block.type !== "text" || typeof block.text !== "string") continue;
    const meta = block._meta as Record<string, unknown> | undefined;
    const label = meta?.["obsidian-chat/context"];
    if (label !== undefined) {
      out.context.push(basename(String(label)));
      continue;
    }
    typed.push(block.text);
  }
  let text = typed.join("\n");
  if (/^### (?:Context|Vault rules): /.test(text)) {
    const cut = text.lastIndexOf(LEGACY_SEPARATOR);
    if (cut >= 0) {
      const prefix = text.slice(0, cut);
      for (const match of prefix.matchAll(LEGACY_CONTEXT_HEADER)) out.context.push(basename(match[1].trim()));
      text = text.slice(cut + LEGACY_SEPARATOR.length);
    }
  }
  out.text = text.trim();
  return out;
}

function basename(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "") || path;
}

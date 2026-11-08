/** Raw ACP record views (FR-048/FR-050): per-turn "ACP updates" disclosure and
 *  the session-wide raw record (paged). Pure paging/bounds here; the modal that
 *  hosts the pager lives with the connection-details UI.
 */
import { boundedJson, type BoundedJson } from "./raw-bounds.ts";

export interface RawRecordEntry {
  seq?: number;
  ts?: number;
  turn?: number;
  sessionUpdate: string;
  payload: unknown;
  late?: boolean;
}

export const RAW_PAGE_SIZE = 100;

export interface RawPage {
  entries: RawRecordEntry[];
  page: number;
  pages: number;
  total: number;
}

/** 1-based page; clamped into range. */
export function pagedRaw(entries: RawRecordEntry[], page = 1, pageSize = RAW_PAGE_SIZE): RawPage {
  const size = Math.max(1, pageSize);
  const total = entries.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page)), pages);
  const start = (current - 1) * size;
  return { entries: entries.slice(start, start + size), page: current, pages, total };
}

export function rawEntryJson(entry: RawRecordEntry, limit?: number): BoundedJson {
  return boundedJson(
    {
      ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
      ...(entry.ts !== undefined ? { ts: entry.ts } : {}),
      ...(entry.turn !== undefined ? { turn: entry.turn } : {}),
      ...(entry.late ? { late: true } : {}),
      sessionUpdate: entry.sessionUpdate,
      payload: entry.payload,
    },
    limit,
  );
}

export function rawEntriesForTurn(entries: RawRecordEntry[], turn: number): RawRecordEntry[] {
  return entries.filter((entry) => entry.turn === turn);
}

/** Per-turn disclosure under a completed turn. Collapsed by default; the raw
 *  payload is rendered lazily on first open. */
export function renderRawDisclosure(
  container: HTMLElement,
  entries: RawRecordEntry[],
  options: { summary?: string; limit?: number } = {},
): HTMLElement | null {
  if (!entries.length) return null;
  const details = container.createEl("details", { cls: "oc-turn-raw" });
  details.createEl("summary", { text: `${options.summary ?? "ACP updates"} (${entries.length})` });
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("pre")) return;
    const pre = details.createEl("pre");
    pre.setText(entries.map((entry) => rawEntryJson(entry, options.limit).text).join("\n\n"));
  });
  return details;
}

/** Pure formatting helpers for the generic ACP renderer (FR-043…FR-050).
 *  No tool-name vocabulary: these only format numbers/durations/diff stats. */

/** Compact duration for a tool call or thought block. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

/** Added/removed line counts from ACP's diff content variant. */
export function diffStat(oldText: string | undefined, newText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  const before = new Set((oldText ?? "").split("\n"));
  const after = new Set(newText.split("\n"));
  for (const line of after) if (!before.has(line)) added += 1;
  for (const line of before) if (!after.has(line)) removed += 1;
  return { added, removed };
}

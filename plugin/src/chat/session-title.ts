/** Session naming + recent-list dates — pure, obsidian-free, unit-tested.
 *
 *  A chat is a note, so it needs a name the way any note does. The harness
 *  supplies one when it can (`session_info`); until then the first question is
 *  the most honest label available, and only after that does a timestamped
 *  placeholder earn its keep. */

/** First question → a header-sized name. Flattened, control characters
 *  removed, and cut on a word-ish boundary rather than mid-character. */
export function titleFromText(text: string, max = 60): string {
  const flat = text
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
  if (!flat) return "New chat";
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Recents are a glance, not a record: minutes/hours, then a weekday, then a
 *  short date. Never the full locale date at 400px. `now` is injectable so the
 *  thresholds can be tested without freezing the clock. */
export function relativeDate(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

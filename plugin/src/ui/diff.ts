/** Word-level diff for inline edits. Produces keep/add/del segments that render
 *  as <ins>/<del> so a user can review a rewrite before applying it. This is a
 *  finer-grained diff than the line-level `textDiff` in tools/contract.ts. */

export type DiffSegment = { type: "keep" | "add" | "del"; text: string };

/** Tokenize text into words + whitespace/punctuation, preserving gaps so the diff
 *  reads naturally. Splitting on a capturing group keeps the separators in the array. */
function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t !== "");
}

/** Compute a word-level diff via LCS over tokens, then merge adjacent runs. */
export function wordDiff(original: string, rewritten: string): DiffSegment[] {
  const a = tokenize(original);
  const b = tokenize(rewritten);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment["type"], text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("keep", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return segments;
}

/** Render diff segments to HTML with <ins>/<del> wrappers. */
export function renderWordDiff(segments: DiffSegment[]): string {
  return segments
    .map((s) => {
      if (s.type === "add") return `<ins>${escapeHtml(s.text)}</ins>`;
      if (s.type === "del") return `<del>${escapeHtml(s.text)}</del>`;
      return escapeHtml(s.text);
    })
    .join("");
}

/** Rough char coverage of added/removed text (for compact "apply" notices). */
export function diffStat(segments: DiffSegment[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const s of segments) {
    if (s.type === "add") add += s.text.length;
    else if (s.type === "del") del += s.text.length;
  }
  return { add, del };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

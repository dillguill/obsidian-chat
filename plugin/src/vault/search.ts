/** Small BM25 index over the vault's Markdown cache (FR-027).
 *
 *  Pure and dependency-free: the VaultService feeds it documents; MCP search
 *  and the shell's mention picker share the same instance. The previous
 *  `retrieval/index.ts` was only a document cache with no scoring.
 */

export interface SearchDoc {
  /** Vault-relative path. */
  path: string;
  title: string;
  text: string;
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  snippet: string;
}

const K1 = 1.2;
const B = 0.75;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []).filter((t) => t.length >= 2);
}

export class SearchIndex {
  private docs: SearchDoc[] = [];
  private postings = new Map<string, Map<number, number>>();
  private lengths: number[] = [];
  private avgLength = 0;
  private dirty = true;

  setDocs(docs: SearchDoc[]): void {
    this.docs = docs.slice();
    this.dirty = true;
  }

  invalidate(): void {
    this.dirty = true;
  }

  private build(): void {
    if (!this.dirty) return;
    this.postings = new Map();
    this.lengths = new Array(this.docs.length).fill(0);
    let total = 0;
    this.docs.forEach((doc, i) => {
      const tokens = tokenize(`${doc.title} ${doc.title} ${doc.text}`);
      total += tokens.length;
      this.lengths[i] = tokens.length;
      for (const t of tokens) {
        let m = this.postings.get(t);
        if (!m) {
          m = new Map();
          this.postings.set(t, m);
        }
        m.set(i, (m.get(i) ?? 0) + 1);
      }
    });
    this.avgLength = this.docs.length ? total / this.docs.length : 0;
    this.dirty = false;
  }

  search(query: string, limit = 10): SearchHit[] {
    this.build();
    const q = [...new Set(tokenize(query))];
    if (!q.length) return [];
    const scores = new Map<number, number>();
    const n = this.docs.length;
    for (const term of q) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const df = posting.size;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (const [i, tf] of posting) {
        const len = this.lengths[i] || 1;
        const denom = tf + K1 * (1 - B + (B * len) / (this.avgLength || 1));
        const add = idf * ((tf * (K1 + 1)) / denom);
        scores.set(i, (scores.get(i) ?? 0) + add);
      }
    }
    const hits: SearchHit[] = [];
    for (const [i, score] of [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
      const doc = this.docs[i];
      hits.push({ path: doc.path, title: doc.title, score: Math.round(score * 1000) / 1000, snippet: snippetOf(doc.text, q, 400) });
    }
    return hits;
  }
}

function snippetOf(text: string, terms: string[], max: number): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx >= 0 && (at < 0 || idx < at)) at = idx;
  }
  if (at < 0) return text.slice(0, max);
  const start = Math.max(0, at - Math.floor(max / 3));
  const slice = text.slice(start, start + max).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${start + max < text.length ? "…" : ""}`;
}

/** Lex + keyword + wikilink-graph retrieval cascade.
 *  Ported from the Phase 0 G6 spike (`spikes/g6-retrieval/retrieve.mjs`).
 *  Judgment from G6: lexical BM25 is the primary signal; wikilink-graph
 *  expansion is a *conditional ranker boost* (helps project/hub queries, can
 *  pull noise from generic hub pages), so it is secondary to lexical and
 *  single-hop only. No embeddings, no vector DB (PLAN §2.8). */
import type { RetrievedNote } from "../chat/types";

const STOP = new Set(
  "the a an and or of to in on for with is are was were be been being it its at by from as this that these those i you he she we they not have has had do does did but if then else so than too very can will just also there here what when where which who whom".split(" "),
);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Whether a query has enough real content to warrant vault retrieval (≥ 2
 *  content tokens, so "hi" / "what's this" won't rebuild the index). */
export function hasContentSignal(query: string): boolean {
  return tokenize(query).length >= 2;
}

export interface RetrievalDoc {
  rel: string;
  text: string;
}

export interface CascadeOptions {
  /** number of results to return */
  topK?: number;
  /** enable wikilink-graph boost (default true per G6 — conditional benefit) */
  useGraph?: boolean;
}

export function retrieveCascade(query: string, docs: RetrievalDoc[], opts: CascadeOptions = {}): RetrievedNote[] {
  const topK = opts.topK ?? 5;
  const useGraph = opts.useGraph ?? true;
  const N = docs.length;
  if (!N || !query) return [];

  const docTokens = docs.map((d) => tokenize(d.text));
  const docFreq = new Map<string, number>();
  for (const toks of docTokens) for (const t of new Set(toks)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);

  // Nothing to match (query is all stopwords/short) → don't dump arbitrary notes.
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  // BM25-lite
  const scores = new Array(N).fill(0);
  for (const tok of new Set(qTokens)) {
    const df = docFreq.get(tok) ?? 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < N; i++) {
      const tf = docTokens[i].filter((t) => t === tok).length;
      if (tf) scores[i] += idf * (tf * 2.5) / (tf + 1.5 * 0.5 + 1);
    }
  }

  let final = scores.slice();

  if (useGraph) {
    // Build wikilink adjacency (resolve [[Target]] to a doc rel)
    const index = new Map<string, number>();
    docs.forEach((d, i) => index.set(d.rel, i));
    const adj = new Map<number, Set<number>>();
    for (let i = 0; i < N; i++) {
      const links = [...docs[i].text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1]);
      const set = new Set<number>();
      for (const l of links) {
        const target = l.trim();
        for (const cand of [target, target + ".md"]) {
          let key: string | undefined;
          for (const k of index.keys()) {
            if (k === cand || k.endsWith(cand)) {
              key = k;
              break;
            }
          }
          if (key !== undefined) {
            set.add(index.get(key)!);
            break;
          }
        }
      }
      adj.set(i, set);
    }
    // single-hop boost from top-k lexical seeds
    const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a]);
    const seeds = order.slice(0, Math.max(3, Math.floor(topK / 2)));
    const alpha = 0.5;
    for (const se of seeds) {
      for (const nb of adj.get(se) ?? []) final[nb] += scores[se] * alpha;
    }
  }

  // If no document actually matched the query (all scores 0), return nothing —
  // injecting unrelated notes is worse than telling the model it has no context.
  const best = final.reduce((a, b) => Math.max(a, b), 0);
  if (best <= 0) return [];

  // Require each returned note to clearly match the query: it must contain at
  // least 2 distinct query tokens (or all of them if there's only 1). This drops
  // notes that merely share one common word — the "random notes" problem.
  const needCov = Math.min(2, qTokens.length);

  return final
    .map((s, i) => {
      const cov = new Set(qTokens.filter((t) => docTokens[i].includes(t))).size;
      return { rel: docs[i].rel, score: s, cov, snippet: snippet(docs[i].text) };
    })
    .filter((r) => r.score > 0 && r.cov >= needCov)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r) => ({ rel: r.rel, score: r.score, snippet: r.snippet }));
}

function snippet(text: string, len = 160): string {
  const flat = text.replace(/^---[\s\S]*?---/, "").replace(/\n+/g, " ").trim();
  return flat.length > len ? flat.slice(0, len) + "…" : flat;
}

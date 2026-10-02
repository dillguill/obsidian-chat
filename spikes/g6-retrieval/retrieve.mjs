#!/usr/bin/env node
/**
 * G6 retrieval spike — lex + keyword + wikilink-graph cascade.
 *
 * Retrieves the top-K notes for a query using a three-stage cascade on a
 * directory of markdown notes (defaults to the 100-note copy, but can point
 * at the full vault to judge *absolute* recall).
 *
 * Stage 1 (lexical): tokenize query & documents, score by term-frequency
 *   overlap (BM25-lite). Fast, no model.
 * Stage 2 (keyword): match on `[[wikilink]]` graph — notes that link to, or
 *   are linked from, a top lexical hit are boosted (graph signal).
 * Stage 3 (optional): if lexical recall is thin, expand via wikilink neighbors
 *   (PPR-style single hop) — this is what G6 must decide: does graph expansion
 *   earn its keep?
 *
 * Usage:
 *   node retrieve.mjs "query" [--dir=<notes-dir>] [--top=K] [--graph]
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith("--")) ?? "";
const dir =
  args.find((a) => a.startsWith("--dir="))?.slice("--dir=".length) ?? new URL(".", import.meta.url).pathname;
const top = Number(args.find((a) => a.startsWith("--top="))?.split("=")[1] ?? 5);
const useGraph = args.includes("--graph");

// ---- load notes ----
function walk(d) {
  const out = [];
  const entries = fs.readdirSync(d, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
const files = walk(dir);
const notes = files.map((f) => ({
  path: f,
  rel: path.relative(dir, f),
  text: fs.readFileSync(f, "utf8"),
}));

// ---- tokenize ----
const STOP = new Set(
  "the a an and or of to in on for with is are was were be been being it its at by from as this that these those i you he she we they not have has had do does did but if then else so than too very can will just also".split(" "),
);
function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}
const docTokens = notes.map((n) => tokenize(n.text));
const docFreq = new Map();
for (const toks of docTokens) {
  for (const t of new Set(toks)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
}
const N = notes.length;

// ---- stage 1: BM25-lite lexical scoring ----
function bm25(queryTokens) {
  const scores = new Array(N).fill(0);
  let qt = queryTokens.length || 1;
  for (const tok of new Set(queryTokens)) {
    const df = docFreq.get(tok) ?? 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < N; i++) {
      const tf = docTokens[i].filter((t) => t === tok).length;
      if (tf) scores[i] += idf * (tf * (1.5 + 1)) / (tf + 1.5 * (0.5 + 0.5 * 1));
    }
  }
  return scores;
}
const qTokens = tokenize(query);

// ---- stage 2 / 3: wikilink graph ----
function buildGraph() {
  const nodeIndex = new Map(); // rel -> idx
  notes.forEach((n, i) => nodeIndex.set(n.rel, i));
  const adj = new Map(); // idx -> Set(idx)
  for (let i = 0; i < N; i++) {
    const links = [...notes[i].text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1]);
    const set = new Set();
    for (const l of links) {
      // resolve wikilink to a note rel (try exact, then .md suffix)
      let target = l.trim();
      for (const cand of [target, target + ".md"]) {
        const key = Array.from(nodeIndex.keys()).find((k) => k.endsWith(cand) || k === cand);
        if (key !== undefined) {
          set.add(nodeIndex.get(key));
          break;
        }
      }
    }
    adj.set(i, set);
  }
  return adj;
}

// ---- scoring ----
const lexical = bm25(qTokens);
let final = [...lexical];

if (useGraph) {
  const adj = buildGraph();
  // stage 2: boost notes linked from/into top lexical hits
  const order = [...lexical.keys()].sort((a, b) => lexical[b] - lexical[a]);
  const seeds = order.slice(0, Math.max(3, Math.floor(top / 2)));
  // PPR single-hop
  const alpha = 0.5;
  for (const se of seeds) {
    const neighbors = adj.get(se) ?? new Set();
    for (const nb of neighbors) final[nb] += lexical[se] * alpha;
  }
  // stage 3: push neighbors of neighbors lightly
  const seeds2 = [...lexical.keys()].sort((a, b) => final[b] - final[a]).slice(0, 2);
  for (const se of seeds2) {
    const neighbors = adj.get(se) ?? new Set();
    for (const nb of neighbors) {
      const nn = adj.get(nb) ?? new Set();
      for (const x of nn) final[x] += 0.1 * lexical[se];
    }
  }
}

const ranked = final
  .map((s, i) => ({ i, s }))
  .sort((a, b) => b.s - a.s)
  .slice(0, top);

console.log(`QUERY: ${query}`);
console.log(`DIR: ${dir}  (${N} notes)  graph=${useGraph ? "ON" : "OFF"}\n`);
for (const r of ranked) {
  const n = notes[r.i];
  const snippet = n.text.replace(/\n+/g, " ").slice(0, 110);
  console.log(`#${r.i}  score=${r.s.toFixed(2)}  ${n.rel}`);
  console.log(`     ${snippet}`);
}

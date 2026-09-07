#!/usr/bin/env node
/**
 * Harness-side tool executor via the Local REST API plugin (PLAN §2.4 path a).
 * Mirrors the plugin's `src/tools/contract.ts` so the SAME tool contract runs in
 * two places. Auth = `Authorization: Bearer <apiKey>` from the LRA plugin's
 * data.json. Used by a future agentic worker (Phase 3); testable standalone.
 *
 *   node lra-tools.mjs create_note '{"path":"Inbox/x.md","content":"hi"}' ...
 *   node lra-tools.mjs list_folder '{"path":"Inbox"}'
 */
const BASE = process.env.LRA_BASE_URL ?? "https://127.0.0.1:27124";
const KEY = process.env.LRA_API_KEY ?? "";

function enc(rel) {
  return rel.split("/").map(encodeURIComponent).join("/");
}

async function req(method, path, body, headers = {}) {
  const url = `${BASE.replace(/\/$/, "")}/${path}`;
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...headers },
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  if (!r.ok && r.status < 400) return { ok: false, output: `HTTP ${r.status}` };
  if (r.status === 204 || r.status === 200 && !r.headers.get("content-type")?.includes("json")) {
    return { ok: true, output: await r.text().catch(() => "") };
  }
  const text = await r.text().catch(() => "");
  if (!r.ok) return { ok: false, output: `HTTP ${r.status}: ${text.slice(0, 200)}` };
  return { ok: true, output: text };
}

function parseValue(v) {
  const t = String(v).trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  try { return JSON.parse(t); } catch { return String(v); }
}

function upsertFrontmatter(md, key, value) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object" && !isArr;
  const ser = isArr ? value.map((x) => `  - ${x}`).join("\n") : isObj ? JSON.stringify(value) : String(value);
  const line = isArr || isObj ? `${key}:\n${ser}` : `${key}: ${ser}`;
  if (!m) return `---\n${line}\n---\n\n${md}`;
  const re = new RegExp(`(^|\\n)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(?:\\n(?:\\s+.*)*)?`);
  const newFm = re.test(m[1]) ? m[1].replace(re, `$1${line}`) : m[1] + "\n" + line;
  return `---\n${newFm}\n---\n${md.slice(m[0].length)}`;
}

const tools = {
  async read_file(a) {
    const out = await req("GET", `vault/${enc(a.path)}`);
    return out.ok ? { ok: true, output: out.output.slice(0, 8000) } : out;
  },
  async search_vault(a) {
    const r = await req("POST", "search/simple/", {}, { "content-type": "application/json", "x-query": "" });
    // simple search uses query in body; use JSON body
    const r2 = await req("POST", "search/simple/", { query: a.query }, { "content-type": "application/json" });
    return r2.ok
      ? { ok: true, output: (JSON.parse(r2.output).results ?? []).map((x) => `- ${x.path}`).join("\n") || "no matches" }
      : r2;
  },
  async list_folder(a) {
    const p = a.path ? `vault/${enc(a.path)}` : "vault/";
    const r = await req("GET", p);
    try {
      const files = JSON.parse(r.output).files ?? [];
      return { ok: true, output: files.join("\n") };
    } catch {
      return r;
    }
  },
  async create_note(a) {
    if ((await req("GET", `vault/${enc(a.path)}`)).ok) return { ok: false, output: `already exists: ${a.path}` };
    return req("PUT", `vault/${enc(a.path)}`, a.content ?? "", { "content-type": "text/markdown" });
  },
  async edit_note(a) {
    if (a.content !== undefined) {
      return req("PUT", `vault/${enc(a.path)}`, a.content, { "content-type": "text/markdown" });
    }
    const cur = (await req("GET", `vault/${enc(a.path)}`)).output;
    if (!cur.includes(a.old_string)) return { ok: false, output: `old_string not found in ${a.path}` };
    return req("PUT", `vault/${enc(a.path)}`, cur.replace(a.old_string, a.new_string ?? ""), { "content-type": "text/markdown" });
  },
  async rename_move_file(a) {
    // REST lacks a move endpoint; create-new + delete-old (link update not guaranteed).
    const content = await req("GET", `vault/${enc(a.old_path)}`);
    if (!content.ok) return content;
    const created = await req("PUT", `vault/${enc(a.new_path)}`, content.output, { "content-type": "text/markdown" });
    if (!created.ok) return created;
    await req("DELETE", `vault/${enc(a.old_path)}`);
    return { ok: true, output: `moved ${a.old_path} → ${a.new_path}` };
  },
  async create_folder(a) {
    // Create a placeholder to establish the dir, then delete it.
    const probe = `vault/${enc(a.path + "/.keep")}`;
    const r = await req("PUT", probe, "", { "content-type": "text/plain" });
    if (r.ok) await req("DELETE", probe).catch(() => {});
    return r.ok ? { ok: true, output: `created folder ${a.path}` } : r;
  },
  async set_property(a) {
    const cur = (await req("GET", `vault/${enc(a.path)}`)).output;
    const next = upsertFrontmatter(cur, a.key, parseValue(a.value));
    return req("PUT", `vault/${enc(a.path)}`, next, { "content-type": "text/markdown" });
  },
  async manage_tags(a) {
    const cur = (await req("GET", `vault/${enc(a.path)}`)).output;
    const tags = (a.tags ?? []).map((t) => (String(t).startsWith("#") ? t.slice(1) : t));
    const next = upsertFrontmatter(cur, "tags", tags);
    return req("PUT", `vault/${enc(a.path)}`, next, { "content-type": "text/markdown" });
  },
  async delete_file(a) {
    return req("DELETE", `vault/${enc(a.path)}`);
  },
};

export async function executeLraTool(name, args, config = {}) {
  if (config.baseUrl) BASE.replace; // config not plumbed per-call; use env
  const fn = tools[name];
  if (!fn) return { ok: false, output: `unknown tool: ${name}` };
  try {
    return await fn(args ?? {});
  } catch (err) {
    return { ok: false, output: `${name} failed: ${String(err.message ?? err)}` };
  }
}

// CLI: execute a single tool, print JSON.
if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const res = await executeLraTool(name, args);
  process.stdout.write(JSON.stringify(res, null, 2) + "\n");
}

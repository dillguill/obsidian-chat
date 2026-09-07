/** In-memory vault index feeding the retrieval cascade.
 *  Built lazily on first query (reads all markdown files once), cached, and
 *  refreshed on note create/modify/delete. For a 4k-note personal vault the
 *  G6 spike showed a single BM25 pass is sub-second; indexing is the cost, so
 *  we cache and invalidate on vault events. */
import { App, TFile, TFolder, TAbstractFile } from "obsidian";
import { retrieveCascade, type RetrievalDoc } from "./cascade";

export class VaultIndex {
  private docs: RetrievalDoc[] = [];
  private built = false;
  private building = false;
  private dirty = false;

  constructor(private app: App, private getIgnorePrefix?: () => string, private getBlacklist?: () => string[]) {
    // Mark stale on any vault change EXCEPT our own chat-session folder, so
    // saving a session doesn't force a full re-index on the next query.
    const handler = (file: TAbstractFile) => {
      const prefix = (this.getIgnorePrefix?.() ?? "").trim().replace(/^\/+|\/+$/g, "");
      if (prefix && (file.path === prefix || file.path.startsWith(prefix + "/"))) return;
      this.dirty = true;
    };
    this.app.vault.on("create", handler);
    this.app.vault.on("modify", handler);
    this.app.vault.on("delete", handler);
    this.app.vault.on("rename", handler);
  }

  /** Whether a path is under a blacklisted folder (agent must not touch it). */
  private isExcluded(path: string): boolean {
    const bl = this.getBlacklist?.() ?? [];
    return bl.some((p) => path === p || path.startsWith(p + "/"));
  }

  get isEmpty(): boolean {
    return !this.built && this.docs.length === 0;
  }

  /** Ensure the index is loaded (reads vault once, then cached until a real change). */
  async ensureLoaded(onLoading?: () => void): Promise<void> {
    if (this.built && !this.dirty) return;
    if (this.building) {
      // If another build is running, just wait for it to finish by polling.
      while (this.building) await new Promise((r) => setTimeout(r, 100));
      return;
    }
    this.building = true;
    onLoading?.();
    try {
      const files = this.app.vault.getMarkdownFiles();
      if (files.length > 6_000) {
        // Heuristic cap to avoid pathological memory on very large vaults.
        files.sort((a, b) => b.stat.size - a.stat.size);
      }
      const docs: RetrievalDoc[] = [];
      for (const f of files) {
        const text = await this.app.vault.cachedRead(f);
        docs.push({ rel: f.path, text });
      }
      this.docs = docs;
      this.built = true;
      this.dirty = false;
    } finally {
      this.building = false;
    }
  }

  getAll(): RetrievalDoc[] {
    return this.docs.filter((d) => !this.isExcluded(d.rel));
  }

  /** Read a single note (for read_file tool). */
  async read(path: string): Promise<string> {
    if (this.isExcluded(path)) throw new Error(`blocked by blacklist: ${path}`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return this.app.vault.cachedRead(f);
    throw new Error(`not found: ${path}`);
  }

  async exists(path: string): Promise<boolean> {
    return !this.isExcluded(path) && !!this.app.vault.getAbstractFileByPath(path);
  }

  /** List folder contents (for list_folder tool). */
  async listFolder(path: string, recursive: boolean): Promise<string[]> {
    const dir = this.app.vault.getAbstractFileByPath(path || "/");
    if (!dir) return [];
    const out: string[] = [];
    const walk = (d: any) => {
      for (const child of d.children ?? []) {
        if (this.isExcluded(child.path)) continue;
        if (child instanceof TFile) out.push(child.path);
        else if (recursive) walk(child);
      }
    };
    walk(dir);
    return out.sort();
  }

  /** Relevance-ranked search across cached docs (for search_vault tool). */
  search(query: string): string {
    const docs = this.docs.filter((d) => !this.isExcluded(d.rel));
    const results = retrieveCascade(query, docs, { topK: 10, useGraph: false });
    if (!results.length) return "no matches";
    return results.map((r) => `- ${r.rel.replace(/\.md$/, "")} :: ${r.snippet}`).join("\n");
  }

  // ---- Phase 2a write ops (local executor) ----

  async createNote(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }

  async editNote(path: string, content: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`not a note: ${path}`);
    await this.app.vault.modify(f, content);
  }

  /** Link-aware rename/move via Obsidian's FileManager. */
  async renameMove(oldPath: string, newPath: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(oldPath);
    if (!(f instanceof TFile)) throw new Error(`not a note: ${oldPath}`);
    await this.app.fileManager.renameFile(f, newPath);
  }

  async createFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) return;
    await this.app.vault.createFolder(path);
  }

  /** Set a frontmatter property by rewriting the YAML block. */
  async setProperty(path: string, key: string, value: string): Promise<void> {
    const content = await this.read(path);
    const next = upsertFrontmatter(content, key, parseValue(value));
    await this.editNote(path, next);
  }

  /** Replace the `tags` frontmatter property. */
  async manageTags(path: string, tags: string[]): Promise<void> {
    const content = await this.read(path);
    const tagList = tags.map((t) => (t.startsWith("#") ? t.slice(1) : t));
    const next = upsertFrontmatter(content, "tags", tagList);
    await this.editNote(path, next);
  }

  async deleteFile(path: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`not a note: ${path}`);
    await this.app.vault.trash(f, false);
  }
}

/** Parse a frontmatter value: "true"/"false" → bool, "123" → number, else string. */
function parseValue(v: string): unknown {
  const t = String(v).trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  try {
    const j = JSON.parse(t);
    return j;
  } catch {
    return String(v);
  }
}

/** Insert/update a key in the YAML frontmatter block, preserving the rest. */
function upsertFrontmatter(md: string, key: string, value: unknown): string {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object" && !isArr;
  const ser = (v: unknown): string => (isObj ? JSON.stringify(v) : isArr ? (v as unknown[]).map((x) => `  - ${String(x)}`).join("\n") : String(v));
  const line = isArr || isObj ? `${key}:\n${ser(value)}` : `${key}: ${ser(value)}`;

  if (!m) {
    // no frontmatter; add one
    return `---\n${line}\n---\n\n${md}`;
  }
  const fmBlock = m[1];
  // replace an existing key region or append
  const re = new RegExp(`(^|\\n)${escapeRegExp(key)}:\\s*(?:\\n(?:\\s+.*)*)?`);
  let newFm: string;
  if (re.test(fmBlock)) {
    newFm = fmBlock.replace(re, `$1${line}`);
  } else {
    newFm = fmBlock + "\n" + line;
  }
  return `---\n${newFm}\n---\n${md.slice(m[0].length)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

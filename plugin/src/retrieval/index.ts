/** In-memory vault index used to resolve `@`-mentioned notes for an ACP
 *  prompt's grounding context. Built lazily on first query (reads all
 *  markdown files once), cached, and invalidated on vault events. Read-only
 *  — vault writes go through the harness's MCP tools now, not this class. */
import { App, TFile, TAbstractFile } from "obsidian";

export interface RetrievalDoc {
  rel: string;
  text: string;
}

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
    // Normalize both sides: blacklist entries are stored with a trailing "/"
    // ("Private/") but the checked path may be the folder itself ("Private")
    // or a file beneath it ("Private/note.md").
    const normPath = path.replace(/\/+$/, "");
    return bl.some((p) => {
      const norm = p.replace(/\/+$/, "");
      return normPath === norm || normPath.startsWith(norm + "/");
    });
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

  /** Read a single note (for `@mention` context). */
  async read(path: string): Promise<string> {
    if (this.isExcluded(path)) throw new Error(`blocked by blacklist: ${path}`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return this.app.vault.cachedRead(f);
    throw new Error(`not found: ${path}`);
  }
}

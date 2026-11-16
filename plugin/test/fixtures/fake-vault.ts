/** In-memory VaultQuerySurface for MCP/fs tests (T008). */
import type { FolderEntry, ReadOptions, VaultQuerySurface } from "../../src/vault/service.ts";
import type { BacklinkHit, HeadingHit, LinkHit, NoteMetadata, TagCount } from "../../src/vault/metadata.ts";
import type { SearchHit } from "../../src/vault/search.ts";

export interface FakeNote {
  content: string;
  tags?: string[];
  links?: string[];
  headings?: { level: number; heading: string; line: number }[];
}

export class FakeVault implements VaultQuerySurface {
  notes = new Map<string, FakeNote>();
  private blacklist: string[];

  constructor(notes: Record<string, FakeNote> = {}, blacklist: string[] = ["Private"]) {
    this.blacklist = blacklist;
    for (const [path, note] of Object.entries(notes)) this.notes.set(path, note);
  }

  private allowed(path: string): boolean {
    const p = path.replace(/^\/+/, "");
    if (p.startsWith(".obsidian/") || p.startsWith(".trash/") || p.startsWith(".chat/sessions/")) return false;
    return !this.blacklist.some((b) => p === b || p.startsWith(`${b}/`));
  }

  async readText(relPath: string, _options: ReadOptions = {}): Promise<string> {
    if (!this.allowed(relPath)) throw new Error("path refused (blacklisted)");
    const note = this.notes.get(relPath);
    if (!note) throw new Error(`not found: ${relPath}`);
    return note.content;
  }

  listFolder(relPath: string): FolderEntry[] {
    const prefix = relPath.replace(/^\/+|\/+$/g, "");
    const base = prefix ? `${prefix}/` : "";
    const seen = new Map<string, FolderEntry>();
    for (const [path, note] of this.notes) {
      if (!path.startsWith(base) || !this.allowed(path)) continue;
      const rest = path.slice(base.length);
      const slash = rest.indexOf("/");
      if (slash === -1) seen.set(path, { path, type: "file", size: note.content.length });
      else seen.set(base + rest.slice(0, slash), { path: base + rest.slice(0, slash), type: "folder" });
    }
    if (prefix && !seen.size) throw new Error(`not a folder: ${prefix}`);
    return [...seen.values()];
  }

  async writeText(relPath: string, content: string): Promise<void> {
    if (!this.allowed(relPath)) throw new Error("path refused (blacklisted)");
    this.notes.set(relPath, { ...(this.notes.get(relPath) ?? {}), content });
  }

  async searchNotes(query: string, limit = 10, folder?: string, tags?: string[]): Promise<SearchHit[]> {
    const q = query.toLowerCase();
    const want = (tags ?? []).map((t) => (t.startsWith("#") ? t : `#${t}`).toLowerCase());
    return [...this.notes.entries()]
      .filter(([path, note]) => this.allowed(path) && (note.content.toLowerCase().includes(q) || path.toLowerCase().includes(q)))
      .filter(([path]) => !folder || path === folder || path.startsWith(`${folder}/`))
      .filter(([, note]) => !want.length || want.every((tag) => (note.tags ?? []).some((t) => t.toLowerCase() === tag)))
      .slice(0, limit)
      .map(([path, note]) => ({ path, title: path.replace(/\.md$/, ""), score: 1, snippet: note.content.slice(0, 200) }));
  }

  backlinks(relPath: string, limit = 20): BacklinkHit[] {
    return [...this.notes.entries()]
      .filter(([path, note]) => path !== relPath && this.allowed(path) && note.links?.includes(relPath))
      .slice(0, limit)
      .map(([path]) => ({ path, title: path.replace(/\.md$/, ""), count: 1 }));
  }

  links(relPath: string): LinkHit[] {
    const note = this.notes.get(relPath);
    return (note?.links ?? []).map((target) => ({ path: target, title: target.replace(/\.md$/, ""), resolved: this.notes.has(target) }));
  }

  tags(limit = 200, prefix?: string): TagCount[] {
    const counts = new Map<string, number>();
    for (const [path, note] of this.notes) {
      if (!this.allowed(path)) continue;
      for (const tag of note.tags ?? []) {
        if (prefix && !tag.toLowerCase().startsWith(prefix.toLowerCase())) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).slice(0, limit);
  }

  outline(relPath: string): HeadingHit[] {
    return this.notes.get(relPath)?.headings ?? [];
  }

  metadata(relPath: string): NoteMetadata | null {
    const note = this.notes.get(relPath);
    if (!note || !this.allowed(relPath)) return null;
    return {
      path: relPath,
      title: relPath.replace(/\.md$/, ""),
      size: note.content.length,
      mtime: 0,
      tags: note.tags ?? [],
      frontmatter: {},
      links: note.links?.length ?? 0,
      backlinks: this.backlinks(relPath, 1000).length,
    };
  }
}

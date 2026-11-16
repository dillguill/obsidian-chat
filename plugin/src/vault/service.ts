/** The single in-process implementation of vault semantics (FR-018…FR-024).
 *
 *  ACP filesystem handlers, the MCP vault tools, and the shell's mention index
 *  all call this service. It uses Obsidian's Vault API only — never direct disk
 *  I/O — and enforces one path policy/blacklist.
 */
import { App, FileSystemAdapter, MarkdownView, TFile, TFolder, normalizePath, type EventRef } from "obsidian";
import { evaluateAcpPath, evaluateRelativePath, isBlacklisted, normalizeRelative, type PathPolicyConfig } from "./path-policy.ts";
import {
  aggregateTags,
  deriveBacklinks,
  deriveOutgoingLinks,
  noteMetadata,
  outlineOf,
  titleOf,
  type BacklinkHit,
  type HeadingHit,
  type LinkHit,
  type NoteMetadata,
  type TagCount,
} from "./metadata.ts";
import { SearchIndex, type SearchDoc, type SearchHit } from "./search.ts";

export interface VaultServiceOptions {
  app: App;
  blacklist: () => string[];
  /** Vault-relative session-store folder, protected from harness access. */
  storeFolder?: () => string;
  /** Absolute harness root when it differs from the vault root (remote mapping). */
  harnessRoot?: () => string | null;
}

/** The read-only surface the MCP vault tools depend on; `VaultService` and the
 *  test fake both implement it, so the tools are testable without Obsidian. */
export interface VaultQuerySurface {
  searchNotes(query: string, limit?: number, folder?: string, tags?: string[]): Promise<SearchHit[]>;
  backlinks(relPath: string, limit?: number): BacklinkHit[];
  links(relPath: string): LinkHit[];
  tags(limit?: number, prefix?: string): TagCount[];
  outline(relPath: string): HeadingHit[];
  metadata(relPath: string): NoteMetadata | null;
  readText(relPath: string, options?: ReadOptions): Promise<string>;
  /** Direct children of a vault folder ("" = root), policy-filtered. */
  listFolder(relPath: string): FolderEntry[];
}

export interface FolderEntry {
  path: string;
  type: "file" | "folder";
  size?: number;
}

export interface ReadOptions {
  line?: number;
  limit?: number;
}

export class VaultService {
  private app: App;
  private getBlacklist: () => string[];
  private getStoreFolder: () => string;
  private getHarnessRoot: () => string | null;
  private index = new SearchIndex();
  private docsDirty = true;
  private disposers: EventRef[] = [];

  constructor(options: VaultServiceOptions) {
    this.app = options.app;
    this.getBlacklist = options.blacklist;
    this.getStoreFolder = options.storeFolder ?? (() => ".chat/sessions");
    this.getHarnessRoot = options.harnessRoot ?? (() => null);
    const invalidate = () => {
      this.docsDirty = true;
      this.index.invalidate();
    };
    this.disposers.push(
      this.app.vault.on("create", invalidate),
      this.app.vault.on("modify", invalidate),
      this.app.vault.on("delete", invalidate),
      this.app.vault.on("rename", invalidate),
    );
  }

  dispose(): void {
    for (const ref of this.disposers) this.app.vault.offref(ref);
    this.disposers = [];
  }

  get vaultRoot(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  }

  policy(): PathPolicyConfig {
    const root = this.vaultRoot;
    return {
      vaultRoot: root,
      harnessRoot: this.getHarnessRoot() ?? root,
      blacklist: this.getBlacklist(),
      protectedPrefixes: [this.getStoreFolder()],
    };
  }

  /** Vault-relative path for an absolute harness path, or null when refused. */
  relFromHarness(path: string): string | null {
    const v = evaluateAcpPath(path, this.policy());
    return v.allowed ? v.relPath : null;
  }

  fileFor(relPath: string): TFile | null {
    const rel = normalizeRelative(relPath);
    if (rel === null) return null;
    const f = this.app.vault.getAbstractFileByPath(normalizePath(rel));
    return f instanceof TFile ? f : null;
  }

  async readText(relPath: string, options: ReadOptions = {}): Promise<string> {
    const config = this.policy();
    const verdict = evaluateRelativePath(relPath, config);
    if (!verdict.allowed) throw new Error(`path refused (${verdict.reason}): ${verdict.detail}`);
    const file = this.fileFor(verdict.relPath);
    if (!file) throw new Error(`not found: ${verdict.relPath}`);
    const editorText = this.openEditorText(verdict.relPath);
    const text = editorText ?? (await this.app.vault.cachedRead(file));
    if (options.line === undefined) return text;
    const lines = text.split("\n");
    const start = Math.max(0, Math.floor(options.line) - 1);
    const count = options.limit === undefined ? lines.length - start : Math.max(0, Math.floor(options.limit));
    return lines.slice(start, start + count).join("\n");
  }

  private openEditorText(relPath: string): string | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === relPath) return view.editor.getValue();
    }
    return null;
  }

  async writeText(relPath: string, content: string): Promise<void> {
    const config = this.policy();
    const verdict = evaluateRelativePath(relPath, config);
    if (!verdict.allowed) throw new Error(`path refused (${verdict.reason}): ${verdict.detail}`);
    await this.ensureParents(verdict.relPath);
    const existing = this.fileFor(verdict.relPath);
    if (existing) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(normalizePath(verdict.relPath), content);
    this.refreshEditors(verdict.relPath);
    this.docsDirty = true;
  }

  listFolder(relPath: string): FolderEntry[] {
    const config = this.policy();
    const rel = relPath.replace(/^\/+|\/+$/g, "");
    const folder = rel ? this.app.vault.getAbstractFileByPath(normalizePath(rel)) : this.app.vault.getRoot();
    if (!(folder instanceof TFolder)) throw new Error(`not a folder: ${rel || "/"}`);
    const out: FolderEntry[] = [];
    for (const child of folder.children) {
      if (!evaluateRelativePath(child.path, config).allowed) continue;
      if (child instanceof TFolder) out.push({ path: child.path, type: "folder" });
      else if (child instanceof TFile) out.push({ path: child.path, type: "file", size: child.stat.size });
    }
    return out.sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "folder" ? -1 : 1));
  }

  /** Removes a note (used only by the host-side Undo of a harness-created file). */
  async deleteText(relPath: string): Promise<void> {
    const verdict = evaluateRelativePath(relPath, this.policy());
    if (!verdict.allowed) throw new Error(`path refused (${verdict.reason}): ${verdict.detail}`);
    const file = this.fileFor(verdict.relPath);
    if (!file) return;
    await this.app.vault.delete(file);
    this.docsDirty = true;
  }

  private async ensureParents(relPath: string): Promise<void> {
    const parts = relPath.split("/").slice(0, -1);
    let built = "";
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(built);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`parent is a file: ${built}`);
      await this.app.vault.createFolder(built);
    }
  }

  private refreshEditors(relPath: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== relPath) continue;
      try {
        if (view.getMode() === "preview") view.previewMode.rerender(true);
        else view.editor.refresh();
      } catch {
        // An editor mid-teardown can reject a refresh; the file is already written.
      }
    }
  }

  /** Scored search over the vault's Markdown corpus (shared with @mention). */
  async searchNotes(query: string, limit = 10, folder?: string, tags?: string[]): Promise<SearchHit[]> {
    await this.ensureDocs();
    const hits = this.index.search(query, Math.max(limit * 3, limit));
    return hits
      .filter((hit) => !folder || hit.path === folder || hit.path.startsWith(`${folder.replace(/\/+$/, "")}/`))
      .filter((hit) => !tags?.length || this.docHasTags(hit.path, tags))
      .slice(0, limit);
  }

  private docHasTags(relPath: string, want: string[]): boolean {
    const file = this.fileFor(relPath);
    if (!file) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    const have = new Set((cache?.tags ?? []).map((t) => t.tag.toLowerCase()));
    return want.every((t) => have.has(t.startsWith("#") ? t.toLowerCase() : `#${t.toLowerCase()}`));
  }

  /** Rebuilds the corpus on first use and after any vault change. */
  private async ensureDocs(): Promise<void> {
    if (!this.docsDirty) return;
    const docs: SearchDoc[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (isBlacklisted(file.path, this.getBlacklist())) continue;
      try {
        const text = await this.app.vault.cachedRead(file);
        docs.push({ path: file.path, title: titleOf(this.app, file), text: text.slice(0, 200_000) });
      } catch {
        // Skip unreadable files.
      }
    }
    this.index.setDocs(docs);
    this.docsDirty = false;
  }

  backlinks(relPath: string, limit = 20): BacklinkHit[] {
    return deriveBacklinks(this.app, relPath, this.getBlacklist(), limit);
  }

  links(relPath: string): LinkHit[] {
    const file = this.fileFor(relPath);
    return file ? deriveOutgoingLinks(this.app, file, this.getBlacklist()) : [];
  }

  tags(limit = 200, prefix?: string): TagCount[] {
    return aggregateTags(this.app, this.getBlacklist(), limit, prefix);
  }

  outline(relPath: string): HeadingHit[] {
    const file = this.fileFor(relPath);
    return file ? outlineOf(this.app, file) : [];
  }

  metadata(relPath: string): NoteMetadata | null {
    const file = this.fileFor(relPath);
    return file ? noteMetadata(this.app, file, this.getBlacklist()) : null;
  }
}

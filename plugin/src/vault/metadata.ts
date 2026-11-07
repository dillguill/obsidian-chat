/** Native Obsidian metadata queries for the shared VaultService (FR-027).
 *
 *  Obsidian 1.13 has no public `getBacklinksForFile` and no vault full-text
 *  search API, so backlinks are derived by inverting `resolvedLinks` and search
 *  is handled by `vault/search.ts`. All results exclude blacklisted paths.
 */
import { type App, type CachedMetadata, type TFile } from "obsidian";
import { isBlacklisted } from "./path-policy.ts";

export interface BacklinkHit {
  path: string;
  title: string;
  count: number;
}

export interface LinkHit {
  path: string;
  title: string;
  resolved: boolean;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface HeadingHit {
  level: number;
  heading: string;
  line: number;
}

export interface NoteMetadata {
  path: string;
  title: string;
  size: number;
  mtime: number;
  tags: string[];
  frontmatter: Record<string, unknown>;
  links: number;
  backlinks: number;
}

export function titleOf(app: App, file: TFile): string {
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  const title = fm && typeof fm.title === "string" ? fm.title : undefined;
  return title || file.basename;
}

export function deriveBacklinks(app: App, relPath: string, blacklist: readonly string[], limit = 20): BacklinkHit[] {
  const resolved = app.metadataCache.resolvedLinks ?? {};
  const hits: BacklinkHit[] = [];
  const target = relPath;
  for (const [source, dests] of Object.entries(resolved)) {
    if (source === target) continue;
    if (isBlacklisted(source, blacklist)) continue;
    const count = (dests as Record<string, number>)?.[target] ?? 0;
    if (!count) continue;
    const file = app.vault.getAbstractFileByPath(source);
    const title = file instanceof Object && "basename" in file ? (file as TFile).basename : source.replace(/\.md$/, "");
    hits.push({ path: source, title, count });
  }
  return hits.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)).slice(0, limit);
}

export function deriveOutgoingLinks(app: App, file: TFile, blacklist: readonly string[]): LinkHit[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];
  const out: LinkHit[] = [];
  const seen = new Set<string>();
  const push = (linkpath: string, resolved: string | null) => {
    const rel = resolved ?? (linkpath.endsWith(".md") ? linkpath : `${linkpath}.md`);
    if (seen.has(rel) || isBlacklisted(rel, blacklist)) return;
    seen.add(rel);
    const target = resolved ? app.vault.getAbstractFileByPath(resolved) : null;
    out.push({ path: rel, title: target instanceof Object && "basename" in target ? (target as TFile).basename : rel.replace(/\.md$/, ""), resolved: !!resolved });
  };
  for (const link of [...(cache.links ?? []), ...(cache.frontmatterLinks ?? [])]) {
    const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
    push(dest?.path ?? link.link, dest?.path ?? null);
  }
  return out.slice(0, 500);
}

export function aggregateTags(app: App, blacklist: readonly string[], limit = 200, prefix?: string): TagCount[] {
  const counts = new Map<string, number>();
  for (const file of app.vault.getMarkdownFiles()) {
    if (isBlacklisted(file.path, blacklist)) continue;
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) continue;
    for (const tag of allTagsOf(cache)) {
      if (prefix && !tag.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

export function allTagsOf(cache: CachedMetadata): string[] {
  const tags = new Set<string>();
  for (const t of cache.tags ?? []) tags.add(t.tag);
  const fm = cache.frontmatter as Record<string, unknown> | undefined;
  const raw = fm?.tags ?? fm?.tag;
  if (typeof raw === "string") for (const t of raw.split(/[,\s]+/)) if (t) tags.add(t.startsWith("#") ? t : `#${t}`);
  if (Array.isArray(raw)) for (const t of raw) if (typeof t === "string" && t) tags.add(t.startsWith("#") ? t : `#${t}`);
  return [...tags];
}

export function outlineOf(app: App, file: TFile): HeadingHit[] {
  const cache = app.metadataCache.getFileCache(file);
  return (cache?.headings ?? []).map((h) => ({ level: h.level, heading: h.heading, line: h.position.start.line + 1 }));
}

export function noteMetadata(app: App, file: TFile, blacklist: readonly string[]): NoteMetadata {
  const cache = app.metadataCache.getFileCache(file);
  const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
  return {
    path: file.path,
    title: titleOf(app, file),
    size: file.stat.size,
    mtime: file.stat.mtime,
    tags: cache ? allTagsOf(cache) : [],
    frontmatter: fm,
    links: (cache?.links?.length ?? 0) + (cache?.frontmatterLinks?.length ?? 0),
    backlinks: deriveBacklinks(app, file.path, blacklist, 1_000).length,
  };
}

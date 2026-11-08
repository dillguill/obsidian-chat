/** In-memory StoreAdapter for session-store tests (T010/T022). */
import type { StoreAdapter } from "./store.ts";

export class MemoryAdapter implements StoreAdapter {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }
  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT: ${path}`);
    return v;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.includes("/")) folders.add(rest.split("/")[0]);
      else files.push(rest);
    }
    return { files, folders: [...folders] };
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

/** Appends a crashed partial line (no trailing newline) after the complete lines. */
export function makePartialTail(adapter: MemoryAdapter, path: string): void {
  const text = adapter.files.get(path) ?? "";
  const base = text.endsWith("\n") || !text ? text : `${text}\n`;
  adapter.files.set(path, `${base}{"kind":"update","seq":99`);
}

/** Adapter whose `list` returns full vault-relative paths, matching Obsidian's
 *  real DataAdapter (regression for the History-empty bug). */
export class FullPathAdapter extends MemoryAdapter {
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const listing = await super.list(path);
    return {
      files: listing.files.map((name) => `${path}/${name}`),
      folders: listing.folders.map((name) => `${path}/${name}`),
    };
  }
}

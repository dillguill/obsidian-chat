/** Shared temp-store helpers for session tests (T010).
 *
 *  The in-memory adapter is the primary test double; this module also exposes
 *  a tiny real temp-directory adapter for integration tests that want bytes on
 *  disk (Node only, never bundled into the plugin).
 */
export { MemoryAdapter, makePartialTail } from "../../src/session/test-adapter.ts";

import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoreAdapter } from "../../src/session/store.ts";

/** Minimal real-disk adapter for Node tests (not used by the plugin runtime). */
export class TempDirAdapter implements StoreAdapter {
  readonly root: string;
  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "obsidian-chat-store-"));
  }
  private abs(path: string): string {
    return join(this.root, path);
  }
  async exists(path: string): Promise<boolean> {
    return existsSync(this.abs(path));
  }
  async mkdir(path: string): Promise<void> {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(this.abs(path), { recursive: true });
  }
  async read(path: string): Promise<string> {
    return readFileSync(this.abs(path), "utf8");
  }
  async write(path: string, data: string): Promise<void> {
    writeFileSync(this.abs(path), data);
  }
  async append(path: string, data: string): Promise<void> {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(this.abs(path), data);
  }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(this.abs(path), { withFileTypes: true });
    return {
      files: entries.filter((e) => e.isFile()).map((e) => e.name),
      folders: entries.filter((e) => e.isDirectory()).map((e) => e.name),
    };
  }
  async remove(path: string): Promise<void> {
    const { rmSync } = await import("node:fs");
    rmSync(this.abs(path), { force: true });
  }
}

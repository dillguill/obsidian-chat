/** Obsidian-backed implementation of the ACP filesystem environment.
 *
 *  All work goes through the shared VaultService and its path policy; this
 *  adapter only translates ACP's absolute harness paths to vault-relative ones,
 *  and remembers the pre-write snapshot for the Undo surface.
 */
import { evaluateAcpPath } from "../vault/path-policy.ts";
import type { VaultService } from "../vault/service.ts";
import type { ShellEnvironment } from "./types.ts";

export class ObsidianShellEnvironment implements ShellEnvironment {
  private service: VaultService;
  private snapshots = new Map<string, string | null>();

  constructor(service: VaultService) {
    this.service = service;
  }

  canServeVault(): boolean {
    return !!this.service.vaultRoot;
  }

  private relPath(harnessPath: string): string {
    const verdict = evaluateAcpPath(harnessPath, this.service.policy());
    if (!verdict.allowed) throw new Error(`path refused (${verdict.reason}): ${verdict.detail}`);
    return verdict.relPath;
  }

  async readTextFile(path: string, line?: number, limit?: number): Promise<string> {
    const rel = this.relPath(path);
    return this.service.readText(rel, { line, limit });
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const rel = this.relPath(path);
    await this.service.writeText(rel, content);
  }

  /** Captures the first pre-write content per path for host-side Undo. */
  async snapshotBeforeWrite(path: string): Promise<void> {
    const rel = this.relPath(path);
    if (this.snapshots.has(rel)) return;
    try {
      const existing = this.service.fileFor(rel);
      this.snapshots.set(rel, existing ? await this.service.readText(rel) : null);
    } catch (err) {
      this.snapshots.set(rel, null);
      throw err;
    }
  }

  async afterWrite(): Promise<void> {
    // VaultService already refreshes open editors/metadata on write.
  }

  snapshotFor(harnessPath: string): { existed: boolean; content: string } | null {
    let rel: string;
    try {
      rel = this.relPath(harnessPath);
    } catch {
      return null;
    }
    if (!this.snapshots.has(rel)) return null;
    const content = this.snapshots.get(rel);
    return content === null ? { existed: false, content: "" } : { existed: true, content: content ?? "" };
  }
}

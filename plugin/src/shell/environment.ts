/** Obsidian-backed implementation of the ACP filesystem environment.
 *
 *  All work goes through the shared VaultService and its path policy via
 *  `vault/acp-fs.ts`; this adapter only supplies the service and exposes the
 *  snapshot/undo surface to the runtime and UI.
 */
import { AcpFileEnvironment, type WriteSnapshot } from "../vault/acp-fs.ts";
import type { VaultService } from "../vault/service.ts";
import type { ShellEnvironment } from "./types.ts";

export class ObsidianShellEnvironment implements ShellEnvironment {
  private service: VaultService;
  private fs: AcpFileEnvironment;
  private onWrite?: () => void;

  constructor(service: VaultService, onWrite?: () => void) {
    this.service = service;
    this.fs = new AcpFileEnvironment(service);
    this.onWrite = onWrite;
  }

  canServeVault(): boolean {
    return !!this.service.vaultRoot;
  }

  async readTextFile(path: string, line?: number, limit?: number): Promise<string> {
    return this.fs.readTextFile(path, line, limit);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.fs.writeTextFile(path, content);
    this.onWrite?.();
  }

  /** Captures the first pre-write content per path for host-side Undo. */
  async snapshotBeforeWrite(path: string): Promise<void> {
    await this.fs.snapshotBeforeWrite(path);
  }

  async afterWrite(): Promise<void> {
    // VaultService already refreshes open editors/metadata on write.
  }

  snapshotFor(harnessPath: string): WriteSnapshot | null {
    return this.fs.snapshotFor(harnessPath);
  }

  lastSnapshot(): WriteSnapshot | null {
    return this.fs.lastSnapshot();
  }

  /** Restores the pre-write content of the last snapshotted note. */
  async undoLast(): Promise<WriteSnapshot | null> {
    const last = this.fs.lastSnapshot();
    if (!last) return null;
    return this.fs.undoRelative(last.relPath);
  }
}

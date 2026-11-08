/** ACP filesystem environment over the shared VaultService (FR-018…FR-022).
 *
 *  Obsidian-free on purpose: the target is the narrow slice of `VaultService`
 *  the handlers need, so the same code is exercised by the fake in tests. All
 *  path decisions go through `vault/path-policy.ts`; this module only maps the
 *  harness's absolute paths to vault-relative ones and keeps the pre-write
 *  snapshot the host-side Undo surface restores from.
 */
import { evaluateAcpPath, type PathPolicyConfig } from "./path-policy.ts";

/** The slice of `VaultService` the ACP fs handlers depend on. */
export interface AcpFsTarget {
  policy(): PathPolicyConfig;
  readText(relPath: string, options?: { line?: number; limit?: number }): Promise<string>;
  writeText(relPath: string, content: string): Promise<void>;
  /** Present-and-readable check used to decide create vs overwrite. */
  fileFor(relPath: string): { path: string } | null;
  /** Used by Undo when the write created a new note. */
  deleteText?(relPath: string): Promise<void>;
}

export interface WriteSnapshot {
  /** Vault-relative path the harness wrote. */
  relPath: string;
  /** Full pre-write text, or null when the note did not exist yet. */
  content: string | null;
}

export class AcpFileEnvironment {
  private target: AcpFsTarget;
  private snapshots = new Map<string, string | null>();

  constructor(target: AcpFsTarget) {
    this.target = target;
  }

  /** Maps an ACP absolute path to vault-relative, refusing anything the shared
   *  policy rejects. Never clamps or redirects. */
  relPath(harnessPath: string): string {
    const verdict = evaluateAcpPath(harnessPath, this.target.policy());
    if (!verdict.allowed) throw new Error(`path refused (${verdict.reason}): ${verdict.detail}`);
    return verdict.relPath;
  }

  async readTextFile(path: string, line?: number, limit?: number): Promise<string> {
    return this.target.readText(this.relPath(path), { line, limit });
  }

  /** Best-effort: a snapshot failure must not block the write (FR-021). When it
   *  fails the path is marked as unsnapshotted, so Undo refuses instead of
   *  restoring the wrong content. */
  async snapshotBeforeWrite(path: string): Promise<void> {
    const rel = this.relPath(path);
    if (this.snapshots.has(rel)) return;
    try {
      const existing = this.target.fileFor(rel);
      this.snapshots.set(rel, existing ? await this.target.readText(rel) : null);
    } catch {
      // Undo for this path stays unavailable; the write itself proceeds.
    }
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.target.writeText(this.relPath(path), content);
  }

  /** True when a pre-write snapshot exists for this path. */
  hasSnapshot(harnessPath: string): boolean {
    try {
      return this.snapshots.has(this.relPath(harnessPath));
    } catch {
      return false;
    }
  }

  /** The most recent unsnapshotted write is not undoable; callers use this to
   *  decide whether to show the Undo affordance at all. */
  snapshotFor(harnessPath: string): WriteSnapshot | null {
    let rel: string;
    try {
      rel = this.relPath(harnessPath);
    } catch {
      return null;
    }
    if (!this.snapshots.has(rel)) return null;
    return { relPath: rel, content: this.snapshots.get(rel) ?? null };
  }

  /** Last snapshot taken, for the UI's single "Undo last change" affordance. */
  lastSnapshot(): WriteSnapshot | null {
    const entries = [...this.snapshots.entries()];
    if (!entries.length) return null;
    const [rel, content] = entries[entries.length - 1];
    return { relPath: rel, content };
  }

  /** Restores the recorded pre-write content and consumes the snapshot. */
  async undo(harnessPath: string): Promise<WriteSnapshot> {
    const snapshot = this.snapshotFor(harnessPath);
    if (!snapshot) throw new Error("no snapshot is available for this path");
    return this.undoRelative(snapshot.relPath);
  }

  /** Restores the last snapshot taken, whatever path it belongs to. */
  async undoLast(): Promise<WriteSnapshot> {
    const last = this.lastSnapshot();
    if (!last) throw new Error("no snapshot is available");
    return this.undoRelative(last.relPath);
  }

  /** Undo by vault-relative path (the snapshot already carries one). */
  async undoRelative(relPath: string): Promise<WriteSnapshot> {
    if (!this.snapshots.has(relPath)) throw new Error("no snapshot is available for this path");
    const content = this.snapshots.get(relPath) ?? null;
    if (content === null) {
      if (!this.target.deleteText) throw new Error("this vault cannot remove a created note");
      await this.target.deleteText(relPath);
    } else {
      await this.target.writeText(relPath, content);
    }
    this.snapshots.delete(relPath);
    return { relPath, content };
  }
}

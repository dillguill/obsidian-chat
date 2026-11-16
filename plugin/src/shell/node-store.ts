/** Host-side conversation storage outside the vault (redesign item 5).
 *
 *  Desktop-only: records live in the OS app-data folder, one folder per vault,
 *  so appending to a growing JSONL never goes through the vault's sync
 *  (iCloud, Obsidian Sync…). Only the host reads or writes it; remote devices
 *  read history through the host.
 */
import type { StoreAdapter } from "../session/store.ts";
import { requireNodeModule } from "./node.ts";

type Fs = typeof import("node:fs/promises");
type Path = typeof import("node:path");
type Os = typeof import("node:os");
type Crypto = typeof import("node:crypto");

/** The app-data root for this OS: macOS `~/Library/Application Support`,
 *  Windows `%APPDATA%`, otherwise `$XDG_DATA_HOME` or `~/.local/share`. */
export function appDataRoot(env: { platform: string; home: string; appData?: string; xdgDataHome?: string }): string {
  if (env.platform === "darwin") return `${env.home}/Library/Application Support`;
  if (env.platform === "win32") return env.appData || `${env.home}/AppData/Roaming`;
  return env.xdgDataHome || `${env.home}/.local/share`;
}

/** A stable, readable folder name for one vault: its name plus a short hash of
 *  its absolute path, so two vaults with the same name never share records. */
export function vaultFolderName(vaultName: string, vaultPath: string, hash: (text: string) => string): string {
  const safe = vaultName.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 60) || "vault";
  return `${safe}-${hash(vaultPath).slice(0, 8)}`;
}

/** Absolute folder holding this vault's host data (records live in `sessions/`). */
export function hostDataDir(vaultName: string, vaultPath: string): string {
  const os = requireNodeModule<Os>("node:os") ?? requireNodeModule<Os>("os");
  const path = requireNodeModule<Path>("node:path") ?? requireNodeModule<Path>("path");
  const crypto = requireNodeModule<Crypto>("node:crypto") ?? requireNodeModule<Crypto>("crypto");
  if (!os || !path || !crypto) throw new Error("host storage needs the desktop app");
  const root = appDataRoot({
    platform: process.platform,
    home: os.homedir(),
    appData: process.env.APPDATA,
    xdgDataHome: process.env.XDG_DATA_HOME,
  });
  const name = vaultFolderName(vaultName, vaultPath, (text) => crypto.createHash("sha256").update(text).digest("hex"));
  return path.join(root, "obsidian-chat", "vaults", name);
}

/** StoreAdapter over Node's fs, with paths relative to `base`. */
export class NodeStoreAdapter implements StoreAdapter {
  readonly base: string;
  private fs: Fs;
  private path: Path;

  constructor(base: string) {
    const fs = requireNodeModule<Fs>("node:fs/promises") ?? requireNodeModule<Fs>("fs/promises");
    const path = requireNodeModule<Path>("node:path") ?? requireNodeModule<Path>("path");
    if (!fs || !path) throw new Error("host storage needs the desktop app");
    this.fs = fs;
    this.path = path;
    this.base = base;
  }

  private abs(rel: string): string {
    const resolved = this.path.resolve(this.base, rel);
    const root = this.path.resolve(this.base);
    if (resolved !== root && !resolved.startsWith(root + this.path.sep)) throw new Error(`path leaves the store: ${rel}`);
    return resolved;
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.fs.stat(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.fs.mkdir(this.abs(path), { recursive: true, mode: 0o700 });
  }

  async read(path: string): Promise<string> {
    return this.fs.readFile(this.abs(path), "utf8");
  }

  async write(path: string, data: string): Promise<void> {
    const target = this.abs(path);
    await this.fs.mkdir(this.path.dirname(target), { recursive: true, mode: 0o700 });
    // Write-then-rename so a crash never leaves a half-written file.
    const temp = `${target}.tmp-${process.pid}`;
    await this.fs.writeFile(temp, data, { encoding: "utf8", mode: 0o600 });
    await this.fs.rename(temp, target);
  }

  async append(path: string, data: string): Promise<void> {
    const target = this.abs(path);
    await this.fs.mkdir(this.path.dirname(target), { recursive: true, mode: 0o700 });
    await this.fs.appendFile(target, data, { encoding: "utf8", mode: 0o600 });
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const entries = await this.fs.readdir(this.abs(path), { withFileTypes: true });
    return {
      files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      folders: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    };
  }

  async remove(path: string): Promise<void> {
    await this.fs.rm(this.abs(path), { force: true });
  }
}

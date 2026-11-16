/** One-time move of conversation records out of the vault (redesign item 5).
 *
 *  Copies every record (and the resume registry) from the old in-vault folder
 *  to the host store, verifying each copy by reading it back. Idempotent: a
 *  record already present at the destination is never overwritten, and a
 *  marker file records what was copied. Originals are left in place until the
 *  user removes them, so nothing is lost if anything goes wrong.
 */
import type { StoreAdapter } from "./store.ts";

export const RELOCATION_MARKER = "relocated-from-vault.json";

export interface RelocationReport {
  copied: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
  /** True when the marker already existed (nothing was attempted). */
  alreadyDone: boolean;
}

function join(folder: string, name: string): string {
  return folder ? `${folder.replace(/\/+$/, "")}/${name}` : name;
}

export async function relocateRecords(options: {
  from: StoreAdapter;
  fromFolder: string;
  to: StoreAdapter;
  toFolder: string;
  now?: () => number;
}): Promise<RelocationReport> {
  const { from, fromFolder, to, toFolder } = options;
  const report: RelocationReport = { copied: [], skipped: [], failed: [], alreadyDone: false };
  const marker = join(toFolder, RELOCATION_MARKER);
  if (await to.exists(marker)) return { ...report, alreadyDone: true };
  if (!(await from.exists(fromFolder))) {
    await to.mkdir(toFolder);
    await to.write(marker, JSON.stringify({ v: 1, at: (options.now ?? Date.now)(), from: fromFolder, copied: [] }, null, 2));
    return report;
  }
  await to.mkdir(toFolder);
  const listing = await from.list(fromFolder);
  for (const raw of listing.files) {
    const name = raw.replace(/\\/g, "/").split("/").pop() ?? "";
    if (!name.endsWith(".jsonl") && name !== "registry.json") continue;
    try {
      const target = join(toFolder, name);
      if (await to.exists(target)) {
        report.skipped.push(name);
        continue;
      }
      const text = await from.read(join(fromFolder, name));
      await to.write(target, text);
      if ((await to.read(target)) !== text) throw new Error("copy did not verify");
      report.copied.push(name);
    } catch (err) {
      report.failed.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Only mark done when every record made it; a failed copy is retried next time.
  if (!report.failed.length) {
    await to.write(
      marker,
      JSON.stringify({ v: 1, at: (options.now ?? Date.now)(), from: fromFolder, copied: report.copied, skipped: report.skipped }, null, 2),
    );
  }
  return report;
}

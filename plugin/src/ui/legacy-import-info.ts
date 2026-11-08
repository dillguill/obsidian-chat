/** Legacy-import diagnostics: what the one-time Markdown→JSONL import scanned,
 *  what it imported, and why notes were skipped. This is the visible surface
 *  when History is unexpectedly empty. */
import { App, Modal, Setting } from "obsidian";

export interface LegacyImportDiagnostics {
  /** Markdown notes scanned vault-wide (there is no folder setting). */
  scannedMarkdown: number;
  storeFolder: string;
  /** Markdown notes considered as legacy conversations. */
  candidates: number;
  candidatesFromFrontmatter: number;
  /** Found by a content scan (diagnostics command only). */
  candidatesFromScan: number;
  readErrors: number;
  imported: number;
  alreadyImported: number;
  skipped: Array<{ path: string; reason: string }>;
  /** Records the session store can currently see (should match History). */
  storeCount: number;
  error?: string;
}

export class LegacyImportInfoModal extends Modal {
  constructor(
    app: App,
    private readonly info: LegacyImportDiagnostics | null,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Legacy conversation import" });
    if (!this.info) {
      contentEl.createEl("p", { text: "The import has not run yet. Use the command again after Obsidian finishes loading." });
      return;
    }
    const i = this.info;
    const rows: [string, string][] = [
      ["Discovery", "vault-wide by content (no folder setting)"],
      ["Markdown notes scanned", String(i.scannedMarkdown)],
      ["Session store folder", i.storeFolder],
      ["Old-conversation notes found", String(i.candidates)],
      ["  from frontmatter type: chat-session", String(i.candidatesFromFrontmatter)],
      ["  from deep content scan", String(i.candidatesFromScan)],
      ["Unreadable notes", String(i.readErrors)],
      ["Imported this run", String(i.imported)],
      ["Already imported", String(i.alreadyImported)],
      ["Skipped", String(i.skipped.length)],
      ["Conversations in store", String(i.storeCount)],
    ];
    if (i.error) rows.push(["Error", i.error]);
    const pre = contentEl.createEl("pre", { cls: "oc-conn-info" });
    pre.setText(rows.map(([key, value]) => `${key}: ${value}`).join("\n"));
    if (i.skipped.length) {
      contentEl.createEl("h4", { text: "Skipped notes" });
      const skipped = contentEl.createEl("pre", { cls: "oc-conn-info" });
      skipped.setText(i.skipped.map((entry) => `${entry.path} — ${entry.reason}`).join("\n"));
    }
    new Setting(contentEl).addButton((button) =>
      button.setButtonText("Copy").onClick(() => void navigator.clipboard.writeText(pre.getText())),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** In-vault image picker + binary→data URL helpers (vision attachments).
 *  Mobile-safe: uses Obsidian's Vault API (no Node/fs), which works on both
 *  desktop and the Capacitor webview. */

import { App, Modal, TFile } from "obsidian";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
export { IMAGE_EXT };

export interface VaultImageData {
  dataUrl: string;
  mediaType: string;
  name: string;
}

function mediaTypeFor(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/** Read a vault file as a base64 data URL. */
export async function vaultFileDataUrl(app: App, path: string): Promise<VaultImageData> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`not a file: ${path}`);
  const buf = await app.vault.readBinary(f);
  const mediaType = mediaTypeFor(f.extension);
  return { dataUrl: `data:${mediaType};base64,${arrayBufferToBase64(buf)}`, mediaType, name: f.basename };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Modal listing recent vault images; resolves with the chosen vault path. */
export class VaultImagePickModal extends Modal {
  constructor(app: App, private onPick: (path: string) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-image-picker");
    contentEl.createEl("h3", { text: "Pick an image from the vault" });

    const files = this.app.vault
      .getFiles()
      .filter((f) => IMAGE_EXT.has(f.extension))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 100);

    if (!files.length) {
      contentEl.createEl("p", { text: "No images found in the vault." });
      return;
    }

    const list = contentEl.createEl("div", { cls: "oc-image-list" });
    for (const f of files) {
      const row = list.createEl("button", { cls: "oc-image-row", attr: { type: "button", "aria-label": f.path } });
      row.createSpan({ cls: "oc-image-row-name", text: f.path });
      row.addEventListener("click", () => {
        this.onPick(f.path);
        this.close();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

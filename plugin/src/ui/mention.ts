/** Native note/attachment search for @-mentions (Obsidian's SuggestModal — the same
 *  component the Quick Switcher uses). Guaranteed to render with the app's own
 *  suggestion styling and keyboard handling, so @-mention isn't dependent on our
 *  custom dropdown. */

import { App, SuggestModal, setIcon } from "obsidian";

/** A vault note (inserted as [[wikilink]]) or an image attachment (vision pill). */
export interface MentionItem {
  path: string; // vault-relative path incl extension
  link: string; // text to insert inside [[...]] (notes only)
  kind: "note" | "image";
  /** modification time (used to order recent items first) */
  mtime?: number;
}

/** Pick a Lucide icon name for a file's type (empty for .md — no icon). */
function typeIcon(path: string): string {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "file-text";
  if (ext === "md") return "";
  return "file";
}

export class NoteMentionModal extends SuggestModal<MentionItem> {
  constructor(app: App, private items: MentionItem[], private onPick: (item: MentionItem) => void) {
    super(app);
    this.setPlaceholder("Search notes & attachments…");
  }

  getSuggestions(query: string): MentionItem[] {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? this.items.filter((it) => (it.kind === "image" ? it.path : it.link).toLowerCase().includes(q))
      : this.items;
    return filtered.slice(0, 60);
  }

  renderSuggestion(item: MentionItem, el: HTMLElement) {
    el.empty();
    // Folder/note name (the .md is hidden for notes) as the main line, plus a
    // filetype icon on the right for non-markdown files. Long names truncate.
    const display = item.kind === "image" ? item.path : item.link;
    el.createSpan({ cls: "oc-mention-label", text: display });
    const icon = typeIcon(item.path);
    if (icon) {
      const iconEl = el.createSpan({ cls: "oc-mention-type" });
      setIcon(iconEl, icon);
    }
  }

  onChooseSuggestion(item: MentionItem, evt: MouseEvent | KeyboardEvent) {
    this.onPick(item);
    this.close();
  }
}

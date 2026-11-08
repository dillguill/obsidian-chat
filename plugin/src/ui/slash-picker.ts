/** The `/` picker: vault skills and harness-declared commands, in Obsidian's
 *  native suggest modal. */
import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";

export interface SlashItem {
  kind: "skill" | "command";
  name: string;
  description?: string;
  /** Skill note path. */
  path?: string;
}

export class SlashPickerModal extends FuzzySuggestModal<SlashItem> {
  private chosen = false;

  constructor(
    app: App,
    private items: SlashItem[],
    private onPick: (item: SlashItem) => void,
    private onDismiss: () => void,
  ) {
    super(app);
    this.setPlaceholder(items.some((i) => i.kind === "skill") ? "Attach a skill or run a command…" : "Run a command…");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to choose" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  getItems(): SlashItem[] {
    return this.items;
  }

  getItemText(item: SlashItem): string {
    return `${item.name} ${item.description ?? ""}`;
  }

  renderSuggestion(match: FuzzyMatch<SlashItem>, el: HTMLElement): void {
    const item = match.item;
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: item.kind === "command" ? `/${item.name}` : item.name });
    if (item.description) content.createDiv({ cls: "suggestion-note", text: item.description });
    const aux = el.createDiv({ cls: "suggestion-aux" });
    aux.createSpan({ cls: "suggestion-flair", text: item.kind === "skill" ? "Skill" : "Command" });
  }

  onChooseItem(item: SlashItem): void {
    this.chosen = true;
    this.onPick(item);
  }

  onClose(): void {
    super.onClose();
    // FuzzySuggestModal closes before onChooseItem runs; defer the dismiss
    // check so a choice is not mistaken for a dismissal.
    window.setTimeout(() => {
      if (!this.chosen) this.onDismiss();
    }, 0);
  }
}

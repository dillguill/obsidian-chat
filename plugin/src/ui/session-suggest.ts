/** Session history picker — a native searchable dropdown (Obsidian's fuzzy
 *  suggest modal), matching the model picker's UX. Lists chat session notes
 *  from the settings-configured session folder, newest first. */
import { App, FuzzySuggestModal, TFile, type FuzzyMatch } from "obsidian";

export class SessionSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private items: TFile[],
    private onChoose: (item: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Search sessions…");
  }

  getItems(): TFile[] {
    return this.items;
  }

  getItemText(item: TFile): string {
    return item.basename;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }

  renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement): void {
    const value = item.item;
    el.empty();
    const body = el.createDiv({ cls: "oc-model-sugg" });
    const info = body.createDiv({ cls: "oc-model-sugg-info" });
    info.createDiv({ cls: "oc-model-sugg-name", text: value.basename });
    info.createDiv({ cls: "oc-model-sugg-provider", text: new Date(value.stat.mtime).toLocaleString() });
  }
}

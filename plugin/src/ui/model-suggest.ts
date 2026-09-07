/** Model picker — a native searchable dropdown (Obsidian's fuzzy suggest modal).
 *  Lists all available models (pinned first, then each provider's models) and
 *  lets you pin/unpin a model directly from the list. */
import { App, FuzzySuggestModal, setIcon, type FuzzyMatch } from "obsidian";
import type { ModelItem } from "../chat/models";

export class ModelSuggestModal extends FuzzySuggestModal<ModelItem> {
  constructor(
    app: App,
    private items: ModelItem[],
    private onChoose: (item: ModelItem) => void,
    private onTogglePin: (item: ModelItem) => boolean,
  ) {
    super(app);
    this.setPlaceholder("Search models…");
  }

  getItems(): ModelItem[] {
    return this.items;
  }

  getItemText(item: ModelItem): string {
    return `${item.model} — ${item.providerName}`;
  }

  onChooseItem(item: ModelItem): void {
    this.onChoose(item);
  }

  renderSuggestion(item: FuzzyMatch<ModelItem>, el: HTMLElement): void {
    const value = item.item;
    el.empty();
    const body = el.createDiv({ cls: "oc-model-sugg" });
    const info = body.createDiv({ cls: "oc-model-sugg-info" });
    info.createDiv({ cls: "oc-model-sugg-name", text: value.model });
    info.createDiv({ cls: "oc-model-sugg-provider", text: value.providerName });
    // Pinned = a pin with a cross (tap to unpin); unpinned = a plain pin (tap to pin).
    const pin = body.createDiv({ cls: "oc-model-sugg-pin" + (value.pinned ? " pinned" : "") });
    setIcon(pin, value.pinned ? "pin-off" : "pin");
    pin.setAttribute("aria-label", value.pinned ? "Unpin model" : "Pin model");
    pin.addEventListener("click", (ev) => {
      ev.stopPropagation();
      value.pinned = this.onTogglePin(value);
      pin.toggleClass("pinned", value.pinned);
      setIcon(pin, value.pinned ? "pin-off" : "pin");
      // Move pinned items to the top and re-render the suggestions.
      this.items.sort((a, b) => Number(b.pinned) - Number(a.pinned));
      this.inputEl.dispatchEvent(new Event("input"));
    });
  }
}

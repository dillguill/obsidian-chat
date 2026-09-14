/** Searchable picker for the harness-declared "model" SessionConfigOption
 *  (specs/002-acp-only-chat-ux, model-selection follow-up to User Story 3).
 *  A fuzzy-search modal rather than the plain `acp-picker-menu.ts` used for
 *  agent mode/thinking level, since a model list can be long — the same
 *  distinction the original BYOK model picker made. */
import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import type { SessionConfigSelectOption } from "@agentclientprotocol/sdk";

export class AcpModelSuggestModal extends FuzzySuggestModal<SessionConfigSelectOption> {
  constructor(
    app: App,
    private items: SessionConfigSelectOption[],
    private onChoose: (item: SessionConfigSelectOption) => void,
  ) {
    super(app);
    this.setPlaceholder("Search models…");
  }

  getItems(): SessionConfigSelectOption[] {
    return this.items;
  }

  getItemText(item: SessionConfigSelectOption): string {
    return item.name;
  }

  onChooseItem(item: SessionConfigSelectOption): void {
    this.onChoose(item);
  }

  renderSuggestion(match: FuzzyMatch<SessionConfigSelectOption>, el: HTMLElement): void {
    const item = match.item;
    el.empty();
    el.createDiv({ text: item.name });
    if (item.description) el.createDiv({ cls: "oc-model-sugg-provider", text: item.description });
  }
}

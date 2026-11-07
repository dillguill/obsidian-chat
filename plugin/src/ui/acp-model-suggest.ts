/** Searchable picker for the harness-declared "model" SessionConfigOption
 *  (specs/002-acp-only-chat-ux, model-selection follow-up to User Story 3).
 *  A fuzzy-search modal rather than the plain `acp-picker-menu.ts` used for
 *  agent mode/thinking level, since a model list can be long.
 *
 *  Three distinct actions live here, and the difference matters:
 *    - clicking a row applies the model to *this session* only;
 *    - the pin button keeps a model at the top of the list (presentation);
 *    - the target button makes a model the *default for new sessions*, and
 *      the first row returns to the harness's own default.
 *  Pins were the old BYOK picker's pattern; the separate default is what
 *  stops a one-off pick from sticking to every future conversation.
 */
import { App, FuzzySuggestModal, setIcon, type FuzzyMatch } from "obsidian";
import type { SessionConfigSelectOption } from "@agentclientprotocol/sdk";
import { orderModels } from "../chat/model-prefs";

/** The always-present escape hatch: no default, so the harness config wins. */
const HARNESS_DEFAULT = "\u0000harness-default";

export interface AcpModelPickerOptions {
  currentValue: string | undefined;
  pinned: readonly string[];
  defaultModel: string | null;
  /** Apply to this session (does not persist). */
  onChoose: (value: string) => void;
  /** Returns whether the model is pinned now. */
  onTogglePin: (value: string) => Promise<boolean>;
  /** `null` clears the default. */
  onSetDefault: (value: string | null) => Promise<void>;
}

interface ModelRow {
  value: string;
  name: string;
  description?: string;
  harnessDefault?: boolean;
}

export class AcpModelSuggestModal extends FuzzySuggestModal<ModelRow> {
  private rows: ModelRow[];
  private pinned: Set<string>;

  constructor(
    app: App,
    private items: SessionConfigSelectOption[],
    private opts: AcpModelPickerOptions,
  ) {
    super(app);
    this.setPlaceholder("Search models…");
    this.pinned = new Set(opts.pinned);
    this.rows = this.buildRows();
  }

  /** Pinned models first, then the harness's own order; the escape hatch is
   *  pinned to the very top so it stays reachable while searching. */
  private buildRows(): ModelRow[] {
    const models: ModelRow[] = orderModels(this.items, [...this.pinned]).map((item) => ({
      value: item.value,
      name: item.name,
      description: item.description ?? undefined,
    }));
    const harnessDefault: ModelRow = {
      value: HARNESS_DEFAULT,
      name: "Harness default",
      description: "No default model — new sessions use whatever the harness is configured with",
      harnessDefault: true,
    };
    return [harnessDefault, ...models];
  }

  getItems(): ModelRow[] {
    return this.rows;
  }

  getItemText(row: ModelRow): string {
    return row.name;
  }

  onChooseItem(row: ModelRow): void {
    if (row.harnessDefault) {
      void this.opts.onSetDefault(null);
      return;
    }
    this.opts.onChoose(row.value);
  }

  renderSuggestion(match: FuzzyMatch<ModelRow>, el: HTMLElement): void {
    const row = match.item;
    el.empty();
    const body = el.createDiv({ cls: "oc-model-sugg" });
    const info = body.createDiv({ cls: "oc-model-sugg-info" });
    info.createDiv({ cls: "oc-model-sugg-name", text: row.name });
    if (row.description) info.createDiv({ cls: "oc-model-sugg-provider", text: row.description });

    if (row.harnessDefault) {
      const followed = this.opts.defaultModel === null;
      const marker = body.createDiv({ cls: "oc-model-sugg-btn" + (followed ? " is-on" : "") });
      setIcon(marker, followed ? "check" : "circle");
      marker.setAttribute("aria-label", followed ? "New sessions follow the harness default" : "Use the harness default");
      return;
    }

    const pinned = this.pinned.has(row.value);
    const pin = body.createDiv({ cls: "oc-model-sugg-btn oc-model-sugg-pin" + (pinned ? " is-on" : "") });
    setIcon(pin, pinned ? "pin-off" : "pin");
    pin.setAttribute("aria-label", pinned ? "Unpin model" : "Pin model");
    pin.setAttribute("title", pinned ? "Unpin model" : "Pin to the top");
    pin.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void this.togglePin(row.value);
    });

    const isDefault = this.opts.defaultModel === row.value;
    const def = body.createDiv({ cls: "oc-model-sugg-btn oc-model-sugg-default" + (isDefault ? " is-on" : "") });
    setIcon(def, isDefault ? "check" : "target");
    def.setAttribute("aria-label", isDefault ? "Default for new sessions" : "Make this the default for new sessions");
    def.setAttribute("title", isDefault ? "Default for new sessions" : "Make this the default for new sessions");
    def.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void this.setDefault(isDefault ? null : row.value);
    });

    if (this.opts.currentValue === row.value) el.addClass("is-current");
  }

  private async togglePin(value: string): Promise<void> {
    const nowPinned = await this.opts.onTogglePin(value);
    if (nowPinned) this.pinned.add(value);
    else this.pinned.delete(value);
    this.rerender();
  }

  private async setDefault(value: string | null): Promise<void> {
    await this.opts.onSetDefault(value);
    this.opts = { ...this.opts, defaultModel: value };
    this.rerender();
  }

  /** Same re-render trick the old BYOK picker used: re-run the modal's own
   *  filter so ordering and icons update without closing the dialog. */
  private rerender(): void {
    this.rows = this.buildRows();
    this.inputEl.dispatchEvent(new Event("input"));
  }
}

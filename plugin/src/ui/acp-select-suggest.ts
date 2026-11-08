/** Generic searchable picker for any declared select with a long option list.
 *  No model/provider knowledge: it lists exactly the choices it is given. */
import { App, FuzzySuggestModal } from "obsidian";
import type { SelectChoice } from "../acp/controls.ts";

export class AcpSelectSuggestModal extends FuzzySuggestModal<SelectChoice> {
  private choices: SelectChoice[];
  private current: string;
  private onChoose: (value: string) => void;

  constructor(app: App, choices: SelectChoice[], current: string, onChoose: (value: string) => void) {
    super(app);
    this.choices = choices;
    this.current = current;
    this.onChoose = onChoose;
    this.setPlaceholder("Select…");
  }

  getItems(): SelectChoice[] {
    return this.choices;
  }

  getItemText(item: SelectChoice): string {
    return item.description ? `${item.name} — ${item.description}` : item.name;
  }

  onChooseItem(item: SelectChoice): void {
    this.onChoose(item.value);
  }

  onOpen(): void {
    super.onOpen();
    // Keep the declaration order; mark the current choice in the title.
    if (this.current) this.setTitle(`Select (current: ${this.choices.find((c) => c.value === this.current)?.name ?? this.current})`);
  }
}

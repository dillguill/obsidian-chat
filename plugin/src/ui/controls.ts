/** Composer controls generated from the harness's declarations (FR-039/FR-040/
 *  FR-052). There is no plugin-owned control set: every mode, config option,
 *  and command comes from the attached harness, and an empty declaration
 *  renders nothing at all.
 *
 *  This module is Obsidian-free: the long-list picker is injected by the view,
 *  so the model can be unit-tested under plain Node.
 */
import type { AvailableCommand, SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import {
  declaredControls,
  type DeclaredControlModel,
  type SelectChoice,
} from "../acp/controls.ts";

/** Number of choices above which a select uses the searchable picker. */
export const PICKER_THRESHOLD = 8;

export interface ComposerControlHandlers {
  onSelectMode(modeId: string): void;
  onSetConfig(optionId: string, value: string | boolean): void;
  openPicker(heading: string, choices: SelectChoice[], current: string, onChoose: (value: string) => void): void;
  onCommand?(name: string): void;
  /** When set, the trigger is a single icon (filled by the view) and the
   *  current values appear only in the popover. Used on narrow screens. */
  icon?: (el: HTMLElement) => void;
}

export function composerControlModel(input: {
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[] | null;
  commands: AvailableCommand[] | null;
}): DeclaredControlModel {
  return declaredControls(input);
}

export function hasRenderableControls(model: DeclaredControlModel): boolean {
  return model.modes.length > 0 || model.options.length > 0 || model.commands.length > 0;
}

export function shouldUsePicker(choices: SelectChoice[]): boolean {
  return choices.length > PICKER_THRESHOLD;
}

/** The compact trigger text: the current value of every declared mode and
 *  select option, in declaration order. Booleans and commands live only in
 *  the popover. */
export function controlSummary(model: DeclaredControlModel): string[] {
  const out: string[] = [];
  const mode = model.modes.find((m) => m.current);
  if (mode) out.push(mode.name);
  for (const option of model.options) {
    if (option.type !== "select") continue;
    const current = option.choices.find((choice) => choice.value === option.currentValue);
    out.push(current?.name ?? String(option.currentValue));
  }
  return out.filter((text) => text.length > 0);
}

interface MenuItem {
  value: string;
  name: string;
  description?: string;
}

interface ControlRow {
  label: string;
  value: string;
  description?: string;
  /** Opens a choice list; absent for direct actions (booleans). */
  items?: MenuItem[];
  current?: string;
  onChoose?: (value: string) => void;
  onClick?: () => void;
}

/** Renders the declared controls into `container` (cleared first) as one
 *  compact trigger that opens a popover: one row per declared mode / option /
 *  command list, each opening its choices. Renders nothing when the harness
 *  declared nothing. */
export function renderComposerControls(
  container: HTMLElement,
  model: DeclaredControlModel,
  handlers: ComposerControlHandlers,
): void {
  container.empty();
  container.toggleClass("oc-controls-empty", !hasRenderableControls(model));
  if (!hasRenderableControls(model)) return;

  const rows: ControlRow[] = [];
  if (model.modes.length) {
    const current = model.modes.find((m) => m.current);
    rows.push({
      label: "Mode",
      value: current?.name ?? "",
      items: model.modes.map((m) => ({ value: m.id, name: m.name, description: m.description })),
      current: current?.id ?? "",
      onChoose: (value) => handlers.onSelectMode(value),
    });
  }
  for (const option of model.options) {
    if (option.type === "boolean") {
      rows.push({
        label: option.name,
        value: option.currentValue === true ? "On" : "Off",
        description: option.description,
        onClick: () => handlers.onSetConfig(option.id, option.currentValue !== true),
      });
      continue;
    }
    const current = option.choices.find((choice) => choice.value === option.currentValue);
    rows.push({
      label: option.name,
      value: current?.name ?? String(option.currentValue),
      description: option.description,
      items: option.choices,
      current: String(option.currentValue),
      onChoose: (value) => handlers.onSetConfig(option.id, value),
    });
  }
  if (model.commands.length) {
    rows.push({
      label: "Commands",
      value: String(model.commands.length),
      items: model.commands.map((command) => ({ value: command.name, name: `/${command.name}`, description: command.description })),
      current: "",
      onChoose: (value) => handlers.onCommand?.(value),
    });
  }

  const summary = controlSummary(model);
  const trigger = container.createEl("button", {
    cls: `oc-control-trigger${handlers.icon ? " is-icon" : ""}`,
    attr: { type: "button", "aria-haspopup": "menu", "aria-label": summary.length ? `Session settings: ${summary.join(", ")}` : "Session settings" },
  });
  if (handlers.icon) {
    handlers.icon(trigger.createSpan({ cls: "oc-control-icon" }));
    trigger.addEventListener("click", (event) => togglePopover(event));
    return;
  }
  const text = trigger.createSpan({ cls: "oc-control-summary" });
  if (summary.length) {
    summary.forEach((part, index) => text.createSpan({ cls: index === 0 ? "oc-control-primary" : "oc-control-secondary", text: part }));
  } else {
    text.createSpan({ cls: "oc-control-primary", text: "Settings" });
  }
  trigger.createSpan({ cls: "oc-control-chevron" });
  trigger.addEventListener("click", (event) => togglePopover(event));
  return;

  function togglePopover(event: Event): void {
    event.stopPropagation();
    const existing = container.querySelector(".oc-control-pop");
    if (existing) {
      existing.remove();
      trigger.removeClass("is-open");
      return;
    }
    openPopover(container, trigger, rows, handlers);
  }
}

function openPopover(container: HTMLElement, trigger: HTMLElement, rows: ControlRow[], handlers: ComposerControlHandlers): void {
  const pop = container.createDiv({ cls: "oc-control-pop", attr: { role: "menu" } });
  trigger.addClass("is-open");
  const close = () => {
    pop.remove();
    trigger.removeClass("is-open");
    document.removeEventListener("click", outside, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const outside = (event: Event) => {
    if (pop.contains(event.target as Node) || trigger.contains(event.target as Node)) return;
    close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };
  setTimeout(() => {
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);

  const showRows = () => {
    pop.empty();
    for (const row of rows) {
      const el = pop.createEl("button", { cls: "oc-control-row", attr: { type: "button", role: "menuitem", title: row.description ?? row.label } });
      el.createSpan({ cls: "oc-control-row-label", text: row.label });
      el.createSpan({ cls: "oc-control-row-value", text: row.value });
      if (row.items) el.createSpan({ cls: "oc-control-row-chevron" });
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        if (row.onClick) {
          close();
          row.onClick();
          return;
        }
        if (!row.items || !row.onChoose) return;
        if (shouldUsePicker(row.items)) {
          close();
          handlers.openPicker(row.label, row.items, row.current ?? "", row.onChoose);
          return;
        }
        showChoices(row);
      });
    }
  };

  const showChoices = (row: ControlRow) => {
    pop.empty();
    const back = pop.createEl("button", { cls: "oc-control-back", attr: { type: "button" } });
    back.createSpan({ cls: "oc-control-back-chevron" });
    back.createSpan({ text: row.label });
    back.addEventListener("click", (event) => {
      event.stopPropagation();
      showRows();
    });
    for (const item of row.items ?? []) {
      const selected = item.value === row.current;
      const el = pop.createEl("button", {
        cls: `oc-control-choice${selected ? " is-current" : ""}`,
        attr: { type: "button", role: "menuitemradio", "aria-checked": String(selected), title: item.description ?? item.name },
      });
      el.createSpan({ cls: "oc-control-choice-name", text: item.name });
      if (selected) el.createSpan({ cls: "oc-control-check" });
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        close();
        row.onChoose?.(item.value);
      });
    }
  };

  showRows();
}

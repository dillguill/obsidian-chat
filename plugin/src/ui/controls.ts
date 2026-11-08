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

/** Renders the declared controls into `container` (cleared first). Does
 *  nothing when the harness declared nothing. */
export function renderComposerControls(
  container: HTMLElement,
  model: DeclaredControlModel,
  handlers: ComposerControlHandlers,
): void {
  container.empty();
  container.toggleClass("oc-controls-empty", !hasRenderableControls(model));
  if (!hasRenderableControls(model)) return;

  for (const mode of model.modes) {
    const button = container.createEl("button", {
      cls: `oc-control oc-control-mode${mode.current ? " oc-control-current" : ""}`,
      attr: { type: "button", title: mode.description ?? mode.name },
    });
    button.createSpan({ cls: "oc-control-label", text: mode.name });
    button.createSpan({ cls: "oc-control-chevron", text: "▾" });
    button.addEventListener("click", () => {
      openMenu(button, mode.name, model.modes.map((m) => ({ value: m.id, name: m.name, description: m.description })), mode.id, (value) => handlers.onSelectMode(value));
    });
  }

  for (const option of model.options) {
    if (option.type === "boolean") {
      const button = container.createEl("button", {
        cls: `oc-control oc-control-boolean${option.currentValue === true ? " oc-control-current" : ""}`,
        attr: { type: "button", title: option.description ?? option.name },
      });
      button.createSpan({ cls: "oc-control-label", text: `${option.name}: ${option.currentValue === true ? "On" : "Off"}` });
      button.addEventListener("click", () => handlers.onSetConfig(option.id, option.currentValue !== true));
      continue;
    }
    const current = option.choices.find((choice) => choice.value === option.currentValue);
    const button = container.createEl("button", {
      cls: "oc-control oc-control-select",
      attr: { type: "button", title: option.description ?? option.name },
    });
    button.createSpan({ cls: "oc-control-label", text: `${option.name}: ${current?.name ?? String(option.currentValue)}` });
    button.createSpan({ cls: "oc-control-chevron", text: "▾" });
    button.addEventListener("click", () => {
      if (shouldUsePicker(option.choices)) {
        handlers.openPicker(option.name, option.choices, String(option.currentValue), (value) => handlers.onSetConfig(option.id, value));
        return;
      }
      openMenu(button, option.name, option.choices, String(option.currentValue), (value) => handlers.onSetConfig(option.id, value));
    });
  }

  if (model.commands.length) {
    const button = container.createEl("button", { cls: "oc-control oc-control-commands", attr: { type: "button" } });
    button.createSpan({ cls: "oc-control-label", text: "Commands" });
    button.createSpan({ cls: "oc-control-chevron", text: "▾" });
    button.addEventListener("click", () => {
      openMenu(button, "Commands", model.commands.map((command) => ({ value: command.name, name: `/${command.name}`, description: command.description })), "", (value) => handlers.onCommand?.(value));
    });
  }
}

interface MenuItem {
  value: string;
  name: string;
  description?: string;
}

/** Small inline menu for short lists; long lists use the injected picker. */
function openMenu(anchor: HTMLElement, heading: string, items: MenuItem[], current: string, onChoose: (value: string) => void): void {
  const existing = anchor.parentElement?.querySelector(".oc-control-menu");
  if (existing) {
    existing.remove();
    return;
  }
  const menu = anchor.parentElement!.createDiv({ cls: "oc-control-menu" });
  menu.createDiv({ cls: "oc-control-menu-title", text: heading });
  for (const item of items) {
    const row = menu.createEl("button", {
      cls: `oc-control-menu-item${item.value === current ? " oc-control-current" : ""}`,
      attr: { type: "button", title: item.description ?? item.name },
    });
    row.setText(item.name);
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.remove();
      onChoose(item.value);
    });
  }
  const close = (event: Event) => {
    if (menu.contains(event.target as Node)) return;
    menu.remove();
    document.removeEventListener("click", close);
  };
  setTimeout(() => document.addEventListener("click", close), 0);
}

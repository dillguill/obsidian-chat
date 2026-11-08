/** "Attach a note" opens Obsidian's own quick switcher (the same modal as the
 *  search icon / "Quick switcher" command) instead of a custom picker. Only
 *  the choose step changes: the chosen file is attached rather than opened.
 *
 *  The switcher is a core plugin with no public API, so this reaches its
 *  modal class at runtime and fails with a notice when it is unavailable. */
import { Notice, TFile, type App } from "obsidian";

interface SwitcherSuggestion {
  type?: string;
  file?: TFile;
}

type SwitcherModal = {
  open(): void;
  setPlaceholder?(text: string): void;
  setInstructions?(instructions: Array<{ command: string; purpose: string }>): void;
  getSuggestions(query: string): SwitcherSuggestion[];
  onChooseSuggestion(item: SwitcherSuggestion | null, evt: MouseEvent | KeyboardEvent): void;
  allowCreateNewFile?: boolean;
  shouldShowUnresolved?: boolean;
  shouldShowNonFileBookmarks?: boolean;
};

type SwitcherCtor = new (app: App, options: Record<string, unknown>) => SwitcherModal;

export function openVaultFilePicker(
  app: App,
  options: { include: (file: TFile) => boolean; placeholder?: string; onPick: (file: TFile) => void },
): void {
  const plugin = (app as unknown as {
    internalPlugins?: { getEnabledPluginById?(id: string): { QuickSwitcherModal?: SwitcherCtor; options?: Record<string, unknown> } | null };
  }).internalPlugins?.getEnabledPluginById?.("switcher");
  const Modal = plugin?.QuickSwitcherModal;
  if (!Modal) {
    new Notice("Turn on the Quick switcher core plugin to attach notes.");
    return;
  }
  const modal = new Modal(app, { ...(plugin.options ?? {}), showExistingOnly: true, showAttachments: true, showAllFileTypes: false });
  modal.allowCreateNewFile = false;
  modal.shouldShowUnresolved = false;
  modal.shouldShowNonFileBookmarks = false;
  if (options.placeholder) modal.setPlaceholder?.(options.placeholder);
  modal.setInstructions?.([
    { command: "↑↓", purpose: "to navigate" },
    { command: "↵", purpose: "to attach" },
    { command: "esc", purpose: "to dismiss" },
  ]);
  const suggest = modal.getSuggestions.bind(modal);
  modal.getSuggestions = (query: string) =>
    suggest(query).filter((item) => item?.file instanceof TFile && options.include(item.file));
  modal.onChooseSuggestion = (item) => {
    const file = item?.file;
    if (file instanceof TFile && options.include(file)) options.onPick(file);
  };
  modal.open();
}

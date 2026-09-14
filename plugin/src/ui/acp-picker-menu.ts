/** Shared plain pick-one menu for ACP-declared options (agent mode,
 *  thinking level — specs/002-acp-only-chat-ux R5/R6). Deliberately a plain
 *  `Menu`, not a fuzzy-search modal: search modals are reserved for lists
 *  that can be large (models); mode/thinking-level lists are always small.
 *  Reuses the same `Menu`/`addItem`/`showAtPosition` pattern already proven
 *  by `openAttachMenu` — no new UI primitive. */
import { Menu } from "obsidian";
import type { SessionConfigSelectGroup, SessionConfigSelectOption, SessionConfigSelectOptions } from "@agentclientprotocol/sdk";

export interface PickerItem {
  id: string;
  name: string;
}

/** A `SessionConfigOption`'s `options` field is either a flat list or a list
 *  of named groups — flatten to one list for a plain pick-one menu (groups
 *  are a display-organization hint the plain menu doesn't need). */
export function flattenSelectOptions(options: SessionConfigSelectOptions): SessionConfigSelectOption[] {
  const out: SessionConfigSelectOption[] = [];
  for (const o of options) {
    if ("group" in o) out.push(...(o as SessionConfigSelectGroup).options);
    else out.push(o as SessionConfigSelectOption);
  }
  return out;
}

export function openAcpPickerMenu(
  anchorEl: HTMLElement,
  items: PickerItem[],
  currentId: string | undefined,
  onSelect: (item: PickerItem) => void,
) {
  const menu = new Menu();
  for (const item of items) {
    menu.addItem((i) => {
      i.setTitle(item.name);
      i.setChecked(item.id === currentId);
      i.onClick(() => onSelect(item));
    });
  }
  const r = anchorEl.getBoundingClientRect();
  menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
}

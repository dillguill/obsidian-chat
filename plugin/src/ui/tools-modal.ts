/** Tool selection modal — toggle which tools the model may call. */
import { App, Modal, Setting } from "obsidian";
import type { ObsidianChatSettings } from "../settings";
import type { ToolDefinition } from "../chat/types";

export class ToolsModal extends Modal {
  constructor(
    app: App,
    private settings: ObsidianChatSettings,
    private allTools: ToolDefinition[],
    private onChange: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-tools-modal");
    contentEl.createEl("h3", { text: "Tools" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Choose which tools the model can call. Nothing checked off means every tool is available.",
    });

    for (const tool of this.allTools) {
      new Setting(contentEl)
        .setName(tool.name)
        .setDesc(tool.description)
        .addToggle((t) =>
          t.setValue(this.isEnabled(tool.name)).onChange((v) => {
            this.setEnabled(tool.name, v);
            this.onChange();
          })
        );
    }
  }

  private isEnabled(name: string): boolean {
    const en = this.settings.enabledTools;
    return en.length === 0 || en.includes(name);
  }

  private setEnabled(name: string, value: boolean) {
    const all = this.allTools.map((t) => t.name);
    const cur = new Set(this.settings.enabledTools.length ? this.settings.enabledTools : all);
    if (value) cur.add(name);
    else cur.delete(name);
    this.settings.enabledTools = cur.size === all.length ? [] : Array.from(cur);
  }

  onClose() {
    this.contentEl.empty();
  }
}

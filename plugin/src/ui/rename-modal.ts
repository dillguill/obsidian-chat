/** Small rename dialog for a conversation title. */
import { App, Modal, Setting } from "obsidian";

export class RenameModal extends Modal {
  constructor(
    app: App,
    private current: string,
    private onSave: (title: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Rename conversation");
    let value = this.current;
    const save = () => {
      const title = value.trim();
      if (!title) return;
      this.close();
      if (title !== this.current) this.onSave(title);
    };
    new Setting(contentEl).addText((text) => {
      text.setValue(this.current).onChange((next) => (value = next));
      text.inputEl.addClass("oc-rename-input");
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          save();
        }
      });
      window.setTimeout(() => {
        text.inputEl.focus();
        text.inputEl.select();
      }, 0);
    });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Save").setCta().onClick(save));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

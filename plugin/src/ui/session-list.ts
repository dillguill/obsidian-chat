/** Store-backed conversation list (FR-051): the host's stored sessions as ACP
 *  `session/list` returns them. Opening an entry replays it through the
 *  standard `session/load` path. */
import { App, Modal, Setting } from "obsidian";
import type { SessionListEntry } from "../shell/runtime.ts";
import { conversationMeta, conversationStatusLabel, recordSizeLabel, recordStatusLabel } from "./labels.ts";

export class SessionListModal extends Modal {
  private sessions: SessionListEntry[];
  private onPick: (sessionId: string) => void;

  constructor(app: App, sessions: SessionListEntry[], onPick: (sessionId: string) => void) {
    super(app);
    this.sessions = sessions;
    this.onPick = onPick;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Conversations" });
    if (!this.sessions.length) {
      contentEl.createEl("p", { text: "No stored conversations on this host yet." });
      contentEl.createEl("p", {
        text: "Older Markdown chats are imported automatically on load. If you expected them, run “Reimport legacy chats (diagnostics)” from the command palette to see what was scanned and why.",
      });
      return;
    }
    for (const session of this.sessions) {
      const setting = new Setting(contentEl)
        .setName(session.title)
        .setDesc(
          conversationMeta([
            formatWhen(session.updatedAt),
            // A healthy, resumable conversation is untagged; only exceptions get
            // plain-language labels (T125).
            conversationStatusLabel(session.resume),
            recordStatusLabel(session.degraded),
            recordSizeLabel(session.large),
          ]),
        );
      setting.addButton((button) =>
        button
          .setButtonText("Open")
          .onClick(() => {
            this.close();
            this.onPick(session.sessionId);
          }),
      );
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function formatWhen(iso: string): string {
  if (!iso) return "unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

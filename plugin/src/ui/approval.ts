/** Approval UI for write tools (Phase 2a).
 *  Review mode shows a diff card with Allow once / Always allow / Deny.
 *  Plan mode shows the preview but only permits closing (never applies).
 *  Persistent allow/deny per tool is stored in settings.toolAllowlist (Copilot
 *  semantics: "remember this tool's decision"). */
import { App, Modal, Setting } from "obsidian";
import type { ObsidianChatSettings } from "../settings";
import type { ApprovalDecision, ApprovalRequester } from "../tools/runner";
import type { WritePreview } from "../tools/contract";

export class ApprovalModal extends Modal {
  private resolved = false;
  constructor(
    app: App,
    private preview: WritePreview,
    private mode: "review" | "plan",
    private onDecide: (d: ApprovalDecision) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-approval");

    contentEl.createEl("h3", { text: `${this.preview.action}${this.mode === "plan" ? " (plan — not applied)" : ""}` });
    contentEl.createEl("p", { text: this.preview.summary });

    if (this.preview.diff?.length) {
      const pre = contentEl.createEl("pre", { cls: "oc-diff" });
      pre.createEl("code", { text: this.preview.diff.join("\n") });
    }

    if (this.mode === "plan") {
      new Setting(contentEl).addButton((b) =>
        b.setButtonText("OK (not applied)").setCta().onClick(() => {
          this.onDecide({ allowed: false });
          this.close();
        })
      );
      return;
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Deny").onClick(() => this.decide({ allowed: false })))
      .addButton((b) => b.setButtonText("Always allow").setCta().onClick(() => this.decide({ allowed: true, remember: true })))
      .addButton((b) => b.setButtonText("Allow once").setCta().onClick(() => this.decide({ allowed: true })));
  }

  private decide(d: ApprovalDecision) {
    if (this.resolved) return;
    this.resolved = true;
    this.onDecide(d);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.onDecide({ allowed: false });
  }
}

/** Build an ApprovalRequester from the plugin's settings. */
export function createApprovalRequester(app: App, settings: ObsidianChatSettings, save: () => void): ApprovalRequester {
  return {
    async request(preview: WritePreview): Promise<ApprovalDecision> {
      const mode = settings.approvalMode;
      // Persistent per-tool decision (Copilot semantics).
      if (mode !== "plan" && settings.toolAllowlist[preview.action] !== undefined) {
        return { allowed: settings.toolAllowlist[preview.action] };
      }
      return new Promise<ApprovalDecision>((resolve) => {
        const modal = new ApprovalModal(app, preview, mode === "plan" ? "plan" : "review", (d) => {
          if (d.remember) {
            settings.toolAllowlist[preview.action] = d.allowed;
            save();
          }
          resolve(d);
        });
        modal.open();
      });
    },
  };
}

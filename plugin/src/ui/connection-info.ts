/** Connection info modal (specs/003-workspace-parity W7.10).
 *
 *  The same rows the status banner summarises, in full: bridge URL, session
 *  id, SSE cursor, retry count, last transport error. Deliberately plain —
 *  this is a debugging surface for a personal plugin, not a product screen. */
import { App, Modal, Setting } from "obsidian";

export interface ConnectionDebugInfo {
  baseUrl: string;
  connected: boolean;
  sessionId: string | null;
  lastEventId: number;
  retries: number;
  lastError: string | null;
}

/** Last mobile-keyboard geometry sample (W7.13).
 *
 *  The phone has no console, so the chat view records what it saw while the
 *  keyboard was up and hands the most recent sample here — opening this modal
 *  requires dismissing the keyboard, so the sample is taken only in the open
 *  state and survives that dismissal.
 *
 *  The per-container heights matter as much as the viewport numbers: the box
 *  that actually strangles this view is one of Obsidian's own containers, and
 *  the chain here says which. */
export interface KeyboardDebugInfo {
  open: boolean;
  covered: number;
  pinned: boolean;
  innerHeight: number;
  visualHeight: number;
  visualOffsetTop: number;
  restingHeight: number;
  screenHeight: number;
  keyboardVar: string;
  appHeight: number;
  viewContentHeight: number;
  viewHeight: number;
  messagesHeight: number;
  composerHeight: number;
}

export class ConnectionInfoModal extends Modal {
  constructor(
    app: App,
    private readonly info: ConnectionDebugInfo | undefined,
    private readonly keyboard: KeyboardDebugInfo | null = null,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Connection info" });
    const rows: [string, string][] = [
      ["Bridge URL", this.info?.baseUrl ?? "(not connected yet)"],
      ["Connected", this.info?.connected ? "yes" : "no"],
      ["Session id", this.info?.sessionId ?? "—"],
      ["Last event id", String(this.info?.lastEventId ?? 0)],
      ["Reconnect attempts", String(this.info?.retries ?? 0)],
      ["Last error", this.info?.lastError ?? "—"],
    ];
    if (this.keyboard) {
      const k = this.keyboard;
      rows.push(
        ["", ""],
        ["Keyboard open", k.open ? "yes" : "no"],
        ["Covered", `${k.covered}px`],
        ["Pinned to visual viewport", k.pinned ? "yes" : "no"],
        ["innerHeight", String(k.innerHeight)],
        ["visualViewport", `${k.visualHeight} (offset ${k.visualOffsetTop})`],
        ["resting height", String(k.restingHeight)],
        ["screen.height", String(k.screenHeight)],
        ["--keyboard-height", k.keyboardVar],
        ["", ""],
        ["  .app-container", `${k.appHeight}px`],
        ["  .view-content", `${k.viewContentHeight}px`],
        ["  .oc-view (this view)", `${k.viewHeight}px`],
        ["  .oc-messages", `${k.messagesHeight}px`],
        ["  .oc-composer-wrap", `${k.composerHeight}px`],
      );
    }
    const pre = contentEl.createEl("pre", { cls: "oc-conn-info" });
    pre.setText(rows.map(([k, v]) => `${k}: ${v}`).join("\n"));
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Copy").onClick(() => void navigator.clipboard.writeText(pre.getText())),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

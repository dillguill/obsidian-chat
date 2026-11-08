/** Connection details modal.
 *
 *  US3 surface: attach mode/state, transport label, host listener, store path,
 *  retries, and the last error. It never shows tokens or file content. The
 *  legacy fields stay so the old chat view keeps working until T121 retires it.
 */
import { App, Modal, Setting } from "obsidian";
import { pagedRaw, rawEntryJson, type RawRecordEntry } from "./raw-view.ts";

export interface ConnectionDebugInfo {
  baseUrl: string;
  connected: boolean;
  sessionId: string | null;
  lastEventId?: number;
  retries: number;
  lastError: string | null;
  /** Which shell mode is attached (US3). */
  mode?: "local" | "remote" | "relay";
  /** ACP connection state. */
  state?: string;
  /** Non-secret transport label. */
  label?: string;
  /** Host listener address, when this install is the host. */
  listener?: string | null;
  /** Vault-relative session-store folder. */
  storePath?: string | null;
  /** Stored conversations visible to this device. */
  sessionCount?: number;
  /** Context-window usage of the current conversation, e.g. "25k / 1M". */
  context?: string | null;
  /** Session-wide raw ACP notifications (local-only rendering; never persisted here). */
  rawEntries?: RawRecordEntry[];
}

/** Last mobile-keyboard geometry sample (W7.13). */
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
    const rows: [string, string][] = [];
    if (this.info?.context) rows.push(["Context used", this.info.context]);
    if (this.info?.mode) {
      rows.push(
        ["Mode", this.info.mode],
        ["Attach state", this.info.state ?? "—"],
        ["Transport", this.info.label ?? "—"],
        ["Host listener", this.info.listener ?? "(this device is not the host)"],
        ["Connected", this.info.connected ? "yes" : "no"],
        ["Session id", this.info.sessionId ?? "—"],
        ["Conversations visible", String(this.info.sessionCount ?? 0)],
        ["Session store", this.info.storePath ?? "—"],
        ["Reconnect attempts", String(this.info.retries)],
        ["Last error", this.info.lastError ?? "—"],
      );
    } else {
      rows.push(
        ["Bridge URL", this.info?.baseUrl ?? "(not connected yet)"],
        ["Connected", this.info?.connected ? "yes" : "no"],
        ["Session id", this.info?.sessionId ?? "—"],
        ["Last event id", String(this.info?.lastEventId ?? 0)],
        ["Reconnect attempts", String(this.info?.retries ?? 0)],
        ["Last error", this.info?.lastError ?? "—"],
      );
    }
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

/** Paged, read-only view of the session's raw ACP notifications (FR-048). */
export class RawRecordModal extends Modal {
  private entries: RawRecordEntry[];
  private page = 1;

  constructor(app: App, entries: RawRecordEntry[]) {
    super(app);
    this.entries = entries;
  }

  onOpen(): void {
    this.draw();
  }

  private draw(): void {
    const { contentEl } = this;
    contentEl.empty();
    const page = pagedRaw(this.entries, this.page);
    contentEl.createEl("h3", { text: "Raw ACP record" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `${page.total} notification(s) · page ${page.page} of ${page.pages}`,
    });
    const pre = contentEl.createEl("pre", { cls: "oc-conn-info" });
    pre.setText(page.entries.map((entry) => rawEntryJson(entry).text).join("\n\n"));
    const controls = contentEl.createDiv();
    new Setting(controls)
      .addButton((button) =>
        button
          .setButtonText("Previous")
          .setDisabled(page.page <= 1)
          .onClick(() => {
            this.page = page.page - 1;
            this.draw();
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("Next")
          .setDisabled(page.page >= page.pages)
          .onClick(() => {
            this.page = page.page + 1;
            this.draw();
          }),
      )
      .addButton((button) =>
        button.setButtonText("Copy page").onClick(() => void navigator.clipboard.writeText(pre.getText())),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

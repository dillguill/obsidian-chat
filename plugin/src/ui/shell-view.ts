/** Minimal ACP shell view (US1): send, stream, cancel, and show honest errors.
 *
 *  This is intentionally small; US6 replaces the transcript with the full
 *  generic ACP renderer (tool content variants, raw views, declared controls).
 *  Persistence lives in ShellRuntime, not here.
 */
import { ItemView, type WorkspaceLeaf } from "obsidian";
import type ObsidianChatPlugin from "../main";
import type { ChatEvent, PendingPermission, RenderUpdate } from "../acp/types.ts";
import type { RecordEntry } from "../session/record.ts";
import { renderPermissionCard } from "./approval.ts";

export const SHELL_VIEW_TYPE = "obsidian-chat-acp-shell";

export class ShellChatView extends ItemView {
  private plugin: ObsidianChatPlugin;
  private messagesEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private unsubscribers: Array<() => void> = [];
  private busy = false;
  private currentAssistant: HTMLElement | null = null;
  private currentThought: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianChatPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SHELL_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "ACP Shell";
  }
  getIcon(): string {
    return "terminal-square";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("oc-shell-view");
    const header = root.createDiv({ cls: "oc-shell-header" });
    header.createEl("span", { cls: "oc-shell-title", text: "ACP Shell" });
    this.statusEl = header.createSpan({ cls: "oc-shell-status", text: "connecting…" });
    const actions = header.createDiv({ cls: "oc-shell-actions" });
    this.undoBtn = actions.createEl("button", { cls: "oc-shell-btn oc-shell-undo", text: "Undo write" });
    this.undoBtn.toggleClass("oc-shell-hidden", true);
    this.undoBtn.addEventListener("click", () => void this.undoLastWrite());
    const newBtn = actions.createEl("button", { cls: "oc-shell-btn", text: "New" });
    newBtn.addEventListener("click", () => void this.newSession());

    this.messagesEl = root.createDiv({ cls: "oc-shell-messages" });
    const composer = root.createDiv({ cls: "oc-shell-composer" });
    this.inputEl = composer.createEl("textarea", { cls: "oc-shell-input" });
    this.inputEl.placeholder = "Message the harness…";
    this.inputEl.rows = 2;
    const row = composer.createDiv({ cls: "oc-shell-buttons" });
    this.stopBtn = row.createEl("button", { cls: "oc-shell-btn oc-shell-stop", text: "Stop" });
    this.stopBtn.toggleClass("oc-shell-hidden", true);
    this.sendBtn = row.createEl("button", { cls: "oc-shell-btn mod-cta", text: "Send" });

    this.sendBtn.addEventListener("click", () => void this.send());
    this.stopBtn.addEventListener("click", () => void this.cancel());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.send();
      }
      if (e.key === "Escape" && this.busy) {
        e.preventDefault();
        void this.cancel();
      }
    });

    const runtime = this.plugin.shellRuntime();
    this.unsubscribers.push(
      runtime.onEvent((event) => this.renderEvent(event)),
      runtime.onPermissionRequest((request) => this.renderPermission(request)),
      runtime.onStateChange(() => this.updateStatus()),
    );
    this.updateStatus();
    await this.loadHistory();
    if (!runtime.isConnected) {
      void runtime
        .connect()
        .then(() => this.updateStatus())
        .catch((err) => this.showError(String((err as Error).message ?? err)));
    }
  }

  async onClose(): Promise<void> {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  private updateStatus(): void {
    const runtime = this.plugin.shellRuntime();
    const info = runtime.clientDebugInfo;
    if (!info) {
      this.statusEl.setText("disconnected");
      this.undoBtn.toggleClass("oc-shell-hidden", true);
      return;
    }
    let text = `${info.mode} · ${info.state}${info.lastError ? " · " + info.lastError : ""}`;
    if (info.state === "connected" && !runtime.vaultToolsAvailable) {
      text += runtime.vaultToolsError ? ` · ${runtime.vaultToolsError}` : " · vault tools unavailable";
    }
    this.statusEl.setText(text);
    this.undoBtn.toggleClass("oc-shell-hidden", !runtime.pendingUndo());
  }

  private async undoLastWrite(): Promise<void> {
    try {
      const restored = await this.plugin.shellRuntime().undoLastWrite();
      if (restored) {
        this.messagesEl.createDiv({ cls: "oc-shell-notice", text: `Restored ${restored.relPath}` });
        this.scroll();
      }
    } catch (err) {
      this.showError(`Undo failed: ${String((err as Error).message ?? err)}`);
    }
    this.updateStatus();
  }

  private scroll(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    this.inputEl.value = "";
    this.appendUser(text);
    this.setBusy(true);
    this.currentAssistant = null;
    this.currentThought = null;
    try {
      await this.plugin.shellRuntime().send(text);
    } catch (err) {
      const message = String((err as Error).message ?? err);
      this.showError(message);
      this.setBusy(false);
    }
  }

  private async cancel(): Promise<void> {
    await this.plugin.shellRuntime().cancel();
  }

  private async newSession(): Promise<void> {
    await this.plugin.shellRuntime().reset();
    this.messagesEl.empty();
    this.currentAssistant = null;
    this.currentThought = null;
    this.setBusy(false);
    await this.plugin.shellRuntime().connect().catch((err) => this.showError(String(err)));
    this.updateStatus();
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.stopBtn.toggleClass("oc-shell-hidden", !busy);
    this.sendBtn.toggleClass("oc-shell-hidden", busy);
    this.sendBtn.disabled = busy;
  }

  private appendUser(text: string): void {
    this.messagesEl.createDiv({ cls: "oc-shell-msg oc-shell-user", text });
    this.scroll();
  }

  private appendAssistant(text: string): void {
    if (!this.currentAssistant) {
      this.currentAssistant = this.messagesEl.createDiv({ cls: "oc-shell-msg oc-shell-assistant" });
    }
    this.currentAssistant.textContent = (this.currentAssistant.textContent ?? "") + text;
    this.currentThought = null;
    this.scroll();
  }

  private appendThought(text: string): void {
    if (!this.currentThought) {
      this.currentThought = this.messagesEl.createDiv({ cls: "oc-shell-msg oc-shell-thought" });
    }
    this.currentThought.textContent = (this.currentThought.textContent ?? "") + text;
    this.scroll();
  }

  private appendTool(update: Extract<RenderUpdate, { type: "tool_call" }>): void {
    const t = update.toolCall;
    const label = t.title ?? t.name ?? t.kind ?? "tool";
    const row = this.messagesEl.createDiv({ cls: "oc-shell-msg oc-shell-tool" });
    row.setText(`${label}${t.status ? ` · ${t.status}` : ""}${t.late ? " · late" : ""}`);
    this.scroll();
  }

  private renderEvent(event: ChatEvent): void {
    if (event.error) {
      this.showError(event.error.message);
      this.setBusy(false);
      return;
    }
    if (event.turn) {
      const status = this.messagesEl.createDiv({ cls: "oc-shell-status-row" });
      const why = event.turn.interrupted ? "interrupted" : (event.turn.stopReason ?? "ended");
      status.setText(`turn ${event.turn.number} · ${why}`);
      this.setBusy(false);
      this.scroll();
      return;
    }
    if (!event.update) return;
    const update = event.update;
    switch (update.type) {
      case "message":
        if (update.role === "agent") this.appendAssistant(update.text);
        break;
      case "thought":
        this.appendThought(update.text);
        break;
      case "tool_call":
        this.appendTool(update);
        break;
      case "plan": {
        const box = this.messagesEl.createDiv({ cls: "oc-shell-plan" });
        box.createDiv({ cls: "oc-shell-plan-title", text: "Plan" });
        for (const entry of update.entries) {
          box.createDiv({ cls: "oc-shell-plan-row", text: `${entry.status} · ${entry.content}` });
        }
        break;
      }
      case "usage":
        this.statusEl.setText(`${update.usage.used} / ${update.usage.size} tokens`);
        break;
      case "raw":
        this.renderRaw(update.sessionUpdate, update.payload);
        break;
      default:
        break;
    }
    this.scroll();
  }

  private renderRaw(kind: string, payload: unknown): void {
    const details = this.messagesEl.createEl("details", { cls: "oc-shell-raw" });
    details.createEl("summary", { text: `ACP update: ${kind}` });
    let text = "";
    try {
      text = JSON.stringify(payload, null, 2).slice(0, 4_000);
    } catch {
      text = String(payload);
    }
    details.createEl("pre", { text });
  }

  private renderPermission(request: PendingPermission): void {
    renderPermissionCard(this.messagesEl, request, (optionId) => {
      void this.plugin.shellRuntime().respondPermission(request.requestId, optionId);
    });
    this.scroll();
  }

  private showError(message: string): void {
    const row = this.messagesEl.createDiv({ cls: "oc-shell-error" });
    row.setText(message);
    if (/api key|credential|auth|provider route/i.test(message)) {
      row.createDiv({
        cls: "oc-shell-error-hint",
        text: "The harness is missing provider credentials. Add the key in the harness's own config or Models page (or export it in the environment that launches Obsidian), then restart the harness.",
      });
    }
    this.scroll();
  }

  private async loadHistory(): Promise<void> {
    const history = await this.plugin.shellRuntime().history();
    if (!history) return;
    for (const entry of history.entries) this.renderHistoryEntry(entry);
    this.scroll();
  }

  private renderHistoryEntry(entry: RecordEntry): void {
    if (entry.kind === "prompt") {
      const blocks = (entry as { blocks?: Array<{ type?: string; text?: string }> }).blocks ?? [];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      if (text) this.appendUser(text);
      return;
    }
    if (entry.kind === "update") {
      const payload = (entry as { payload?: RenderUpdate }).payload;
      if (!payload) return;
      if (payload.type === "message" && payload.role === "agent") this.appendAssistant(payload.text);
      else if (payload.type === "tool_call") this.appendTool(payload);
      return;
    }
    if (entry.kind === "turn") {
      const why = (entry as { interrupted?: boolean; stopReason?: string }).interrupted
        ? "interrupted"
        : (entry as { stopReason?: string }).stopReason ?? "ended";
      this.messagesEl.createDiv({ cls: "oc-shell-status-row", text: `turn ${(entry as { turn?: number }).turn} · ${why}` });
      return;
    }
    if (entry.kind === "error") {
      this.showError((entry as { message?: string }).message ?? "error");
    }
  }
}

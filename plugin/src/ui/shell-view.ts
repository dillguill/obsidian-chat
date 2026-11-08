/** ACP shell view: a faithful protocol transcript plus composer (FR-039…FR-052).
 *
 *  The transcript renders ACP's own fields generically (no tool-name
 *  dictionary), keeps arrival order and expansion by default, and offers
 *  per-turn + session-wide raw views. Composer controls come from the harness's
 *  declarations. History is store-backed; the shell keeps no local history on a
 *  remote device.
 */
import { ItemView, Notice, Platform, type WorkspaceLeaf } from "obsidian";
import type ObsidianChatPlugin from "../main";
import type { ChatEvent, PendingPermission, RenderUpdate, ToolCallView } from "../acp/types.ts";
import { mapSessionUpdate } from "../acp/session-update.ts";
import type { RecordEntry } from "../session/record.ts";
import { renderPermissionCard } from "./approval.ts";
import { SessionListModal } from "./session-list.ts";
import { ConnectionInfoModal } from "./connection-info.ts";
import { composerControlModel, renderComposerControls } from "./controls.ts";
import { AcpSelectSuggestModal } from "./acp-select-suggest.ts";
import {
  activityPresentation,
  renderMessage,
  renderToolCard,
  renderUpdate,
  type ToolCardHandle,
} from "./renderer.ts";
import { renderRawDisclosure, type RawRecordEntry } from "./raw-view.ts";
import { renderMarkdown } from "./markdown.ts";
import { NoteMentionModal, type MentionItem } from "./mention.ts";
import { IMAGE_EXT, vaultFileDataUrl } from "./image-picker.ts";
import type { ContinuityChoice, ContinuityInfo } from "../shell/runtime.ts";

export const SHELL_VIEW_TYPE = "obsidian-chat-acp-shell";

interface ContextChip {
  id: string;
  label: string;
  text: string;
  path?: string;
}

interface PendingImage {
  name: string;
  mimeType: string;
  data: string;
}

export class ShellChatView extends ItemView {
  private plugin: ObsidianChatPlugin;
  private messagesEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private controlsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private unsubscribers: Array<() => void> = [];
  private busy = false;
  private currentAssistantEl: HTMLElement | null = null;
  private currentAssistantText = "";
  private currentThoughtEl: HTMLElement | null = null;
  private toolCards = new Map<string, ToolCardHandle>();
  private toolStartedAt = new Map<string, number>();
  private activityGroups = new Map<number, HTMLElement>();
  private turnRaw = new Map<number, RawRecordEntry[]>();
  private allRaw: RawRecordEntry[] = [];
  private currentTurn = 0;
  private contextChips: ContextChip[] = [];
  private pendingImages: PendingImage[] = [];
  private continuityBar: HTMLElement | null = null;

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
    if (Platform.isMobile) root.addClass("oc-shell-mobile");
    const header = root.createDiv({ cls: "oc-shell-header" });
    header.createEl("span", { cls: "oc-shell-title", text: "ACP Shell" });
    this.statusEl = header.createSpan({ cls: "oc-shell-status", text: "connecting…" });
    const actions = header.createDiv({ cls: "oc-shell-actions" });
    this.undoBtn = actions.createEl("button", { cls: "oc-shell-btn oc-shell-undo", text: "Undo write" });
    this.undoBtn.toggleClass("oc-shell-hidden", true);
    this.undoBtn.addEventListener("click", () => void this.undoLastWrite());
    actions.createEl("button", { cls: "oc-shell-btn", text: "New" }).addEventListener("click", () => void this.newSession());
    actions.createEl("button", { cls: "oc-shell-btn", text: "History" }).addEventListener("click", () => void this.openHistory());
    actions.createEl("button", { cls: "oc-shell-btn", text: "Info" }).addEventListener("click", () => this.openConnectionInfo());

    this.messagesEl = root.createDiv({ cls: "oc-shell-messages" });
    this.chipsEl = root.createDiv({ cls: "oc-shell-chips" });
    const composer = root.createDiv({ cls: "oc-shell-composer" });
    this.controlsEl = composer.createDiv({ cls: "oc-shell-controls" });
    this.inputEl = composer.createEl("textarea", { cls: "oc-shell-input" });
    this.inputEl.placeholder = Platform.isMobileApp ? "Ask anything…" : "Message the harness… (@ for notes, / for commands)";
    this.inputEl.rows = 2;
    const row = composer.createDiv({ cls: "oc-shell-buttons" });
    const attachBtn = row.createEl("button", { cls: "oc-shell-btn", text: "+", attr: { title: "Attach image" } });
    attachBtn.addEventListener("click", () => this.pickImage());
    const noteBtn = row.createEl("button", { cls: "oc-shell-btn", text: "Note", attr: { title: "Add the current note as context" } });
    noteBtn.addEventListener("click", () => void this.addActiveNoteContext());
    const mentionBtn = row.createEl("button", { cls: "oc-shell-btn", text: "@", attr: { title: "Mention a note" } });
    mentionBtn.addEventListener("click", () => this.openMentionPicker());
    const selectionBtn = row.createEl("button", { cls: "oc-shell-btn", text: "Sel", attr: { title: "Add the editor selection as context" } });
    selectionBtn.addEventListener("click", () => this.addSelectionContext());
    this.stopBtn = row.createEl("button", { cls: "oc-shell-btn oc-shell-stop", text: "Stop" });
    this.stopBtn.toggleClass("oc-shell-hidden", true);
    this.sendBtn = row.createEl("button", { cls: "oc-shell-btn mod-cta", text: "Send" });

    this.sendBtn.addEventListener("click", () => void this.send());
    this.stopBtn.addEventListener("click", () => void this.cancel());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !Platform.isMobileApp) {
        event.preventDefault();
        void this.send();
      }
      if (event.key === "Escape" && this.busy) {
        event.preventDefault();
        void this.cancel();
      }
    });
    this.inputEl.addEventListener("input", () => this.maybeOpenMention());

    const runtime = this.plugin.shellRuntime();
    this.unsubscribers.push(
      runtime.onEvent((event) => this.renderEvent(event)),
      runtime.onPermissionRequest((request) => this.renderPermission(request)),
      runtime.onStateChange(() => {
        this.updateStatus();
        this.renderControls();
      }),
    );
    this.updateStatus();
    this.renderControls();
    this.renderChips();
    if (!runtime.isConnected) {
      try {
        await runtime.connect();
      } catch (err) {
        this.showError(String((err as Error).message ?? err));
      }
    }
    this.updateStatus();
    this.renderControls();
    await this.loadHistory();
  }

  async onClose(): Promise<void> {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  private presentation(): "chronological" | "grouped" {
    return activityPresentation(this.plugin.settings.activityDensity);
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

  /** Composer controls generated from the harness's declarations. */
  private renderControls(): void {
    const runtime = this.plugin.shellRuntime();
    const model = composerControlModel({
      modes: runtime.modes,
      configOptions: runtime.configOptions,
      commands: runtime.commands,
    });
    renderComposerControls(this.controlsEl, model, {
      onSelectMode: (modeId) => {
        void runtime.setMode(modeId).then(() => this.renderControls()).catch((err) => this.showError(`Could not change mode: ${String((err as Error).message ?? err)}`));
      },
      onSetConfig: (configId, value) => {
        void runtime.setConfigOption(configId, value).then(() => this.renderControls()).catch((err) => this.showError(`Could not change that setting: ${String((err as Error).message ?? err)}`));
      },
      openPicker: (heading, choices, current, onChoose) => {
        new AcpSelectSuggestModal(this.plugin.app, choices, current, onChoose).open();
      },
      onCommand: (name) => {
        this.inputEl.value = `/${name} `;
        this.inputEl.focus();
      },
    });
  }

  // ---------- context & attachments ----------

  private renderChips(): void {
    this.chipsEl.empty();
    this.chipsEl.toggleClass("oc-shell-hidden", !this.contextChips.length && !this.pendingImages.length);
    for (const chip of this.contextChips) {
      const row = this.chipsEl.createDiv({ cls: "oc-chip" });
      row.createSpan({ text: chip.label });
      const remove = row.createEl("button", { cls: "oc-chip-x", text: "×", attr: { type: "button" } });
      remove.addEventListener("click", () => {
        this.contextChips = this.contextChips.filter((existing) => existing.id !== chip.id);
        this.renderChips();
      });
    }
    for (const image of this.pendingImages) {
      const row = this.chipsEl.createDiv({ cls: "oc-chip" });
      row.createSpan({ text: `image: ${image.name}` });
      const remove = row.createEl("button", { cls: "oc-chip-x", text: "×", attr: { type: "button" } });
      remove.addEventListener("click", () => {
        this.pendingImages = this.pendingImages.filter((existing) => existing !== image);
        this.renderChips();
      });
    }
  }

  private addContextChip(chip: ContextChip): void {
    if (this.contextChips.some((existing) => existing.id === chip.id)) return;
    this.contextChips.push(chip);
    this.renderChips();
  }

  private async addActiveNoteContext(): Promise<void> {
    const file = this.plugin.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note");
      return;
    }
    const text = await this.plugin.app.vault.read(file);
    this.addContextChip({ id: `note:${file.path}`, label: file.basename, path: file.path, text });
  }

  private addSelectionContext(): void {
    const editor = this.plugin.app.workspace.activeEditor?.editor;
    const selection = editor?.getSelection()?.trim();
    if (!selection) {
      new Notice("No text selected");
      return;
    }
    const file = this.plugin.app.workspace.getActiveFile();
    this.addContextChip({
      id: `selection:${file?.path ?? "unknown"}:${selection.slice(0, 32)}`,
      label: `${selection.split(/\r?\n/).length} line(s) selected`,
      path: file?.path,
      text: selection,
    });
  }

  private maybeOpenMention(): void {
    const value = this.inputEl.value;
    if (!/(?:^|\s)@[^\s]*$/.test(value)) return;
    this.inputEl.value = value.replace(/@[^\s]*$/, "");
    this.openMentionPicker();
  }

  private openMentionPicker(): void {
    if (this.plugin.shellRuntime().mode === "remote") {
      new Notice("Mention search runs on the host; it isn't available from a remote shell yet.");
      return;
    }
    const items: MentionItem[] = [];
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      items.push({ path: file.path, link: file.path.replace(/\.md$/, ""), kind: "note", mtime: file.stat.mtime });
    }
    for (const file of this.plugin.app.vault.getFiles()) {
      if (IMAGE_EXT.has(file.extension)) items.push({ path: file.path, link: file.path, kind: "image", mtime: file.stat.mtime });
    }
    items.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    new NoteMentionModal(this.plugin.app, items, (item) => {
      if (item.kind === "image") {
        void this.attachVaultImage(item.path);
        return;
      }
      const abstract = this.plugin.app.vault.getAbstractFileByPath(item.path);
      if (!abstract) return;
      void this.plugin.app.vault.read(abstract as never).then((text) => {
        this.addContextChip({ id: `note:${item.path}`, label: item.link, path: item.path, text });
      });
    }).open();
  }

  private async attachVaultImage(path: string): Promise<void> {
    const image = await vaultFileDataUrl(this.plugin.app, path);
    const data = image.dataUrl.split(",")[1] ?? "";
    this.pendingImages.push({ name: image.name, mimeType: image.mediaType, data });
    this.renderChips();
  }

  private pickImage(): void {
    const input = createEl("input", { attr: { type: "file", accept: "image/*" } });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        const data = dataUrl.split(",")[1] ?? "";
        this.pendingImages.push({ name: file.name, mimeType: file.type || "image/png", data });
        this.renderChips();
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  /** Note context + advisory vault rules for a local host. A remote shell never
   *  reads the host vault itself (FR-012). */
  private async buildPromptText(text: string): Promise<string> {
    const parts: string[] = [];
    for (const chip of this.contextChips) {
      const header = chip.path ? `### Context: ${chip.path}` : `### Context: ${chip.label}`;
      parts.push(`${header}\n\n${chip.text}`);
    }
    if (this.plugin.settings.injectVaultRules && this.plugin.shellRuntime().mode === "local") {
      for (const candidate of ["AGENTS.md", "vault-rules.md", ".chat/rules.md"]) {
        try {
          const file = this.plugin.app.vault.getAbstractFileByPath(candidate);
          if (file) {
            parts.push(`### Vault rules: ${candidate}\n\n${await this.plugin.app.vault.read(file as never)}`);
            break;
          }
        } catch {
          // advisory only
        }
      }
    }
    return parts.length ? `${parts.join("\n\n")}\n\n---\n\n${text}` : text;
  }

  // ---------- send / cancel / session actions ----------

  private async send(): Promise<void> {
    const typed = this.inputEl.value.trim();
    if ((!typed && !this.pendingImages.length) || this.busy) return;
    this.inputEl.value = "";
    this.setBusy(true);
    this.currentAssistantEl = null;
    this.currentAssistantText = "";
    this.currentThoughtEl = null;
    const images = [...this.pendingImages];
    const chips = [...this.contextChips];
    try {
      const text = await this.buildPromptText(typed);
      this.appendUser(typed || `${images.length} image(s)`);
      await this.plugin.shellRuntime().send(text, { images: images.map(({ mimeType, data }) => ({ mimeType, data })) });
      this.contextChips = [];
      this.pendingImages = [];
      this.renderChips();
      this.clearContinuityBar();
    } catch (err) {
      this.contextChips = chips;
      this.pendingImages = images;
      this.renderChips();
      const message = String((err as Error).message ?? err);
      this.showError(message);
      this.setBusy(false);
    }
  }

  private async cancel(): Promise<void> {
    await this.plugin.shellRuntime().cancel();
  }

  private async newSession(): Promise<void> {
    const runtime = this.plugin.shellRuntime();
    this.clearTranscript();
    this.setBusy(false);
    try {
      if (!runtime.isConnected) await runtime.connect();
      await runtime.newSession();
      this.renderControls();
    } catch (err) {
      this.showError(String((err as Error).message ?? err));
    }
    this.updateStatus();
  }

  private clearTranscript(): void {
    this.clearContinuityBar();
    this.messagesEl.empty();
    this.toolCards.clear();
    this.toolStartedAt.clear();
    this.activityGroups.clear();
    this.turnRaw.clear();
    this.allRaw = [];
    this.currentTurn = 0;
    this.currentAssistantEl = null;
    this.currentAssistantText = "";
    this.currentThoughtEl = null;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.stopBtn.toggleClass("oc-shell-hidden", !busy);
    this.sendBtn.toggleClass("oc-shell-hidden", busy);
    this.sendBtn.disabled = busy;
  }

  private scroll(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  // ---------- transcript ----------

  private appendUser(text: string): void {
    if (!text) return;
    renderMessage(this.messagesEl, "user", text);
    this.scroll();
  }

  private appendAssistant(text: string): void {
    if (!this.currentAssistantEl) this.currentAssistantEl = this.messagesEl.createDiv({ cls: "oc-msg oc-msg-agent" });
    this.currentAssistantText += text;
    this.currentAssistantEl.textContent = this.currentAssistantText;
    this.scroll();
  }

  private finalizeAssistant(): void {
    if (!this.currentAssistantEl || !this.currentAssistantText.trim()) return;
    const el = this.currentAssistantEl;
    const text = this.currentAssistantText;
    el.empty();
    void renderMarkdown(this.plugin.app, el, text, "", this);
    this.currentAssistantEl = null;
    this.currentAssistantText = "";
  }

  private toolHost(): HTMLElement {
    if (this.presentation() !== "grouped") return this.messagesEl;
    let group = this.activityGroups.get(this.currentTurn);
    if (!group) {
      const details = this.messagesEl.createEl("details", { cls: "oc-activity-group" });
      details.createEl("summary", { text: "Agent work" });
      const body = details.createDiv({ cls: "oc-activity-body" });
      group = body;
      this.activityGroups.set(this.currentTurn, group);
    }
    return group;
  }

  private upsertToolCard(call: ToolCallView): void {
    let handle = this.toolCards.get(call.toolCallId);
    if (!handle) {
      const startedAt = Date.now();
      this.toolStartedAt.set(call.toolCallId, startedAt);
      handle = renderToolCard(
        this.toolHost(),
        call,
        {
          renderMarkdown: (el, text) => void renderMarkdown(this.plugin.app, el, text, "", this),
          onOpenLocation: (path, line) => {
            const file = this.plugin.app.vault.getAbstractFileByPath(path.replace(/^.*?\/vault\//, ""));
            if (file) void this.plugin.app.workspace.getLeaf(false).openFile(file as never);
            void line;
          },
        },
        startedAt,
      );
      this.toolCards.set(call.toolCallId, handle);
    } else {
      handle.update(call);
    }
    this.scroll();
  }

  private recordRaw(event: ChatEvent): void {
    if (!event.raw) return;
    const turn = event.turnNumber ?? (this.currentTurn || 0);
    const entry: RawRecordEntry = {
      sessionUpdate: event.raw.sessionUpdate,
      payload: event.raw.payload,
      seq: event.raw.seq,
      late: event.raw.late || event.late,
      turn: turn || undefined,
    };
    if (turn) {
      const list = this.turnRaw.get(turn) ?? [];
      list.push(entry);
      this.turnRaw.set(turn, list);
    }
    this.allRaw.push(entry);
  }

  private renderEvent(event: ChatEvent): void {
    this.recordRaw(event);
    if (event.error) {
      this.showError(event.error.message);
      this.setBusy(false);
      return;
    }
    if (event.turn) {
      this.currentTurn = event.turn.number;
      this.finalizeAssistant();
      const raw = this.turnRaw.get(event.turn.number);
      if (raw?.length) renderRawDisclosure(this.messagesEl, raw);
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
        else this.appendUser(update.text);
        break;
      case "thought":
        if (!this.currentThoughtEl) {
          const details = this.messagesEl.createEl("details", { cls: "oc-thought" });
          details.createEl("summary", { text: "Thought" });
          this.currentThoughtEl = details.createDiv({ cls: "oc-thought-body" });
        }
        this.currentThoughtEl.textContent = (this.currentThoughtEl.textContent ?? "") + update.text;
        break;
      case "tool_call":
        this.upsertToolCard(update.toolCall);
        break;
      default:
        renderUpdate(this.messagesEl, update, {
          renderMarkdown: (el, text) => void renderMarkdown(this.plugin.app, el, text, "", this),
        });
        break;
    }
    this.scroll();
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
    if (/unreachable|timed out|closed before|401|403|device code|host address/i.test(message)) {
      row.createDiv({
        cls: "oc-shell-error-hint",
        text: "No fallback path: the host Obsidian instance must be running and reachable over the VPN (or loopback). Check the host address and device code in settings.",
      });
    }
    if (/approval.*(cancelled|timed out)|timed out.*cancell/i.test(message)) {
      row.createDiv({
        cls: "oc-shell-error-hint",
        text: "The request was cancelled, not approved. The harness will ask again if it still needs permission.",
      });
    }
    if (/api key|credential|auth|provider route/i.test(message)) {
      row.createDiv({
        cls: "oc-shell-error-hint",
        text: "The harness is missing provider credentials. Add the key in the harness's own config or Models page (or export it in the environment that launches Obsidian), then restart the harness.",
      });
    }
    this.scroll();
  }

  // ---------- history ----------

  private async loadHistory(): Promise<void> {
    const runtime = this.plugin.shellRuntime();
    const history = await runtime.history();
    if (history) {
      for (const entry of history.entries) this.renderHistoryEntry(entry);
      this.scroll();
      return;
    }
    if (runtime.mode !== "remote") return;
    try {
      const sessions = await runtime.listSessions();
      if (sessions.length) await runtime.loadSession(sessions[0].sessionId);
      else await runtime.newSession();
    } catch (err) {
      this.showError(`Could not open host history: ${String((err as Error).message ?? err)}`);
    }
  }

  private renderHistoryEntry(entry: RecordEntry): void {
    if (entry.kind === "prompt") {
      const blocks = (entry as { blocks?: Array<{ type?: string; text?: string }> }).blocks ?? [];
      const text = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
      if (text) this.appendUser(text);
      return;
    }
    if (entry.kind === "update") {
      const payload = (entry as { payload?: unknown; seq?: number; turn?: number; sessionUpdate?: string; late?: boolean }).payload;
      this.allRaw.push({
        seq: (entry as { seq?: number }).seq,
        turn: (entry as { turn?: number }).turn,
        sessionUpdate: (entry as { sessionUpdate?: string }).sessionUpdate ?? "unknown",
        payload,
        late: (entry as { late?: boolean }).late,
      });
      const update = payload && typeof payload === "object" && "sessionUpdate" in (payload as object)
        ? mapSessionUpdate(payload as never)
        : (payload as RenderUpdate | undefined);
      if (!update) return;
      if (update.type === "tool_call") this.upsertToolCard(update.toolCall);
      else if (update.type === "message" && update.role === "user") this.appendUser(update.text);
      else if (update.type === "message" && update.role === "agent") {
        this.appendAssistant(update.text);
        this.finalizeAssistant();
      } else renderUpdate(this.messagesEl, update, {});
      return;
    }
    if (entry.kind === "turn") {
      const turn = (entry as { turn?: number }).turn ?? 0;
      this.currentTurn = turn;
      const raw = this.allRaw.filter((item) => item.turn === turn);
      if (raw.length) renderRawDisclosure(this.messagesEl, raw);
      const why = (entry as { interrupted?: boolean; stopReason?: string }).interrupted
        ? "interrupted"
        : (entry as { stopReason?: string }).stopReason ?? "ended";
      this.messagesEl.createDiv({ cls: "oc-shell-status-row", text: `turn ${turn} · ${why}` });
      return;
    }
    if (entry.kind === "error") {
      this.showError((entry as { message?: string }).message ?? "error");
    }
  }

  private async openHistory(): Promise<void> {
    const runtime = this.plugin.shellRuntime();
    try {
      if (!runtime.isConnected) await runtime.connect();
      let sessions = await runtime.listSessions();
      if (!sessions.length && runtime.mode === "local") {
        await this.plugin.importLegacyHistory({ silent: true });
        sessions = await runtime.listSessions();
      }
      new SessionListModal(this.plugin.app, sessions, (sessionId) => {
        void (async () => {
          this.clearTranscript();
          this.setBusy(false);
          try {
            const continuity = await runtime.loadSession(sessionId);
            this.renderControls();
            this.renderContinuity(continuity);
          } catch (err) {
            this.showError(`Could not open that conversation: ${String((err as Error).message ?? err)}`);
          }
          this.updateStatus();
        })();
      }).open();
    } catch (err) {
      this.showError(`Conversation list unavailable: ${String((err as Error).message ?? err)}`);
    }
  }

  /** Explicit continuity choice for a conversation that cannot be resumed:
   *  digest (default), Start fresh, or full-transcript replay. No new session is
   *  created until the user picks one. */
  private renderContinuity(info: ContinuityInfo | null): void {
    this.clearContinuityBar();
    if (!info || info.state === "resume-capable" || info.state === "load-only") return;
    const bar = this.messagesEl.createDiv({ cls: "oc-continuity" });
    this.continuityBar = bar;
    const title = bar.createDiv({ cls: "oc-continuity-title", text: "This conversation isn't attached to the harness yet" });
    void title;
    bar.createDiv({ cls: "oc-continuity-text", text: this.continuityExplanation(info) });
    const buttons = bar.createDiv({ cls: "oc-continuity-actions" });
    const choose = (choice: ContinuityChoice, label: string, primary = false) => {
      const button = buttons.createEl("button", {
        cls: `oc-shell-btn${primary ? " mod-cta" : ""}`,
        text: label,
        attr: { type: "button" },
      });
      button.addEventListener("click", () => {
        this.plugin.shellRuntime().setContinuityChoice(choice);
        for (const child of Array.from(buttons.children)) (child as HTMLButtonElement).disabled = true;
        bar.createDiv({ cls: "oc-continuity-selected", text: `${label} — send a message to continue.` });
      });
    };
    if (info.digestAvailable) choose("digest", "Continue with digest", true);
    choose("fresh", "Start fresh");
    if (info.digestAvailable) choose("full_replay", "Replay full transcript");
  }

  private continuityExplanation(info: ContinuityInfo): string {
    const reasons: Record<string, string> = {
      fingerprint_mismatch: "the harness command changed",
      cwd_mismatch: "the vault folder changed",
      protocol_mismatch: "the harness protocol changed",
      reattach_failed: "the harness no longer has this session",
      no_capability: "the harness can't restore sessions",
      no_harness_session: "this is an older conversation from before the current harness",
      harness_unreachable: "the harness isn't running right now",
      no_content: "the stored conversation is empty",
      record_unreadable: "the stored record couldn't be read",
    };
    const reason = info.reason ? reasons[info.reason] ?? "" : info.warning ? "the harness was updated" : "";
    const suffix = reason ? ` (${reason})` : "";
    if (info.state === "fresh-only") {
      return `Start a fresh harness session on this conversation record${suffix}. Its history stays in the record.`;
    }
    return `Continue from the stored record, or start fresh${suffix}. The transcript stays visible either way; no new session is created until you choose.`;
  }

  private clearContinuityBar(): void {
    this.continuityBar?.remove();
    this.continuityBar = null;
    this.plugin.shellRuntime().setContinuityChoice(null);
  }

  openConnectionInfo(): void {
    const runtime = this.plugin.shellRuntime();
    const info = runtime.clientDebugInfo;
    const host = runtime.hostInfo;
    const debug = {
      baseUrl: info?.label ?? "—",
      connected: info?.state === "connected",
      sessionId: info?.sessionId ?? null,
      retries: info?.retries ?? 0,
      lastError: info?.lastError ?? null,
      mode: runtime.mode === "remote" ? ("remote" as const) : ("relay" as const),
      state: info?.state ?? "idle",
      label: info?.label,
      listener: host ? host.wsUrl : null,
      storePath: runtime.mode === "local" ? this.plugin.settings.sessionStoreFolder : null,
      sessionCount: undefined as number | undefined,
      rawEntries: [...this.allRaw],
    };
    void runtime
      .listSessions()
      .then((sessions) => {
        debug.sessionCount = sessions.length;
        new ConnectionInfoModal(this.plugin.app, debug).open();
      })
      .catch(() => new ConnectionInfoModal(this.plugin.app, debug).open());
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
}

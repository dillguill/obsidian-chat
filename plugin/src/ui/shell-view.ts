/** Chat view: the only chat surface (FR-039…FR-052).
 *
 *  A conversation, not a protocol log. Each turn is a user bubble followed by
 *  the agent's reply: Markdown text segments interleaved with collapsible
 *  "activity" groups that hold compact tool rows, thinking, and unknown
 *  updates. Usage lives in the header; raw ACP stays available through
 *  Connection info. Composer controls come solely from the harness's
 *  declarations. History is store-backed and rendered through the same path.
 */
import { ItemView, Notice, Platform, setIcon, type WorkspaceLeaf } from "obsidian";
import type ObsidianChatPlugin from "../main";
import type { ChatEvent, PendingPermission, PlanEntryView, RenderUpdate, ToolCallView } from "../acp/types.ts";
import { mapSessionUpdate } from "../acp/session-update.ts";
import type { RecordEntry } from "../session/record.ts";
import { renderPermissionCard } from "./approval.ts";
import { SessionListModal } from "./session-list.ts";
import { RenameModal } from "./rename-modal.ts";
import { titleFromText } from "../chat/session-title.ts";
import { effectiveTitle, isPlaceholderTitle } from "../session/title.ts";
import { ConnectionInfoModal } from "./connection-info.ts";
import { composerControlModel, renderComposerControls } from "./controls.ts";
import { AcpSelectSuggestModal } from "./acp-select-suggest.ts";
import { activityPresentation, formatTokens, promptDisplay } from "./renderer.ts";
import { fillPlan, renderRawUpdate, renderToolCard, type ToolCardHandle } from "./transcript.ts";
import type { RawRecordEntry } from "./raw-view.ts";
import { renderMarkdown } from "./markdown.ts";
import { openVaultFilePicker } from "./vault-picker.ts";
import { SlashPickerModal, type SlashItem } from "./slash-picker.ts";
import { catalogText, normalizeFolder, skillBody, skillsIn, type Skill } from "../skills/catalog.ts";
import { isBlacklisted } from "../vault/path-policy.ts";
import { IMAGE_EXT, vaultFileDataUrl } from "./image-picker.ts";
import type { ContinuityChoice, ContinuityInfo } from "../shell/runtime.ts";
import { HISTORY_RENDER_LIMIT } from "../session/limits.ts";

export const SHELL_VIEW_TYPE = "obsidian-chat-acp-shell";

interface ContextChip {
  id: string;
  label: string;
  text: string;
  path?: string;
  kind?: "note" | "selection" | "skill";
}

interface PendingImage {
  name: string;
  mimeType: string;
  data: string;
}

interface TextSegment {
  kind: "text";
  el: HTMLElement;
  text: string;
  timer: number | null;
  gen: number;
}

interface ActivityGroup {
  kind: "activity";
  el: HTMLDetailsElement;
  summary: HTMLElement;
  body: HTMLElement;
  tools: Set<string>;
  thoughts: number;
  others: number;
  thoughtEl: HTMLElement | null;
  done: boolean;
}

/** One agent reply (between a prompt and its turn end). */
interface AgentTurn {
  el: HTMLElement;
  segment: TextSegment | ActivityGroup | null;
  groups: ActivityGroup[];
  planEl: HTMLElement | null;
  typingEl: HTMLElement | null;
  live: boolean;
  userEl: HTMLElement | null;
  userFromEcho: boolean;
}

const STOP_NOTES: Record<string, string> = {
  cancelled: "Stopped",
  max_tokens: "The reply hit the length limit",
  max_turn_requests: "Stopped after too many steps",
  refusal: "The model declined to continue",
};

export class ShellChatView extends ItemView {
  private plugin: ObsidianChatPlugin;
  private messagesEl!: HTMLElement;
  private threadEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private controlsEl!: HTMLElement;
  private titleEl!: HTMLElement;
  /** Set after a user rename: later harness titles do not replace it. */
  private titleLocked = false;
  private statusEl!: HTMLElement;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;
  private usageEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private undoBtn!: HTMLElement;
  private unsubscribers: Array<() => void> = [];
  private busy = false;
  private stick = true;
  private turn: AgentTurn | null = null;
  private toolRows = new Map<string, { handle: ToolCardHandle; group: ActivityGroup }>();
  private allRaw: RawRecordEntry[] = [];
  private currentTurn = 0;
  private contextChips: ContextChip[] = [];
  private pendingImages: PendingImage[] = [];
  private continuityBar: HTMLElement | null = null;
  private handoffBar: HTMLElement | null = null;
  /** Latest context usage ("25k / 1M"); shown in the header, and in
   *  Connection info (the status dot) on mobile where the header is narrow. */
  private usageText: string | null = null;
  private rulesSentFor: string | null = null;
  /** Session the skills catalog was last sent to (once per conversation). */
  private skillsSentFor: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianChatPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SHELL_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Chat";
  }
  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("oc-chat");
    if (Platform.isMobile) root.addClass("oc-chat-mobile");

    // ----- header -----
    const header = root.createDiv({ cls: "oc-chat-header" });
    this.titleEl = header.createDiv({ cls: "oc-chat-title", text: "New chat", attr: { role: "button", "aria-label": "Rename conversation" } });
    this.titleEl.addEventListener("click", () => this.renameCurrent());
    const right = header.createDiv({ cls: "oc-chat-header-right" });
    this.usageEl = right.createSpan({ cls: "oc-chat-usage oc-hidden" });
    this.statusEl = right.createDiv({ cls: "oc-chat-status", attr: { role: "button", "aria-label": "Connection info" } });
    this.statusDot = this.statusEl.createSpan({ cls: "oc-status-dot" });
    this.statusText = this.statusEl.createSpan({ cls: "oc-status-text", text: "Connecting…" });
    this.statusEl.addEventListener("click", () => void this.reconnectIfNeeded());
    this.undoBtn = this.iconButton(right, "undo-2", "Undo the last write", () => void this.undoLastWrite());
    this.undoBtn.addClass("oc-hidden");
    this.iconButton(right, "square-pen", "New chat", () => void this.newSession());
    this.iconButton(right, "history", "Conversations", () => void this.openHistory());

    // ----- transcript -----
    this.messagesEl = root.createDiv({ cls: "oc-chat-scroll" });
    this.messagesEl.addEventListener("scroll", () => {
      const el = this.messagesEl;
      this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    });
    this.threadEl = this.messagesEl.createDiv({ cls: "oc-thread" });
    this.emptyEl = this.threadEl.createDiv({ cls: "oc-empty" });
    setIcon(this.emptyEl.createDiv({ cls: "oc-empty-icon" }), "message-square");
    this.emptyEl.createDiv({ cls: "oc-empty-title", text: "What can I help with?" });
    this.emptyEl.createDiv({
      cls: "oc-empty-hint",
      text: Platform.isMobileApp ? "Ask about your vault." : "Ask about your vault. Type @ to attach a note, / for skills and commands.",
    });

    // ----- composer -----
    const dock = root.createDiv({ cls: "oc-dock" });
    const composer = dock.createDiv({ cls: "oc-composer" });
    this.chipsEl = composer.createDiv({ cls: "oc-chips" });
    this.inputEl = composer.createEl("textarea", { cls: "oc-input" });
    this.inputEl.placeholder = Platform.isMobileApp ? "Message…" : "Message… (Enter to send, Shift+Enter for a new line)";
    this.inputEl.rows = 1;
    const bar = composer.createDiv({ cls: "oc-composer-bar" });
    const left = bar.createDiv({ cls: "oc-composer-left" });
    this.iconButton(left, "paperclip", "Attach an image", () => this.pickImage());
    this.iconButton(left, "at-sign", "Attach a note", () => this.openMentionPicker());
    // "Current note" and "selection" need an editor beside the chat; on mobile
    // the chat fills the screen, so they have nothing to act on.
    if (!Platform.isMobile) {
      this.iconButton(left, "file-plus", "Attach the current note", () => void this.addActiveNoteContext());
      this.iconButton(left, "text-select", "Attach the editor selection", () => this.addSelectionContext());
    }
    const actions = bar.createDiv({ cls: "oc-composer-right" });
    this.controlsEl = actions.createDiv({ cls: "oc-controls" });
    this.stopBtn = actions.createEl("button", { cls: "oc-send oc-stop oc-hidden", attr: { "aria-label": "Stop", title: "Stop (Esc)" } });
    setIcon(this.stopBtn, "square");
    this.sendBtn = actions.createEl("button", { cls: "oc-send", attr: { "aria-label": "Send", title: "Send" } });
    setIcon(this.sendBtn, "arrow-up");

    this.sendBtn.addEventListener("click", () => void this.send());
    this.stopBtn.addEventListener("click", () => void this.cancel());
    composer.addEventListener("click", (event) => {
      if (event.target === composer) this.inputEl.focus();
    });
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
    if (Platform.isMobile) this.watchKeyboard(root);
    this.inputEl.addEventListener("input", () => {
      this.autosize();
      this.updateSendState();
      this.maybeOpenMention();
      this.maybeOpenSlash();
    });

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
    this.updateSendState();
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

  /** Mobile: drop the navbar spacing while the on-screen keyboard is up.
   *  Obsidian makes room for the keyboard by shrinking the app container
   *  (via --keyboard-height, or the webview/body resizing natively), so the
   *  container's own size is the signal: a ResizeObserver fires in the same
   *  frame as that layout change, so the padding neither lags nor jumps ahead
   *  of the keyboard. If no shrink is seen shortly after the input gains
   *  focus, fall back to focus alone. */
  private watchKeyboard(root: HTMLElement): void {
    const container = (document.querySelector(".app-container") as HTMLElement | null) ?? document.body;
    let tallest = 0;
    let fallback = 0;
    let detected = false;
    const keyboardHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height")) || 0;
    const set = (open: boolean) => {
      if (open === root.hasClass("oc-keyboard")) return;
      root.toggleClass("oc-keyboard", open);
      if (this.stick) this.scroll(true);
    };
    const check = () => {
      const height = Math.min(container.getBoundingClientRect().height, window.visualViewport?.height ?? Infinity);
      tallest = Math.max(tallest, height);
      const shrunk = tallest - height > 120;
      const open = shrunk || keyboardHeight() > 0;
      if (open) detected = true;
      set(open || (fallback === -1 && document.activeElement === this.inputEl));
    };
    const observer = new ResizeObserver(check);
    observer.observe(container);
    const styleWatch = new MutationObserver(check);
    styleWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    const onFocus = () => {
      window.clearTimeout(fallback);
      fallback = window.setTimeout(() => {
        if (!detected && document.activeElement === this.inputEl) {
          fallback = -1;
          check();
        }
      }, 350);
    };
    const onBlur = () => {
      window.clearTimeout(fallback);
      fallback = 0;
      window.setTimeout(check, 0);
    };
    const onRotate = () => {
      tallest = 0;
      window.setTimeout(check, 300);
    };
    this.inputEl.addEventListener("focus", onFocus);
    this.inputEl.addEventListener("blur", onBlur);
    window.addEventListener("orientationchange", onRotate);
    this.unsubscribers.push(() => {
      observer.disconnect();
      styleWatch.disconnect();
      window.clearTimeout(fallback);
      window.removeEventListener("orientationchange", onRotate);
    });
    check();
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
    const button = parent.createDiv({ cls: "clickable-icon oc-icon-btn", attr: { "aria-label": label, role: "button" } });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  private autosize(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 280)}px`;
  }

  private updateSendState(): void {
    const ready = !!this.inputEl.value.trim() || this.pendingImages.length > 0;
    this.sendBtn.toggleClass("is-ready", ready);
  }

  private groupsOpenByDefault(): boolean {
    return activityPresentation(this.plugin.settings.activityDensity) === "chronological";
  }

  // ---------- header / status ----------

  private updateStatus(): void {
    const runtime = this.plugin.shellRuntime();
    const info = runtime.clientDebugInfo;
    const state = info?.state ?? "closed";
    let label: string;
    let tone: "ok" | "wait" | "bad" | "warn";
    switch (state) {
      case "connected":
        label = runtime.mode === "remote" ? "Connected to host" : "Connected";
        tone = runtime.vaultToolsAvailable ? "ok" : "warn";
        break;
      case "connecting":
        label = "Connecting…";
        tone = "wait";
        break;
      case "reconnecting":
        label = "Reconnecting…";
        tone = "wait";
        break;
      default:
        label = "Disconnected — retry";
        tone = "bad";
    }
    this.statusText.setText(label);
    this.statusEl.dataset.tone = tone;
    const tips = [info?.label, info?.lastError, state === "connected" && !runtime.vaultToolsAvailable ? runtime.vaultToolsError ?? "vault tools unavailable" : null];
    this.statusEl.setAttr("aria-label", tips.filter(Boolean).join("\n") || label);
    this.undoBtn.toggleClass("oc-hidden", !runtime.pendingUndo());
  }

  private async reconnectIfNeeded(): Promise<void> {
    const runtime = this.plugin.shellRuntime();
    if (runtime.isConnected) {
      this.openConnectionInfo();
      return;
    }
    try {
      await runtime.connect();
    } catch (err) {
      this.showError(String((err as Error).message ?? err));
    }
    this.updateStatus();
    this.renderControls();
  }

  private setUsage(usage: { used: number; size: number; cost?: { amount: number; currency: string } }): void {
    const cost = usage.cost ? ` · ${usage.cost.amount} ${usage.cost.currency}` : "";
    this.usageText = `${formatTokens(usage.used)} / ${formatTokens(usage.size)}${cost}`;
    this.usageEl.setText(this.usageText);
    this.statusEl.setAttr("aria-label", `Connection info · context ${this.usageText}`);
    this.usageEl.setAttr("aria-label", `Context: ${usage.used.toLocaleString()} of ${usage.size.toLocaleString()} tokens`);
    this.usageEl.removeClass("oc-hidden");
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
      icon: Platform.isMobile ? (el) => setIcon(el, "sliders-horizontal") : undefined,
      openPicker: (heading, choices, current, onChoose) => {
        new AcpSelectSuggestModal(this.plugin.app, choices, current, onChoose, heading).open();
      },
      onCommand: (name) => {
        this.inputEl.value = `/${name} `;
        this.inputEl.focus();
        this.updateSendState();
      },
    });
  }

  // ---------- context & attachments ----------

  private renderChips(): void {
    this.chipsEl.empty();
    this.chipsEl.toggleClass("oc-hidden", !this.contextChips.length && !this.pendingImages.length);
    const chip = (icon: string, label: string, onRemove: () => void) => {
      const row = this.chipsEl.createDiv({ cls: "oc-chip" });
      setIcon(row.createSpan({ cls: "oc-chip-icon" }), icon);
      row.createSpan({ cls: "oc-chip-label", text: label });
      const remove = row.createSpan({ cls: "oc-chip-x", attr: { role: "button", "aria-label": "Remove" } });
      setIcon(remove, "x");
      remove.addEventListener("click", onRemove);
    };
    for (const item of this.contextChips) {
      chip(item.kind === "skill" ? "wand-2" : item.id.startsWith("selection:") ? "text-select" : "file-text", item.label, () => {
        this.contextChips = this.contextChips.filter((existing) => existing.id !== item.id);
        this.renderChips();
      });
    }
    for (const image of this.pendingImages) {
      chip("image", image.name, () => {
        this.pendingImages = this.pendingImages.filter((existing) => existing !== image);
        this.renderChips();
        this.updateSendState();
      });
    }
  }

  private addContextChip(chip: ContextChip): void {
    if (this.contextChips.some((existing) => existing.id === chip.id)) return;
    this.contextChips.push(chip);
    this.renderChips();
    this.inputEl.focus();
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
      label: `Selection${file ? ` · ${file.basename}` : ""}`,
      path: file?.path,
      text: selection,
    });
  }

  /** `@` typed at a word start (at the cursor, not only at the end) opens the
   *  note picker; the `@` itself is removed. */
  private maybeOpenMention(): void {
    const input = this.inputEl;
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    if (!/(?:^|\s)@$/.test(before)) return;
    input.value = before.slice(0, -1) + input.value.slice(caret);
    input.setSelectionRange(caret - 1, caret - 1);
    this.autosize();
    this.updateSendState();
    this.openMentionPicker();
  }

  /** Skills in the configured vault folder (this device's synced copy). */
  private skills(): Skill[] {
    const folder = normalizeFolder(this.plugin.settings.skillsFolder);
    if (!folder) return [];
    const { vault, metadataCache } = this.plugin.app;
    const files = vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${folder}/`))
      .map((file) => ({ path: file.path, frontmatter: metadataCache.getFileCache(file)?.frontmatter ?? null }));
    return skillsIn(folder, files);
  }

  /** `/` typed into an empty composer opens the skills/commands picker. */
  private maybeOpenSlash(): void {
    if (this.inputEl.value !== "/") return;
    const runtime = this.plugin.shellRuntime();
    const items: SlashItem[] = [
      ...this.skills().map((skill) => ({ kind: "skill" as const, name: skill.name, description: skill.description, path: skill.path })),
      ...(runtime.commands ?? []).map((command) => ({ kind: "command" as const, name: command.name, description: command.description })),
    ];
    if (!items.length) return; // nothing to pick: keep the literal "/"
    this.inputEl.value = "";
    this.updateSendState();
    new SlashPickerModal(
      this.plugin.app,
      items,
      (item) => void this.chooseSlash(item),
      () => {
        if (!this.inputEl.value) this.inputEl.value = "/";
        this.inputEl.focus();
        this.updateSendState();
      },
    ).open();
  }

  private async chooseSlash(item: SlashItem): Promise<void> {
    if (item.kind === "command") {
      this.inputEl.value = `/${item.name} `;
      this.inputEl.focus();
      this.updateSendState();
      return;
    }
    const file = item.path ? this.plugin.app.vault.getFileByPath(item.path) : null;
    if (!file) return;
    const text = skillBody(await this.plugin.app.vault.read(file));
    this.addContextChip({ id: `skill:${file.path}`, label: item.name, path: file.path, text, kind: "skill" });
  }

  /** Lists this device's own vault copy (synced on mobile too), minus the
   *  blacklisted folders the agent is not allowed to read. */
  private openMentionPicker(): void {
    const blacklist = this.plugin.settings.blacklistFolders;
    const isImage = (ext: string) => IMAGE_EXT.has(ext.toLowerCase());
    openVaultFilePicker(this.plugin.app, {
      // Notes and images only; never a blacklisted folder.
      include: (file) => (file.extension === "md" || isImage(file.extension)) && !isBlacklisted(file.path, blacklist),
      placeholder: "Attach a note or image…",
      onPick: (file) => {
        if (isImage(file.extension)) {
          void this.attachVaultImage(file.path);
          return;
        }
        void this.plugin.app.vault.read(file).then((text) => {
          this.addContextChip({ id: `note:${file.path}`, label: file.basename, path: file.path, text });
        });
      },
    });
  }

  private async attachVaultImage(path: string): Promise<void> {
    const image = await vaultFileDataUrl(this.plugin.app, path);
    const data = image.dataUrl.split(",")[1] ?? "";
    this.pendingImages.push({ name: image.name, mimeType: image.mediaType, data });
    this.renderChips();
    this.updateSendState();
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
        this.updateSendState();
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  /** Attached notes/selections, plus advisory vault rules once per harness
   *  session on a local host. A remote shell never reads the host vault
   *  itself (FR-012). */
  private async buildContext(chips: ContextChip[]): Promise<Array<{ label: string; text: string; path?: string }>> {
    const context = chips.map((chip) =>
      chip.kind === "skill"
        ? { label: `Skill: ${chip.label}`, text: chip.text, path: `Skill: ${chip.label}` }
        : { label: chip.path ? `Context: ${chip.path}` : `Context: ${chip.label}`, text: chip.text, path: chip.path ?? chip.label },
    );
    const runtime = this.plugin.shellRuntime();
    const sessionId = runtime.clientDebugInfo?.sessionId ?? null;
    const skills = this.skills();
    if (skills.length && (sessionId === null || sessionId !== this.skillsSentFor)) {
      context.push({ label: "Skills", text: catalogText(skills), path: "Skills" });
    }
    if (this.plugin.settings.injectVaultRules && runtime.mode === "local" && (sessionId === null || sessionId !== this.rulesSentFor)) {
      for (const candidate of ["AGENTS.md", "vault-rules.md", ".chat/rules.md"]) {
        try {
          const file = this.plugin.app.vault.getAbstractFileByPath(candidate);
          if (file) {
            context.push({ label: `Vault rules: ${candidate}`, text: await this.plugin.app.vault.read(file as never), path: candidate });
            break;
          }
        } catch {
          // advisory only
        }
      }
    }
    return context;
  }

  // ---------- send / cancel / session actions ----------

  private async send(): Promise<void> {
    const typed = this.inputEl.value.trim();
    if ((!typed && !this.pendingImages.length) || this.busy) return;
    this.inputEl.value = "";
    this.autosize();
    this.updateSendState();
    this.setBusy(true);
    const images = [...this.pendingImages];
    const chips = [...this.contextChips];
    this.contextChips = [];
    this.pendingImages = [];
    this.renderChips();
    this.stick = true;
    this.beginTurn(typed, chips.map((chip) => chip.label), images.length, true);
    if (!this.titleLocked && isPlaceholderTitle(this.titleEl.getText()) && typed) this.setTitle(titleFromText(typed));
    try {
      const context = await this.buildContext(chips);
      const runtime = this.plugin.shellRuntime();
      this.clearContinuityBar();
      await runtime.send(typed, { images: images.map(({ mimeType, data }) => ({ mimeType, data })), context });
      this.rulesSentFor = runtime.clientDebugInfo?.sessionId ?? this.rulesSentFor;
      if (this.skills().length) this.skillsSentFor = runtime.clientDebugInfo?.sessionId ?? this.skillsSentFor;
    } catch (err) {
      this.contextChips = chips;
      this.pendingImages = images;
      this.renderChips();
      this.updateSendState();
      this.showError(String((err as Error).message ?? err));
      this.endTurn(undefined);
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
    this.inputEl.focus();
  }

  private clearTranscript(): void {
    this.clearContinuityBar();
    if (this.turn) this.endTurn(undefined);
    this.threadEl.empty();
    this.threadEl.appendChild(this.emptyEl);
    this.emptyEl.removeClass("oc-hidden");
    this.toolRows.clear();
    this.allRaw = [];
    this.currentTurn = 0;
    this.turn = null;
    this.setTitle("New chat", false);
    this.usageEl.addClass("oc-hidden");
    this.usageText = null;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.stopBtn.toggleClass("oc-hidden", !busy);
    this.sendBtn.toggleClass("oc-hidden", busy);
  }

  private scroll(force = false): void {
    if (!force && !this.stick) return;
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  // ---------- transcript model ----------

  private hideEmpty(): void {
    this.emptyEl.addClass("oc-hidden");
  }

  private userBubble(text: string, context: string[], images: number): HTMLElement {
    this.hideEmpty();
    const wrap = this.threadEl.createDiv({ cls: "oc-user" });
    if (context.length || images) {
      const chips = wrap.createDiv({ cls: "oc-user-context" });
      for (const label of context) {
        const chip = chips.createSpan({ cls: "oc-chip oc-chip-static" });
        setIcon(chip.createSpan({ cls: "oc-chip-icon" }), "file-text");
        chip.createSpan({ cls: "oc-chip-label", text: label.replace(/^(Context|Vault rules): /, "").split("/").pop() ?? label });
      }
      if (images) {
        const chip = chips.createSpan({ cls: "oc-chip oc-chip-static" });
        setIcon(chip.createSpan({ cls: "oc-chip-icon" }), "image");
        chip.createSpan({ cls: "oc-chip-label", text: images === 1 ? "1 image" : `${images} images` });
      }
    }
    const bubble = wrap.createDiv({ cls: "oc-user-bubble" });
    bubble.setText(text);
    return bubble;
  }

  /** Starts a turn: optional user bubble, then an (initially empty) agent
   *  reply with a typing indicator while live. */
  private beginTurn(text: string, context: string[], images: number, live: boolean, fromEcho = false): void {
    if (this.turn) this.endTurn(undefined);
    const userEl = text || context.length || images ? this.userBubble(text || (images ? "" : "…"), context, images) : null;
    this.hideEmpty();
    const el = this.threadEl.createDiv({ cls: "oc-agent" });
    const turn: AgentTurn = { el, segment: null, groups: [], planEl: null, typingEl: null, live, userEl, userFromEcho: fromEcho };
    if (live) {
      turn.typingEl = el.createDiv({ cls: "oc-typing" });
      for (let i = 0; i < 3; i += 1) turn.typingEl.createSpan();
    }
    this.turn = turn;
    this.scroll(live);
  }

  private ensureTurn(): AgentTurn {
    if (!this.turn) this.beginTurn("", [], 0, this.busy);
    return this.turn!;
  }

  /** Inserts a new block into the agent reply, keeping the typing indicator last. */
  private place(turn: AgentTurn, el: HTMLElement): void {
    if (turn.typingEl && turn.typingEl.parentElement === turn.el) turn.el.insertBefore(el, turn.typingEl);
    else turn.el.appendChild(el);
  }

  private textSegment(turn: AgentTurn): TextSegment {
    if (turn.segment?.kind === "text") return turn.segment;
    if (turn.segment?.kind === "activity") this.closeGroup(turn.segment);
    const el = createDiv({ cls: "oc-agent-text markdown-rendered" });
    this.place(turn, el);
    const segment: TextSegment = { kind: "text", el, text: "", timer: null, gen: 0 };
    turn.segment = segment;
    return segment;
  }

  private activityGroup(turn: AgentTurn): ActivityGroup {
    if (turn.segment?.kind === "activity") return turn.segment;
    if (turn.segment?.kind === "text") this.flushText(turn.segment, true);
    const el = createEl("details", { cls: "oc-activity" });
    el.open = this.groupsOpenByDefault();
    const summary = el.createEl("summary", { cls: "oc-activity-summary" });
    const body = el.createDiv({ cls: "oc-activity-body" });
    this.place(turn, el);
    const group: ActivityGroup = { kind: "activity", el, summary, body, tools: new Set(), thoughts: 0, others: 0, thoughtEl: null, done: false };
    turn.segment = group;
    turn.groups.push(group);
    this.updateGroupSummary(group);
    return group;
  }

  private closeGroup(group: ActivityGroup): void {
    group.thoughtEl = null;
  }

  private updateGroupSummary(group: ActivityGroup): void {
    const calls = [...group.tools].map((id) => this.toolRows.get(id)?.handle.call).filter((c): c is ToolCallView => !!c);
    const failed = calls.filter((c) => c.status === "failed").length;
    const running = !group.done && calls.some((c) => c.status !== "completed" && c.status !== "failed");
    group.summary.empty();
    const icon = group.summary.createSpan({ cls: "oc-activity-icon" });
    if (!group.done) icon.createSpan({ cls: "oc-spinner" });
    else setIcon(icon, calls.length ? "wrench" : "brain");
    const parts: string[] = [];
    if (calls.length) {
      const last = calls[calls.length - 1];
      if (!group.done) {
        parts.push(running ? last.title ?? last.name ?? "Working…" : "Working…");
      } else {
        parts.push(calls.length === 1 ? `Used ${calls[0].title ?? calls[0].name ?? "a tool"}` : `Used ${calls.length} tools`);
      }
    } else if (group.thoughts) {
      parts.push(group.done ? "Thought" : "Thinking…");
    } else {
      parts.push(group.done ? "Activity" : "Working…");
    }
    group.summary.createSpan({ cls: "oc-activity-label", text: parts.join("") });
    if (failed) group.summary.createSpan({ cls: "oc-activity-failed", text: `${failed} failed` });
    if (!group.done && calls.length) group.summary.createSpan({ cls: "oc-activity-count", text: calls.length === 1 ? "1 step" : `${calls.length} steps` });
    setIcon(group.summary.createSpan({ cls: "oc-activity-chevron" }), "chevron-right");
  }

  private flushText(segment: TextSegment, final: boolean): void {
    if (segment.timer !== null) {
      window.clearTimeout(segment.timer);
      segment.timer = null;
    }
    void this.renderText(segment, final);
  }

  private scheduleText(segment: TextSegment): void {
    if (segment.timer !== null) return;
    segment.timer = window.setTimeout(() => {
      segment.timer = null;
      void this.renderText(segment, false);
    }, 80);
  }

  /** Renders Markdown off-DOM, then swaps it in, so streaming never flashes. */
  private async renderText(segment: TextSegment, final: boolean): Promise<void> {
    const gen = ++segment.gen;
    const text = segment.text;
    if (!text.trim()) {
      if (final) segment.el.remove();
      return;
    }
    const scratch = createDiv();
    try {
      await renderMarkdown(this.plugin.app, scratch, text, "", this);
    } catch {
      scratch.setText(text);
    }
    if (gen !== segment.gen) return;
    segment.el.replaceChildren(...Array.from(scratch.childNodes));
    this.scroll();
  }

  private applyUpdate(update: RenderUpdate): void {
    switch (update.type) {
      case "message": {
        if (update.role === "user") {
          this.applyUserEcho(update.text);
          return;
        }
        if (!update.text) return;
        const turn = this.ensureTurn();
        const segment = this.textSegment(turn);
        segment.text += update.text;
        if (turn.live) this.scheduleText(segment);
        break;
      }
      case "thought": {
        const turn = this.ensureTurn();
        const group = this.activityGroup(turn);
        if (!group.thoughtEl) {
          const details = group.body.createEl("details", { cls: "oc-thought" });
          details.createEl("summary", { text: "Thinking" });
          group.thoughtEl = details.createDiv({ cls: "oc-thought-body" });
          group.thoughts += 1;
          this.updateGroupSummary(group);
        }
        group.thoughtEl.appendText(update.text);
        break;
      }
      case "tool_call": {
        const existing = this.toolRows.get(update.toolCall.toolCallId);
        if (existing) {
          existing.handle.update(update.toolCall);
          this.updateGroupSummary(existing.group);
          break;
        }
        const turn = this.ensureTurn();
        const group = this.activityGroup(turn);
        group.thoughtEl = null;
        const handle = renderToolCard(
          group.body,
          update.toolCall,
          { onOpenLocation: (path) => this.openLocation(path) },
          turn.live ? Date.now() : undefined,
        );
        group.tools.add(update.toolCall.toolCallId);
        this.toolRows.set(update.toolCall.toolCallId, { handle, group });
        this.updateGroupSummary(group);
        break;
      }
      case "plan":
        this.renderPlan(update.entries);
        break;
      case "plan_removed":
        this.turn?.planEl?.remove();
        if (this.turn) this.turn.planEl = null;
        break;
      case "usage":
        this.setUsage(update.usage);
        return;
      case "session_info":
        if (update.title && !this.titleLocked) this.setTitle(update.title);
        return;
      case "raw": {
        // Host-internal replay kinds (continuity, truncation) live in the raw
        // record only; a replayed error is shown as an error.
        if (update.sessionUpdate === "error") {
          this.showError(String((update.payload as { message?: unknown })?.message ?? "error"));
          return;
        }
        if (update.sessionUpdate === "obsidian_chat_store_error") {
          this.showError(String((update.payload as { message?: unknown })?.message ?? "session record write failed"));
          return;
        }
        if (update.sessionUpdate === "obsidian_chat_handoff") {
          this.showHandoff(String((update.payload as { to?: unknown })?.to ?? "another device"));
          return;
        }
        if (update.sessionUpdate.startsWith("obsidian_chat_")) return;
        const turn = this.ensureTurn();
        const group = this.activityGroup(turn);
        renderRawUpdate(group.body, update.sessionUpdate, update.payload);
        group.others += 1;
        this.updateGroupSummary(group);
        break;
      }
      default:
        return;
    }
    this.scroll();
  }

  /** A harness echo / replay of the user's prompt. Ignored when the bubble was
   *  already drawn locally; otherwise it opens (or extends) a turn. */
  private applyUserEcho(text: string): void {
    const display = promptDisplay([{ type: "text", text }]);
    const turn = this.turn;
    if (turn && turn.userEl && !turn.segment) {
      if (turn.userFromEcho) turn.userEl.appendText(text);
      return;
    }
    this.beginTurn(display.text, display.context, 0, this.busy, true);
  }

  private renderPlan(entries: PlanEntryView[]): void {
    const turn = this.ensureTurn();
    if (!turn.planEl) {
      turn.planEl = createDiv({ cls: "oc-plan" });
      turn.el.insertBefore(turn.planEl, turn.el.firstChild);
    }
    fillPlan(turn.planEl, entries);
  }

  private endTurn(stopReason: string | undefined, interrupted = false): void {
    const turn = this.turn;
    if (!turn) {
      this.setBusy(false);
      return;
    }
    if (turn.segment?.kind === "text") this.flushText(turn.segment, true);
    for (const group of turn.groups) {
      group.done = true;
      this.updateGroupSummary(group);
    }
    turn.typingEl?.remove();
    turn.typingEl = null;
    const reason = interrupted ? "cancelled" : stopReason;
    if (reason && reason !== "end_turn") {
      turn.el.createDiv({ cls: "oc-turn-note", text: STOP_NOTES[reason] ?? `Stopped: ${reason}` });
    }
    if (!turn.el.childElementCount) turn.el.remove();
    this.turn = null;
    this.setBusy(false);
    this.scroll();
  }

  private openLocation(path: string): void {
    const file = this.plugin.app.vault.getAbstractFileByPath(path.replace(/^.*?\/vault\//, ""))
      ?? this.plugin.app.vault.getAbstractFileByPath(this.vaultRelative(path));
    if (file) void this.plugin.app.workspace.getLeaf(false).openFile(file as never);
  }

  private vaultRelative(path: string): string {
    const adapter = this.plugin.app.vault.adapter as { getBasePath?: () => string };
    const base = adapter.getBasePath?.();
    return base && path.startsWith(base) ? path.slice(base.length).replace(/^\/+/, "") : path;
  }

  private recordRaw(event: ChatEvent): void {
    if (!event.raw) return;
    const turn = event.turnNumber ?? (this.currentTurn || 0);
    this.allRaw.push({
      sessionUpdate: event.raw.sessionUpdate,
      payload: event.raw.payload,
      seq: event.raw.seq,
      late: event.raw.late || event.late,
      turn: turn || undefined,
    });
  }

  private renderEvent(event: ChatEvent): void {
    this.recordRaw(event);
    if (event.error) {
      this.showError(event.error.message);
      this.endTurn(undefined);
      return;
    }
    if (event.turn) {
      this.currentTurn = event.turn.number;
      this.endTurn(event.turn.stopReason, event.turn.interrupted);
      return;
    }
    if (event.update) this.applyUpdate(event.update);
  }

  private renderPermission(request: PendingPermission): void {
    const host = this.turn?.el ?? this.threadEl;
    const card = renderPermissionCard(createDiv(), request, (optionId) => {
      void this.plugin.shellRuntime().respondPermission(request.requestId, optionId);
    });
    if (this.turn) this.place(this.turn, card);
    else host.appendChild(card);
    this.scroll(true);
  }

  private showError(message: string): void {
    this.hideEmpty();
    const row = createDiv({ cls: "oc-callout oc-callout-error" });
    const head = row.createDiv({ cls: "oc-callout-head" });
    setIcon(head.createSpan({ cls: "oc-callout-icon" }), "alert-circle");
    head.createSpan({ text: message });
    const hint = (text: string) => row.createDiv({ cls: "oc-callout-hint", text });
    if (/local host start failed|loopback host attach failed/i.test(message)) {
      hint("The local listener could not start. On the computer that runs the harness, set Settings → Obsidian Chat → Mode to Local and check the harness command.");
    }
    if (/unreachable|timed out|closed before|401|403|device code|host address/i.test(message)) {
      hint("The host Obsidian must be running and reachable over the VPN (or loopback). Check the host address and device code in settings.");
    }
    if (/approval.*(cancelled|timed out)|timed out.*cancell/i.test(message)) {
      hint("The request was cancelled, not approved. The harness will ask again if it still needs permission.");
    }
    if (/api key|credential|auth|provider route/i.test(message)) {
      hint("The harness is missing provider credentials. Add them in the harness's own config, then restart the harness.");
    }
    if (this.turn) this.place(this.turn, row);
    else this.threadEl.appendChild(row);
    this.scroll(true);
  }

  // ---------- history ----------

  private async loadHistory(): Promise<void> {
    const runtime = this.plugin.shellRuntime();
    const history = await runtime.history();
    if (history) {
      const title = effectiveTitle(history.header, history.entries);
      if (title) this.setTitle(title, history.entries.some((e) => e.kind === "meta" && (e as { source?: string }).source === "user"));
      const total = history.entries.length;
      for (const entry of history.entries) this.collectHistoryRaw(entry);
      const visible = total > HISTORY_RENDER_LIMIT ? history.entries.slice(-HISTORY_RENDER_LIMIT) : history.entries;
      if (total > HISTORY_RENDER_LIMIT) {
        this.hideEmpty();
        this.threadEl.createDiv({ cls: "oc-turn-note", text: `Showing the most recent part of this conversation (${HISTORY_RENDER_LIMIT} of ${total} entries).` });
      }
      for (const entry of visible) this.renderHistoryEntry(entry);
      if (this.turn) this.endTurn(undefined);
      this.scroll(true);
      return;
    }
    if (runtime.mode !== "remote") return;
    // Like the desktop: a newly opened view starts a new chat, or keeps the
    // conversation this device already has open. It never auto-opens the
    // newest shared conversation, which could take it from another device.
    try {
      const current = runtime.clientDebugInfo?.sessionId;
      if (current) await this.openConversation(current);
      else await runtime.newSession();
      this.renderControls();
    } catch (err) {
      this.showError(`Could not open host history: ${String((err as Error).message ?? err)}`);
    }
  }

  private collectHistoryRaw(entry: RecordEntry): void {
    if (entry.kind !== "update") return;
    this.allRaw.push({
      seq: (entry as { seq?: number }).seq,
      turn: (entry as { turn?: number }).turn,
      sessionUpdate: (entry as { sessionUpdate?: string }).sessionUpdate ?? "unknown",
      payload: (entry as { payload?: unknown }).payload,
      late: (entry as { late?: boolean }).late,
    });
  }

  private renderHistoryEntry(entry: RecordEntry): void {
    switch (entry.kind) {
      case "prompt": {
        const display = promptDisplay((entry as { blocks?: unknown }).blocks);
        this.beginTurn(display.text, display.context, display.images, false);
        return;
      }
      case "update": {
        const payload = (entry as { payload?: unknown }).payload;
        const update = payload && typeof payload === "object" && "sessionUpdate" in (payload as object)
          ? mapSessionUpdate(payload as never)
          : (payload as RenderUpdate | undefined);
        if (update) this.applyUpdate(update);
        return;
      }
      case "turn": {
        const turn = entry as { turn?: number; interrupted?: boolean; stopReason?: string };
        this.currentTurn = turn.turn ?? this.currentTurn;
        this.endTurn(turn.stopReason, turn.interrupted === true);
        return;
      }
      case "error":
        this.showError((entry as { message?: string }).message ?? "error");
        return;
      default:
        return;
    }
  }

  private setTitle(title: string, locked = this.titleLocked): void {
    this.titleEl.setText(title);
    this.titleLocked = locked;
  }

  private renameCurrent(): void {
    const runtime = this.plugin.shellRuntime();
    if (!runtime.clientDebugInfo?.sessionId) {
      new Notice("Send a message first; then the conversation can be renamed.");
      return;
    }
    new RenameModal(this.plugin.app, this.titleEl.getText(), (title) => {
      void runtime
        .renameSession(title)
        .then((saved) => this.setTitle(saved, true))
        .catch((err) => this.showError(`Could not rename: ${String((err as Error).message ?? err)}`));
    }).open();
  }

  /** Opens a stored conversation: clears the view, loads it through
   *  session/load (which replays it, and takes control if it is live on
   *  another device), then shows the continuity choice when needed. */
  private async openConversation(sessionId: string, title?: string): Promise<void> {
    const runtime = this.plugin.shellRuntime();
    this.clearTranscript();
    this.clearHandoffBar();
    this.setBusy(false);
    try {
      const continuity = await runtime.loadSession(sessionId);
      // Replay carries no turn markers: close the last replayed turn.
      if (this.turn) this.endTurn(undefined);
      if (title === undefined) title = (await runtime.listSessions()).find((s) => s.sessionId === sessionId)?.title;
      this.setTitle(title || "New chat", false);
      this.renderControls();
      const history = await runtime.history();
      if (history && !this.threadEl.querySelector(".oc-user, .oc-agent")) {
        for (const entry of history.entries) this.collectHistoryRaw(entry);
        const visible = history.entries.slice(-HISTORY_RENDER_LIMIT);
        for (const entry of visible) this.renderHistoryEntry(entry);
        if (this.turn) this.endTurn(undefined);
        this.scroll(true);
      }
      this.renderContinuity(continuity);
    } catch (err) {
      this.showError(`Could not open that conversation: ${String((err as Error).message ?? err)}`);
    }
    this.updateStatus();
  }

  /** Another device opened this conversation and now controls it. */
  private showHandoff(to: string): void {
    this.clearHandoffBar();
    if (this.turn) this.endTurn(undefined);
    this.setBusy(false);
    this.hideEmpty();
    const bar = this.threadEl.createDiv({ cls: "oc-callout oc-handoff" });
    this.handoffBar = bar;
    bar.createDiv({ cls: "oc-callout-head", text: `This conversation moved to ${to}` });
    bar.createDiv({ cls: "oc-callout-hint", text: "Replies now stream there. Take it back to continue here." });
    const actions = bar.createDiv({ cls: "oc-continuity-actions" });
    const back = actions.createEl("button", { cls: "mod-cta", text: "Take it back", attr: { type: "button" } });
    back.addEventListener("click", () => {
      const id = this.plugin.shellRuntime().clientDebugInfo?.sessionId;
      if (id) void this.openConversation(id, this.titleEl.getText());
    });
    this.scroll(true);
  }

  private clearHandoffBar(): void {
    this.handoffBar?.remove();
    this.handoffBar = null;
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
      const onRename = async (sessionId: string, title: string): Promise<string> => {
        const saved = await runtime.renameSession(title, sessionId);
        if (sessionId === runtime.clientDebugInfo?.sessionId) this.setTitle(saved, true);
        return saved;
      };
      new SessionListModal(this.plugin.app, sessions, onRename, (sessionId) => {
        const chosen = sessions.find((session) => session.sessionId === sessionId);
        void this.openConversation(sessionId, chosen?.title);
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
    this.hideEmpty();
    const bar = this.threadEl.createDiv({ cls: "oc-callout oc-continuity" });
    this.continuityBar = bar;
    bar.createDiv({ cls: "oc-callout-head", text: "This conversation isn't attached to the harness yet" });
    bar.createDiv({ cls: "oc-callout-hint", text: this.continuityExplanation(info) });
    const buttons = bar.createDiv({ cls: "oc-continuity-actions" });
    const choose = (choice: ContinuityChoice, label: string, primary = false) => {
      const button = buttons.createEl("button", { cls: primary ? "mod-cta" : "", text: label, attr: { type: "button" } });
      button.addEventListener("click", () => {
        this.plugin.shellRuntime().setContinuityChoice(choice);
        for (const child of Array.from(buttons.children)) (child as HTMLButtonElement).disabled = true;
        bar.createDiv({ cls: "oc-callout-hint", text: `${label} — send a message to continue.` });
        this.inputEl.focus();
      });
    };
    if (info.digestAvailable) choose("digest", "Continue with summary", true);
    choose("fresh", "Start fresh");
    if (info.digestAvailable) choose("full_replay", "Replay full transcript");
    this.scroll(true);
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
      return `Start a fresh harness session on this conversation${suffix}. Its history stays visible.`;
    }
    return `Continue from the stored conversation, or start fresh${suffix}. Nothing is sent until you choose and write a message.`;
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
      context: this.usageText,
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
        this.hideEmpty();
        this.threadEl.createDiv({ cls: "oc-turn-note", text: `Restored ${restored.relPath}` });
        this.scroll(true);
      }
    } catch (err) {
      this.showError(`Undo failed: ${String((err as Error).message ?? err)}`);
    }
    this.updateStatus();
  }
}

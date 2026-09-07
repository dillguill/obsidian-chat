/** Chat view — workspace-style layout (Claude/Claudian-like).
 *  Desktop: right-docked sidebar. Mobile: full-screen page.
 *  No chat bubbles / avatars — a continuous flowing transcript with inline
 *  tool rows (icon + label + checkmark/diff), "Thought for Xs" blocks, and a
 *  composer toolbar (model / agent / thinking / tools). */
import { ItemView, WorkspaceLeaf, Menu, TFile, TFolder, Platform, setIcon, Notice } from "obsidian";
import type ObsidianChatPlugin from "../main";
import type { ChatMessage, RetrievedNote, StreamEvent, ImageAttachment } from "../chat/types";
import { buildRuntime } from "../chat/runtime";
import { GatewaySession } from "../chat/gateway";
import { ChatEngine } from "../chat/engine";
import { buildGrounding, extractWikilinks } from "../chat/ground";
import { retrieveCascade, hasContentSignal } from "../retrieval/cascade";
import type { VaultIndex } from "../retrieval/index";
import { getActiveProvider, thinkingLevelsFor, hasVision } from "../settings";
import { renderMarkdown } from "./markdown";
import { metaToFrontmatter, renderBody, approxTokens } from "../session/store";
import { createApprovalRequester } from "./approval";
import { ModelSuggestModal } from "./model-suggest";
import { SessionSuggestModal } from "./session-suggest";
import { buildModelItems, togglePinnedModel } from "../chat/models";
import { vaultFileDataUrl, VaultImagePickModal, IMAGE_EXT } from "./image-picker";
import { NoteMentionModal, type MentionItem } from "./mention";
import type { ApprovalMode, ThinkingLevel, ChatMode } from "../settings";

export const VIEW_TYPE_CHAT = "obsidian-chat-view";

// Tool calls render as compact slash-command echoes ("/read some-file.md"), not icon rows.
const TOOL_VERBS: Record<string, string> = {
  read_file: "read",
  edit_note: "edit",
  create_note: "new",
  rename_move_file: "move",
  create_folder: "mkdir",
  set_property: "set",
  manage_tags: "tag",
  delete_file: "delete",
  search_vault: "search",
  list_folder: "ls",
  web_search: "web",
  error: "error",
};

// Agent modes — the popover mirrors this list (icon + title + description).
// "Research" is the default research-assistant mode; the others set write-approval.
const AGENT_MODES: { id: ChatMode; icon: string; label: string; desc: string }[] = [
  { id: "research", icon: "search", label: "Research", desc: "Research assistant — pulls notes via tools; writes are gated by approval" },
  { id: "plan", icon: "clipboard-list", label: "Plan", desc: "Explore the vault and present a plan before making any changes" },
  { id: "review", icon: "hand", label: "Review", desc: "Ask for approval before making each edit" },
  { id: "auto", icon: "rocket", label: "Auto", desc: "Apply write tools immediately, no approval needed" },
];

// Thinking (reasoning effort) levels — same popover style as Agent. This is the full
// catalog; which of these actually appear depends on the active model's declared
// support (ProviderConfig.thinkingLevels — see availableThinkingModes below), since
// not every model exposes the same reasoning-effort knobs.
const THINKING_CATALOG: { id: ThinkingLevel; icon: string; label: string; desc: string }[] = [
  { id: "off", icon: "zap-off", label: "Off", desc: "Respond directly, no extended reasoning" },
  { id: "low", icon: "zap", label: "Low", desc: "Light reasoning for straightforward requests" },
  { id: "high", icon: "brain", label: "High", desc: "Deeper reasoning for complex or ambiguous requests" },
];

/** File extensions we can attach as plain text (non-image) context. */
const TEXT_EXT = new Set(["md", "txt", "csv", "tsv", "json", "html", "htm", "xml", "log", "yaml", "yml", "css", "js"]);

export class ChatView extends ItemView {
  private engine: ChatEngine | null = null;
  private gateway: GatewaySession | null = null;
  private messagesEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private composerEl!: HTMLTextAreaElement;
  private modelBtnEl!: HTMLElement;
  private agentBtnEl!: HTMLElement;
  private thinkBtnEl!: HTMLElement;
  private attachBtnEl!: HTMLElement;
  private attachmentsEl!: HTMLElement;
  private pendingImages: ImageAttachment[] = [];
  private pendingTextAttachments: { name: string; content: string }[] = [];
  private slashMenuEl: HTMLElement | null = null;
  private slashIndex = 0;
  private mentionArmed = true;
  private modePopoverEl: HTMLElement | null = null;
  private modePopoverCleanup: (() => void) | null = null;
  private sessionPath = "";
  private streaming = false;
  private citations: string[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: ObsidianChatPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText() {
    return "Obsidian Chat";
  }

  getIcon() {
    return "message-square";
  }

  async onOpen() {
    const c = this.contentEl;
    c.empty();
    c.addClass("oc-view");

    // ---- header ----
    // On mobile the view opens as a full page under Obsidian's own native top bar
    // (back button, title, menu) — a second custom header row right below it would
    // just duplicate that chrome. So on mobile, History/New-session become native
    // view actions (they land in that same native bar) and we skip our own header
    // entirely; on desktop (docked sidebar, no native per-view bar) we keep the
    // custom brand header.
    if (Platform.isMobile) {
      this.addAction("history", "History", () => this.showHistory());
      this.addAction("plus", "New session", () => this.newSession());
    } else {
      const header = c.createDiv({ cls: "oc-header" });
      const title = header.createDiv({ cls: "oc-header-title" });
      setIcon(title.createSpan({ cls: "oc-app-icon" }), "bot");
      title.createEl("span", { text: "Obsidian Chat", cls: "oc-app-name" });
      const hActions = header.createDiv({ cls: "oc-header-actions" });
      const hist = hActions.createEl("button", { cls: "oc-icon-btn", attr: { "aria-label": "History", title: "History" } });
      setIcon(hist, "history");
      hist.addEventListener("click", () => this.showHistory());
      const plus = hActions.createEl("button", { cls: "oc-icon-btn", attr: { "aria-label": "New session", title: "New session" } });
      setIcon(plus, "plus");
      plus.addEventListener("click", () => this.newSession());
    }

    // ---- transcript ----
    const messages = c.createDiv({ cls: "oc-messages" });
    this.messagesEl = messages;

    // ---- context chips (citations / attachments) ----
    const chips = c.createDiv({ cls: "oc-chips" });
    this.chipsEl = chips;

    // ---- composer ----
    // One bordered card holds both the input row and the mode-chip toolbar below it
    // (divided by a hairline), so the whole card — not just whitespace — is what
    // separates the composer from the flowing transcript above.
    const composer = c.createDiv({ cls: "oc-composer" });
    const box = composer.createDiv({ cls: "oc-inputbox" });
    // Pending image attachments render as a compact pill row at the top of the card.
    this.attachmentsEl = box.createDiv({ cls: "oc-attachments" });
    this.attachmentsEl.style.display = "none";
    const inputRow = box.createDiv({ cls: "oc-input-row" });
    const ta = inputRow.createEl("textarea", {
      cls: "oc-input",
      attr: { placeholder: "Ask Obsidian Chat anything…\n(Enter to send, Shift+Enter for newline)", rows: "2", "aria-label": "Message" },
    });
    this.composerEl = ta as HTMLTextAreaElement;
    ta.addEventListener("paste", (e) => this.handlePaste(e));
    // Send floats inside the input row (bottom-right corner) so the toolbar row below
    // is free to just be the three mode chips.
    const sendBtn = inputRow.createEl("button", { cls: "oc-send", attr: { "aria-label": "Send" } });
    setIcon(sendBtn, "arrow-up");
    sendBtn.addEventListener("click", () => this.send());
    ta.addEventListener("keydown", (e) => {
      if (this.slashMenuEl) {
        if (e.key === "ArrowDown") { e.preventDefault(); this.moveSlash(1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); this.moveSlash(-1); return; }
        if (e.key === "Enter") { e.preventDefault(); this.runSlash(this.slashIndex); return; }
        if (e.key === "Escape") { this.hideSlash(); return; }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
      this.updateSlashMenu();
      this.maybeOpenMention();
    });
    // ---- composer toolbar: a single row of mode chips [model ▾][thinking][agent] ----
    // Lives inside the same card as the input, below a hairline divider.
    // (send lives in the input row above; tool enable/disable lives in Settings)
    const toolbar = box.createDiv({ cls: "oc-toolbar" });

    // Model keeps its label on mobile (it's the one thing worth reading at a glance);
    // thinking/agent collapse to icon-only there — see the mobile media query.
    // "Attach" button — left of the model selector. Opens a device file picker
    // (images + text files) or the vault image picker.
    this.attachBtnEl = toolbar.createEl("button", { cls: "oc-toolbtn oc-toolbtn-attach" });
    setIcon(this.attachBtnEl.createSpan({ cls: "oc-toolbtn-icon" }), "plus");
    this.attachBtnEl.setAttribute("title", "Attach a file / image");
    this.attachBtnEl.addEventListener("click", () => this.openAttachMenu());

    this.modelBtnEl = toolbar.createEl("button", { cls: "oc-toolbtn oc-toolbtn-model" });
    setIcon(this.modelBtnEl.createSpan({ cls: "oc-toolbtn-icon" }), "cpu");
    this.modelBtnEl.createSpan({ cls: "oc-toolbtn-text" });
    setIcon(this.modelBtnEl.createSpan({ cls: "oc-toolbtn-chevron" }), "chevron-down");
    this.modelBtnEl.addEventListener("click", () => void this.openModelPicker());

    this.thinkBtnEl = toolbar.createEl("button", { cls: "oc-toolbtn oc-toolbtn-think" });
    this.thinkBtnEl.createSpan({ cls: "oc-toolbtn-icon" });
    this.thinkBtnEl.createSpan({ cls: "oc-toolbtn-text" });
    this.thinkBtnEl.addEventListener("click", () => (this.modePopoverEl ? this.hideModePopover() : this.showThinkingMenu()));

    this.agentBtnEl = toolbar.createEl("button", { cls: "oc-toolbtn oc-toolbtn-agent" });
    this.agentBtnEl.createSpan({ cls: "oc-toolbtn-icon" });
    this.agentBtnEl.createSpan({ cls: "oc-toolbtn-text" });
    this.agentBtnEl.addEventListener("click", () => (this.modePopoverEl ? this.hideModePopover() : this.showAgentMenu()));

    await this.refreshToolbar();
    // Warm the vault index so @-mentions can offer notes immediately.
    void this.plugin.index.ensureLoaded();
    this.addSystemMessage("Ask a question — I'll ground it in your vault.");
  }

  // ---------- transcript rendering (workspace style) ----------

  private addSystemMessage(text: string) {
    const el = this.messagesEl.createDiv({ cls: "oc-system" });
    el.setText(text);
    this.scrollToBottom();
    return el;
  }

  private addUserMessage(text: string, images?: ImageAttachment[]) {
    const el = this.messagesEl.createDiv({ cls: "oc-block oc-user" });
    const md = el.createDiv({ cls: "oc-body-md" });
    renderMarkdown(this.plugin.app, md, text, this.sessionPath, this).catch(() => md.setText(text));
    if (images?.length) {
      const row = el.createDiv({ cls: "oc-user-images" });
      for (const img of images) {
        row.createEl("img", { cls: "oc-user-img", attr: { src: img.dataUrl, alt: img.name ?? "image" } });
      }
    }
    this.scrollToBottom();
    return md;
  }

  private beginAssistantMessage(): HTMLElement {
    const el = this.messagesEl.createDiv({ cls: "oc-block oc-assistant" });
    const md = el.createDiv({ cls: "oc-body-md" });
    el.createSpan({ cls: "oc-caret" });
    this.scrollToBottom();
    return md;
  }

  /** Compact slash-command echo, e.g. "/read some-file.md". The "/verb" prefix already
   *  marks it as a tool call and errors get their own red "/error" row, so there's no
   *  separate status icon — "ok" is a no-op; anything else (e.g. "+18 -1") renders as a diff. */
  private addToolRow(name: string, detail: string, status?: "ok" | "error" | string) {
    const row = this.messagesEl.createDiv({ cls: "oc-tool" + (name === "error" ? " oc-tool-error" : "") });
    row.createSpan({ cls: "oc-tool-verb", text: `/${TOOL_VERBS[name] ?? name}` });
    row.createSpan({ cls: "oc-tool-label", text: detail || name });
    if (status && status !== "ok" && status !== "error") {
      this.renderDiffStat(row.createSpan({ cls: "oc-tool-right" }), status);
    }
    this.scrollToBottom();
    return row;
  }

  /** Renders a "+N -M" style diff summary with colored spans; falls back to plain text. */
  private renderDiffStat(el: HTMLElement, status: string) {
    const m = status.match(/^\+(\d+)\s*-(\d+)$/);
    if (!m) {
      el.setText(status);
      return;
    }
    el.createSpan({ cls: "oc-diff-add", text: `+${m[1]}` });
    el.createSpan({ text: " " });
    el.createSpan({ cls: "oc-diff-del", text: `-${m[2]}` });
  }

  private addThought(text: string) {
    const el = this.messagesEl.createDiv({ cls: "oc-thought" });
    el.createDiv({ cls: "oc-thought-label", text: "Thought" });
    const body = el.createDiv({ cls: "oc-thought-body" });
    body.setText(text);
    this.scrollToBottom();
    return body;
  }

  private scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private streamInto(md: HTMLElement, text: string) {
    renderMarkdown(this.plugin.app, md, text, this.sessionPath, this)
      .catch(() => md.setText(text))
      .finally(() => {
        md.addClass("streaming");
        this.scrollToBottom();
      });
  }

  // ---------- grounding / context ----------

  private async ground(query: string): Promise<{ systemPrompt: string; citations: string[] }> {
    const idx = this.plugin.index;
    // Explicitly @-mentioned notes (e.g. `[[Inbox/Project-AI]]`) are always attached.
    const mentioned = await this.attachMentions(query, idx);

    // Research (tools) mode: no notes pre-loaded; the model pulls them with
    // search_vault/read_file. Auto mode: retrieve top-k notes (old behavior).
    if (this.plugin.settings.groundingMode !== "auto") {
      return this.assembleGrounding(query, mentioned);
    }
    if (!hasContentSignal(query)) return this.assembleGrounding(query, mentioned);

    await idx.ensureLoaded(() => this.setStatus("indexing vault…"));
    const docs = idx.getAll();
    const retrieved = retrieveCascade(query, docs, {
      topK: this.plugin.settings.retrievalK,
      useGraph: true,
    });
    const mentionedRels = new Set(mentioned.map((n) => n.rel));
    const notes = [...mentioned, ...retrieved.filter((n) => !mentionedRels.has(n.rel))];
    return this.assembleGrounding(query, notes);
  }

  /** Attach the content of any `[[wikilink]]` targets in the query. */
  private async attachMentions(query: string, idx: VaultIndex): Promise<RetrievedNote[]> {
    const targets = extractWikilinks(query);
    if (!targets.length) return [];
    await idx.ensureLoaded(() => this.setStatus("indexing vault…"));
    const docs = idx.getAll();
    const out: RetrievedNote[] = [];
    for (const target of targets) {
      const doc = docs.find((d) => d.rel.replace(/\.md$/, "") === target);
      if (!doc) continue;
      try {
        const full = await idx.read(doc.rel);
        out.push({ rel: doc.rel, score: 1, snippet: full.length > 2000 ? full.slice(0, 2000) + "\n…" : full });
      } catch {
        /* blacklisted/unreadable note — skip */
      }
    }
    return out;
  }

  /** Assemble the system prompt from notes + vault rules + attached files. */
  private async assembleGrounding(query: string, notes: RetrievedNote[]): Promise<{ systemPrompt: string; citations: string[] }> {
    let vaultRules: string | undefined;
    if (this.plugin.settings.injectVaultRules) {
      for (const p of ["vault-rules.md", ".chat/rules.md", "AGENTS.md"]) {
        const f = this.plugin.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) {
          vaultRules = (vaultRules ? vaultRules + "\n\n" : "") + (await this.plugin.app.vault.cachedRead(f));
        }
      }
      // Nearest-wins folder rules for the primary note (closest .chat/rules.md wins).
      const primary = notes[0]?.rel;
      if (primary) {
        const folderRules = await this.readNearestFolderRules(primary);
        if (folderRules) vaultRules = (vaultRules ? vaultRules + "\n\n" : "") + folderRules;
      }
    }
    const g = buildGrounding(query, notes, { vaultRules });
    if (this.pendingTextAttachments.length) {
      const block = this.pendingTextAttachments
        .map((a) => `# Attached file: ${a.name}\n${a.content.slice(0, 4000)}`)
        .join("\n\n");
      g.systemPrompt += `\n\n${block}`;
    }
    this.renderChips(g.citations);
    return g;
  }

  /** Read `.chat/rules.md` from the folder of a note (nearest to the note wins). */
  private async readNearestFolderRules(path: string): Promise<string> {
    const folders = path.split("/").slice(0, -1);
    for (let i = folders.length; i >= 1; i--) {
      const p = folders.slice(0, i).join("/") + "/.chat/rules.md";
      const f = this.plugin.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) return this.plugin.app.vault.cachedRead(f);
    }
    return "";
  }

  private renderChips(citations: string[]) {
    this.citations = citations;
    this.chipsEl.empty();
    for (const cite of citations) {
      const chip = this.chipsEl.createDiv({ cls: "oc-chip" });
      setIcon(chip.createSpan({ cls: "oc-chip-icon" }), "file-text");
      chip.createSpan({ cls: "oc-chip-label", text: cite.replace(/\.md$/, "") });
      const x = chip.createEl("button", { cls: "oc-chip-x", attr: { "aria-label": "Remove context" } });
      setIcon(x, "x");
      x.addEventListener("click", () => {
        this.citations = this.citations.filter((c) => c !== cite);
        chip.remove();
      });
    }
  }

  private makeRuntime() {
    return buildRuntime(getActiveProvider(this.plugin.settings));
  }

  // ---------- vision attachments ----------

  private visionEnabled(): boolean {
    return hasVision(getActiveProvider(this.plugin.settings));
  }

  private handlePaste(e: ClipboardEvent) {
    if (!this.visionEnabled()) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          this.addPendingImageFromFile(file);
        }
      }
    }
  }

  private openAttachMenu() {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("From device…").setIcon("plus").onClick(() => this.pickFileFromDevice()));
    if (this.visionEnabled()) {
      menu.addItem((i) => i.setTitle("From vault…").setIcon("library").onClick(() => this.pickImageFromVault()));
    }
    const r = this.attachBtnEl.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  private pickFileFromDevice() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,text/*,application/json,.md,.txt,.csv,.tsv,.html,.htm,.xml,.log,.yaml,.yml";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      const files = input.files;
      if (files) {
        for (let i = 0; i < files.length; i++) this.addFileFromDevice(files[i]);
      }
      input.remove();
    };
    input.click();
  }

  private addFileFromDevice(file: File) {
    if (file.type.startsWith("image/")) {
      this.addPendingImageFromFile(file);
      return;
    }
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const isText = TEXT_EXT.has(ext) || file.type.startsWith("text/") || file.type === "application/json";
    if (!isText) {
      new Notice(`Can't attach ${file.name} — unsupported type`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      if (!content.trim()) return;
      this.pendingTextAttachments.push({ name: file.name, content });
      this.renderAttachments();
    };
    reader.onerror = () => new Notice(`Couldn't read ${file.name}`);
    reader.readAsText(file);
  }

  private pickImageFromVault() {
    if (!this.visionEnabled()) return;
    new VaultImagePickModal(this.plugin.app, async (path) => {
      try {
        const img = await vaultFileDataUrl(this.plugin.app, path);
        this.pendingImages.push(img);
        this.renderAttachments();
      } catch (err) {
        new Notice(`Couldn't read image: ${String((err as Error).message ?? err)}`);
      }
    }).open();
  }

  private addPendingImageFromFile(file: File) {
    if (!this.visionEnabled()) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      this.pendingImages.push({ dataUrl, mediaType: file.type || "image/png", name: file.name || "pasted image" });
      this.renderAttachments();
    };
    reader.readAsDataURL(file);
  }

  private renderAttachments() {
    const el = this.attachmentsEl;
    el.empty();
    const hasAny = this.pendingImages.length > 0 || this.pendingTextAttachments.length > 0;
    if (!hasAny) {
      el.style.display = "none";
      return;
    }
    el.style.display = "flex";
    for (const [i, img] of this.pendingImages.entries()) {
      const pill = el.createDiv({ cls: "oc-attach" });
      pill.createEl("img", { cls: "oc-attach-thumb", attr: { src: img.dataUrl, alt: img.name ?? "image" } });
      const meta = pill.createDiv({ cls: "oc-attach-meta" });
      meta.createDiv({ cls: "oc-attach-name", text: img.name ?? "image" });
      const x = pill.createEl("button", { cls: "oc-attach-x", attr: { "aria-label": "Remove image", type: "button" } });
      setIcon(x, "x");
      x.addEventListener("click", () => {
        this.pendingImages.splice(i, 1);
        this.renderAttachments();
      });
    }
    for (const [i, att] of this.pendingTextAttachments.entries()) {
      const pill = el.createDiv({ cls: "oc-attach oc-attach-file" });
      const meta = pill.createDiv({ cls: "oc-attach-meta" });
      meta.createDiv({ cls: "oc-attach-name", text: att.name });
      const x = pill.createEl("button", { cls: "oc-attach-x", attr: { "aria-label": "Remove file", type: "button" } });
      setIcon(x, "x");
      x.addEventListener("click", () => {
        this.pendingTextAttachments.splice(i, 1);
        this.renderAttachments();
      });
    }
  }

  private clearPendingAttachments() {
    this.pendingImages = [];
    this.pendingTextAttachments = [];
    this.renderAttachments();
  }

  private async prefersGateway(): Promise<boolean> {
    const s = this.plugin.settings;
    const mobile = Platform.isMobile;
    return (s.preferGateway || mobile) && !!s.gateway.baseUrl && !!s.gateway.token;
  }

  // ---------- send / stream ----------

  private async send() {
    const text = this.composerEl.value.trim();
    if (!text || this.streaming) return;
    if (text.startsWith("/") && !this.slashMenuEl) {
      this.runSlashCommand(ChatView.COMMANDS.find((cc) => cc.name === text.trim().split(" ")[0]) ?? { name: text, hint: "" });
      this.composerEl.value = "";
      return;
    }
    this.composerEl.value = "";
    this.streaming = true;
    this.addUserMessage(text, this.pendingImages);
    this.lastAssistantText = "";
    this.gatewayMsgBase = null;

    const useGateway = await this.prefersGateway();
    try {
      if (useGateway) await this.sendViaGateway(text);
      else await this.sendViaProvider(text);
    } catch (err) {
      this.addToolRow("error", `Error: ${String((err as Error).message ?? err)}`, "error");
    } finally {
      this.clearPendingAttachments();
      this.streaming = false;
      await this.refreshToolbar();
    }
  }

  private async sendViaProvider(text: string) {
    let ground: { systemPrompt: string; citations: string[] } = { systemPrompt: "", citations: [] };
    try {
      ground = await this.ground(text);
    } catch (err) {
      this.addToolRow("error", `Grounding failed: ${String((err as Error).message ?? err)}`, "error");
    }
    const runtime = this.makeRuntime();
    const s = this.plugin.settings;
    const model = getActiveProvider(s).model;
    let assistantMd: HTMLElement | null = null;
    let acc = "";

    const approver = createApprovalRequester(this.plugin.app, s, () => this.plugin.saveSettings());
    const eng = new ChatEngine({
      runtime,
      model,
      tools: this.enabledToolDefinitions(),
      maxToolRounds: s.maxToolRounds,
      tokenBudget: s.tokenBudget,
      ground: async () => ground,
      executeTool: (name, args) => this.plugin.tools.execWithApproval(name, args, this.plugin.index, approver),
      onEvent: (e) => {
        if (e.type === "token") {
          acc += e.text;
          if (!assistantMd) assistantMd = this.beginAssistantMessage();
          this.streamInto(assistantMd, acc);
        } else if (e.type === "done") {
          if (assistantMd) assistantMd.removeClass("streaming");
          assistantMd = null;
        } else {
          this.handleStreamEvent(e);
        }
      },
    });
    this.engine = eng;
    try {
      await eng.ask(text, undefined, this.pendingImages);
    } finally {
      // Persist the session even if the turn errored, so a record always lands in the folder.
      try {
        await this.persistSession(eng.getHistory());
      } catch (err) {
        new Notice(`Couldn't save session: ${String((err as Error).message ?? err)}`);
      }
    }
  }

  private async sendViaGateway(text: string) {
    const ground = await this.ground(text);
    const s = this.plugin.settings;
    if (!this.gateway) {
      this.gateway = new GatewaySession({ baseUrl: s.gateway.baseUrl, token: s.gateway.token, model: s.gateway.model || undefined });
      this.gateway.onEvent((e) => this.handleStreamEvent(e));
    }
    await this.gateway.connect();
    const history = this.engine ? (this.engine.getHistory() as ChatMessage[]) : [];
    const messages: ChatMessage[] = [
      { role: "system", content: ground.systemPrompt },
      ...history,
      { role: "user", content: text, images: this.pendingImages.length ? this.pendingImages : undefined },
    ];
    // Remember the base so we can persist the turn once the assistant stream ends.
    this.gatewayMsgBase = messages;
    await this.gateway.sendCompletion(messages, s.gateway.model);
  }

  private async handleStreamEvent(e: StreamEvent) {
    switch (e.type) {
      case "token":
        if (!this.pendingAssistantMd) this.pendingAssistantMd = this.beginAssistantMessage();
        this.pendingAcc += e.text;
        this.lastAssistantText += e.text;
        this.streamInto(this.pendingAssistantMd, this.pendingAcc);
        break;
      case "reasoning":
        this.addThought(e.text);
        break;
      case "tool_call":
        this.addToolRow(e.name, e.name, "ok");
        break;
      case "done":
        if (this.pendingAssistantMd) this.pendingAssistantMd.removeClass("streaming");
        this.pendingAssistantMd = null;
        this.pendingAcc = "";
        if (this.gatewayMsgBase) {
          const base = this.gatewayMsgBase;
          this.gatewayMsgBase = null;
          const final: ChatMessage[] = [...base, { role: "assistant", content: this.lastAssistantText }];
          this.lastAssistantText = "";
          try {
            await this.persistSession(final);
          } catch (err) {
            new Notice(`Couldn't save session: ${String((err as Error).message ?? err)}`);
          }
        }
        break;
      case "error":
        this.addToolRow("error", e.message, "error");
        break;
    }
  }

  private pendingAssistantMd: HTMLElement | null = null;
  private pendingAcc = "";
  private lastAssistantText = "";
  private gatewayMsgBase: ChatMessage[] | null = null;

  /** Normalized chat session folder (user-configurable, default "chat"). */
  private sessionFolder(): string {
    const f = (this.plugin.settings.chatFolder ?? "").trim().replace(/^\/+|\/+$/g, "");
    return f || "chat";
  }

  private async persistSession(messages: ChatMessage[]) {
    if (!this.sessionPath) {
      const folderPath = this.sessionFolder();
      const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
      if (!folder) await this.plugin.app.vault.createFolder(folderPath);
      const name = `session-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
      this.sessionPath = `${folderPath}/${name}.md`;
    }
    const meta = {
      model: getActiveProvider(this.plugin.settings).model,
      provider: getActiveProvider(this.plugin.settings).name,
      created: Date.now(),
      updated: Date.now(),
      tokens: approxTokens(messages),
    };
    const body = metaToFrontmatter(meta) + "\n" + renderBody("Chat session", messages);
    const f = this.plugin.app.vault.getAbstractFileByPath(this.sessionPath);
    if (f instanceof TFile) await this.plugin.app.vault.modify(f, body);
    else await this.plugin.app.vault.create(this.sessionPath, body);
  }

  private async newSession() {
    this.hideSlash();
    this.messagesEl.empty();
    this.renderChips([]);
    this.sessionPath = "";
    this.engine?.clear();
    if (this.gateway) {
      await this.gateway.close();
      this.gateway = null;
    }
    this.addSystemMessage("New session.");
  }

  // ---------- history ----------

  private async showHistory() {
    const folder = this.plugin.app.vault.getAbstractFileByPath(this.sessionFolder());
    const children = folder instanceof TFolder ? (folder.children ?? []) : [];
    const sessions: TFile[] = children
      .filter((f): f is TFile => f instanceof TFile && f.path.endsWith(".md"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    if (!sessions.length) {
      new Notice("No sessions yet");
      return;
    }
    new SessionSuggestModal(this.plugin.app, sessions, (f) => this.loadSession(f.path)).open();
  }

  private async loadSession(path: string) {
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    const body = await this.plugin.app.vault.cachedRead(f);
    this.messagesEl.empty();
    this.sessionPath = path;
    // Parse the saved body into display blocks; honor # title and ## role (time)
    const lines = body.split("\n");
    let pendingRole: ChatMessage["role"] | null = null;
    let pendingBuf: string[] = [];
    const flush = () => {
      const text = pendingBuf.join("\n").trim();
      if (pendingRole && text) {
        if (pendingRole === "user") this.addUserMessage(text);
        else if (pendingRole === "assistant") {
          const md = this.beginAssistantMessage();
          renderMarkdown(this.plugin.app, md, text, path, this).catch(() => {});
        } else if (pendingRole === "system") {
          this.addSystemMessage(text);
        } else {
          this.addToolRow("tool", text, "ok");
        }
      }
      pendingBuf = [];
    };
    for (const line of lines) {
      const m = line.match(/^## (👤 User|🤖 Assistant|🔑 System|🔧 Tool)/);
      if (m) {
        flush();
        pendingRole = m[1].includes("User") ? "user" : m[1].includes("Assistant") ? "assistant" : m[1].includes("System") ? "system" : "tool";
      } else if (line.startsWith("#")) {
        flush();
        pendingRole = null;
      } else {
        pendingBuf.push(line);
      }
    }
    flush();
    this.scrollToBottom();
  }

  // ---------- composer toolbar ----------

  private async refreshToolbar() {
    const s = this.plugin.settings;
    const active = getActiveProvider(s);
    // model selector — title doubles as the tooltip once mobile collapses the label to an icon.
    this.modelBtnEl.find(".oc-toolbtn-text").setText(active.model);
    this.modelBtnEl.setAttribute("title", `Model: ${active.model}`);
    // agent (approval) mode — icon + label track the active mode
    const mode = AGENT_MODES.find((m) => m.id === s.mode) ?? AGENT_MODES[0];
    setIcon(this.agentBtnEl.find(".oc-toolbtn-icon"), mode.icon);
    this.agentBtnEl.find(".oc-toolbtn-text").setText(mode.label);
    this.agentBtnEl.setAttribute("title", `Agent mode: ${mode.label}`);
    // thinking level — icon + label track the active level; the option set itself
    // depends on what the active model declares support for (see availableThinkingModes).
    const thinkModes = this.availableThinkingModes();
    const think = thinkModes.find((m) => m.id === s.thinkingLevel) ?? thinkModes[0];
    this.thinkBtnEl.toggleClass("oc-toolbtn-disabled", !think);
    setIcon(this.thinkBtnEl.find(".oc-toolbtn-icon"), think?.icon ?? "zap-off");
    this.thinkBtnEl.find(".oc-toolbtn-text").setText(think?.label ?? "N/A");
    this.thinkBtnEl.setAttribute("title", `Thinking: ${think?.label ?? "N/A"}`);

    // attach button always visible (files + images)
    this.attachBtnEl.setAttribute("title", "Attach a file / image");
  }

  /** The reasoning levels the active model actually supports (a subset of THINKING_CATALOG). */
  private availableThinkingModes() {
    const allowed = thinkingLevelsFor(getActiveProvider(this.plugin.settings));
    return THINKING_CATALOG.filter((m) => allowed.includes(m.id));
  }

  private async openModelPicker() {
    const s = this.plugin.settings;
    const items = await buildModelItems(s);
    new ModelSuggestModal(
      this.plugin.app,
      items,
      (item) => {
        const prov = s.providers.find((p) => p.id === item.providerId);
        if (!prov) return;
        s.activeProviderId = prov.id;
        prov.model = item.model;
        this.plugin.saveSettings();
        this.refreshToolbar();
      },
      (item) => {
        const pinned = togglePinnedModel(s, item);
        this.plugin.saveSettings();
        return pinned;
      }
    ).open();
  }

  private showAgentMenu() {
    const s = this.plugin.settings;
    this.showModePopover(this.agentBtnEl, AGENT_MODES, s.mode, (m) => {
      s.mode = m.id;
      if (m.id !== "research") s.approvalMode = m.id;
      this.plugin.saveSettings();
      this.refreshToolbar();
      this.addSystemMessage(`Agent mode: ${m.label} — ${m.desc}`);
    });
  }

  private showThinkingMenu() {
    const s = this.plugin.settings;
    const modes = this.availableThinkingModes();
    if (!modes.length) {
      new Notice("This model doesn't support extended reasoning.");
      return;
    }
    this.showModePopover(this.thinkBtnEl, modes, s.thinkingLevel, (m) => {
      s.thinkingLevel = m.id;
      this.plugin.saveSettings();
      this.refreshToolbar();
    });
  }

  /** Shared icon+title+description popover used by both the Agent and Thinking selectors. */
  private showModePopover<T extends string>(
    anchorEl: HTMLElement,
    modes: { id: T; icon: string; label: string; desc: string }[],
    currentId: T,
    onSelect: (mode: { id: T; icon: string; label: string; desc: string }) => void,
  ) {
    this.hideModePopover();
    const btnRect = anchorEl.getBoundingClientRect();
    const hostRect = this.contentEl.getBoundingClientRect();
    const pop = this.contentEl.createDiv({ cls: "oc-agent-popover" });
    this.modePopoverEl = pop;
    pop.style.right = `${Math.max(14, hostRect.right - btnRect.right)}px`;
    pop.style.bottom = `${hostRect.bottom - btnRect.top + 8}px`;

    for (const m of modes) {
      const sel = m.id === currentId;
      const item = pop.createDiv({ cls: "oc-agent-item" + (sel ? " sel" : "") });
      setIcon(item.createDiv({ cls: "oc-agent-item-icon" }), m.icon);
      const body = item.createDiv({ cls: "oc-agent-item-body" });
      body.createDiv({ cls: "oc-agent-item-title", text: m.label });
      body.createDiv({ cls: "oc-agent-item-desc", text: m.desc });
      if (sel) setIcon(item.createDiv({ cls: "oc-agent-item-check" }), "check");
      item.addEventListener("click", () => {
        this.hideModePopover();
        onSelect(m);
      });
    }

    const onDocMouseDown = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (!pop.contains(t) && !anchorEl.contains(t)) this.hideModePopover();
    };
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") this.hideModePopover();
    };
    setTimeout(() => {
      document.addEventListener("mousedown", onDocMouseDown);
      document.addEventListener("keydown", onEsc);
    }, 0);
    this.modePopoverCleanup = () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onEsc);
    };
  }

  private hideModePopover() {
    if (this.modePopoverEl) {
      this.modePopoverEl.remove();
      this.modePopoverEl = null;
    }
    if (this.modePopoverCleanup) {
      this.modePopoverCleanup();
      this.modePopoverCleanup = null;
    }
  }

  private enabledToolDefinitions() {
    const all = this.plugin.tools.definitions();
    const en = this.plugin.settings.enabledTools;
    return en.length ? all.filter((t) => en.includes(t.name)) : all;
  }

  // ---------- @-mention / attach ----------

  /** Detect an in-progress `@query` token at the end of the message. Value-based
   *  (no `selectionStart` dependency) so it works exactly like the `/` slash menu. */
  private activeMention(): { at: number; query: string } | null {
    const val = this.composerEl.value;
    const m = val.match(/(?:^|[\s([{.,;:!?])@([^\s@\[\]]*)$/);
    if (!m) return null;
    return { at: val.length - m[1].length - 1, query: m[1] };
  }

  /** All vault notes + image attachments, recent-first, for the native file-search modal. */
  private buildMentionItems(): MentionItem[] {
    const items: MentionItem[] = [];
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      items.push({ path: f.path, link: f.path.replace(/\.md$/, ""), kind: "note", mtime: f.stat.mtime });
    }
    for (const f of this.plugin.app.vault.getFiles()) {
      if (IMAGE_EXT.has(f.extension)) {
        items.push({ path: f.path, link: f.path, kind: "image", mtime: f.stat.mtime });
      }
    }
    items.sort((a, b) => (a.kind !== b.kind ? (a.kind === "note" ? -1 : 1) : (b.mtime ?? 0) - (a.mtime ?? 0)));
    return items;
  }

  /** Open the native vault file-search modal when a NEW `@` appears (avoids
   *  re-opening after a cancelled mention). */
  private maybeOpenMention() {
    const act = this.activeMention();
    if (!act) {
      this.mentionArmed = true;
      return;
    }
    if (!this.mentionArmed) return;
    const items = this.buildMentionItems();
    if (!items.length) {
      this.mentionArmed = true;
      return;
    }
    this.mentionArmed = false;
    const end = act.at + 1 + act.query.length;
    new NoteMentionModal(this.plugin.app, items, (item) => this.applyMention(item, act.at, end)).open();
  }

  /** Apply a chosen mention: insert a [[wikilink]] (note) or attach an image. */
  private applyMention(item: MentionItem, start: number, end: number) {
    if (item.kind === "image") {
      this.replaceComposerRange(start, end, "");
      void this.mentionImage(item.path);
    } else {
      this.replaceComposerRange(start, end, `[[${item.link}]]`);
    }
    this.mentionArmed = true;
    this.composerEl.focus();
  }

  private async mentionImage(path: string) {
    try {
      const img = await vaultFileDataUrl(this.plugin.app, path);
      this.pendingImages.push(img);
      this.renderAttachments();
    } catch (err) {
      new Notice(`Couldn't attach image: ${String((err as Error).message ?? err)}`);
    }
  }

  /** Replace the `@` token range with `text`, set caret, and resize the input. */
  private replaceComposerRange(start: number, end: number, text: string) {
    const val = this.composerEl.value;
    this.composerEl.value = val.slice(0, start) + text + val.slice(end);
    const caret = start + text.length;
    this.composerEl.setSelectionRange(caret, caret);
    this.composerEl.style.height = "auto";
    this.composerEl.style.height = Math.min(this.composerEl.scrollHeight, 240) + "px";
  }

  // ---------- slash commands ----------

  private static COMMANDS = [
    { name: "/clear", hint: "Start a new session" },
    { name: "/web", hint: "Search the web (Tavily) — e.g. /web latest Tailscale news" },
    { name: "/help", hint: "Show available commands" },
  ];

  private updateSlashMenu() {
    const val = this.composerEl.value;
    this.hideSlash();
    if (!val.startsWith("/") || val.includes("\n")) return;
    const first = val.trim().split(" ")[0];
    const filtered = ChatView.COMMANDS.filter((c) => c.name.startsWith(first));
    if (!filtered.length) return;
    const menu = this.contentEl.createDiv({ cls: "oc-slash" });
    this.slashMenuEl = menu;
    this.slashIndex = 0;
    filtered.forEach((c, i) => {
      const item = menu.createDiv({ cls: "oc-slash-item" });
      item.createSpan({ cls: "oc-slash-name", text: c.name });
      item.createSpan({ cls: "oc-slash-hint", text: c.hint });
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.runSlashCommand(c);
      });
      if (i === 0) item.addClass("sel");
    });
  }

  private moveSlash(dir: number) {
    const items = this.slashMenuEl?.querySelectorAll(".oc-slash-item");
    if (!items?.length) return;
    const idx = (this.slashIndex + dir + items.length) % items.length;
    this.slashIndex = idx;
    items.forEach((el, i) => el.classList.toggle("sel", i === idx));
  }

  private runSlash(idx: number) {
    const items = this.slashMenuEl?.querySelectorAll(".oc-slash-item");
    if (!items?.length) return;
    const name = items[idx].querySelector(".oc-slash-name")?.textContent ?? "";
    const cmd = ChatView.COMMANDS.find((c) => c.name === name);
    if (cmd) this.runSlashCommand(cmd);
  }

  private hideSlash() {
    if (this.slashMenuEl) {
      this.slashMenuEl.remove();
      this.slashMenuEl = null;
    }
  }

  private runSlashCommand(cmd: { name: string; hint: string }) {
    this.hideSlash();
    switch (cmd.name) {
      case "/clear":
        this.newSession();
        this.composerEl.value = "";
        break;
      case "/web": {
        const rest = this.composerEl.value.replace("/web", "").trim();
        this.composerEl.value = "";
        if (!rest) return this.addSystemMessage("type a query after /web");
        void this.startWebSearch(rest);
        break;
      }
      case "/help":
        this.addSystemMessage(ChatView.COMMANDS.map((c) => `${c.name} — ${c.hint}`).join("\n"));
        this.composerEl.value = "";
        break;
    }
  }

  private async startWebSearch(query: string) {
    this.streaming = true;
    this.addUserMessage(`/web ${query}`);
    try {
      const res = await this.plugin.tools.exec("web_search", { query }, this.plugin.index);
      this.addToolRow("web_search", query, "ok");
      const md = this.beginAssistantMessage();
      renderMarkdown(this.plugin.app, md, res.ok ? `Found results for **${query}**:\n\n${res.output}` : res.output, this.sessionPath, this).catch(() => {});
    } catch (err) {
      this.addToolRow("error", String((err as Error).message ?? err), "error");
    } finally {
      this.streaming = false;
    }
  }

  private setStatus(txt: string) {
    this.addSystemMessage(txt);
  }

  async onClose() {
    this.hideModePopover();
    if (this.gateway) await this.gateway.close().catch(() => {});
  }
}

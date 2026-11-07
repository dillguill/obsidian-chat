/** Chat view — workspace-style layout.
 *  Desktop: right-docked sidebar. Mobile: full-screen page.
 *  No chat bubbles / avatars — a continuous flowing transcript with inline
 *  tool rows (icon + label + checkmark/diff), "Thought for Xs" blocks, and a
 *  composer toolbar (model / agent / thinking / tools). */
import { ItemView, WorkspaceLeaf, Menu, TFile, TFolder, Platform, setIcon, Notice } from "obsidian";
import type ObsidianChatPlugin from "../main";
import type { ActivityItem, ChatMessage, PlanEntry, RetrievedNote, StreamEvent, ImageAttachment, UsageInfo } from "../chat/types";
import { AcpBridgeClient, AcpUnavailableError, toolCallContentLines, type PendingPermissionRequest } from "../acp/client";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { extractWikilinks } from "../chat/ground";
import type { VaultIndex } from "../retrieval/index";
import { renderMarkdown } from "./markdown";
import { metaToFrontmatter, renderBody, approxTokens, parseSessionNote, parseSessionMeta } from "../session/store";
import { renderApprovalCard, type WritePreview } from "./approval";
import { SessionSuggestModal } from "./session-suggest";
import { vaultFileDataUrl, VaultImagePickModal, IMAGE_EXT } from "./image-picker";
import { NoteMentionModal, type MentionItem } from "./mention";
import { openAcpPickerMenu, flattenSelectOptions } from "./acp-picker-menu";
import { AcpModelSuggestModal } from "./acp-model-suggest";
import { resolveModelChoice } from "../chat/model-prefs";
import { applyToolEvent, formatDuration, groupDiff, toolIcon, workLabel } from "./activity";
import { relativeDate, titleFromText } from "../chat/session-title";
import { basename } from "./activity";
import { ConnectionInfoModal, type KeyboardDebugInfo } from "./connection-info";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

/** ACP stop reasons worth telling the user about (`end_turn` and the
 *  user's own `cancelled` are not). */
const STOP_REASON_TEXT: Record<string, string> = {
  max_tokens: "Stopped: the reply hit the model's length limit. Send “continue” to pick up where it left off.",
  max_turn_requests: "Stopped: the agent hit its step limit for one turn. Send “continue” to keep going.",
  refusal: "The model declined to continue.",
};

export const VIEW_TYPE_CHAT = "obsidian-chat-view";

// Display-only icon per well-known mode id (opencode declares "build"/"plan").
// Falls back to a generic icon for any other harness-declared mode id — this
// is cosmetic, not a plugin-owned mode enum (FR-007).
const MODE_ICONS: Record<string, string> = {
  build: "hammer",
  plan: "list-checks",
};

/** One removable one-turn context chip (W3.5). Selection chips carry their
 *  text inline; note/folder chips carry only a reference (the content is read
 *  at send time so a long-lived chip can never hold a stale body). */
interface ContextChip {
  id: string;
  kind: "selection" | "note" | "folder" | "active-note";
  label: string;
  path?: string;
  text?: string;
  startLine?: number;
  endLine?: number;
}

/** Drops the optional toolbar labels to icons when they would otherwise be cut
 *  off (W2.2, reworked 2026-10-24).
 *
 *  Measured, not guessed from a media query: the model name length changes with
 *  the harness, so the same row can overflow at 400px or fit at 340px. The row
 *  never wraps (labels+pills on one line); when it cannot fit, the thinking and
 *  agent-mode chips become icon-only, with their title attributes still carrying
 *  the value, and the model label gets the freed space. Labels return the moment
 *  there is room.
 *
 *  An ellipsized model name counts as a cutoff too: it is the one label with no
 *  icon fallback, so the mode/thinking labels yield first. Their icons keep the
 *  controls recognisable and their title attributes still carry the value. */
class ToolbarLayout {
  private ro: ResizeObserver | null = null;
  private mo: MutationObserver | null = null;
  private frame: number | null = null;

  constructor(private toolbarEl: HTMLElement) {
    const win = toolbarEl.ownerDocument.defaultView;
    const RO = win?.ResizeObserver;
    if (typeof RO === "function") {
      this.ro = new RO(() => this.schedule());
      this.ro.observe(toolbarEl);
    }
    const MO = win?.MutationObserver;
    if (typeof MO === "function") {
      // childList/characterData only — observing our own class attribute would
      // make refresh() retrigger this observer forever.
      this.mo = new MO(() => this.schedule());
      this.mo.observe(toolbarEl, { childList: true, subtree: true, characterData: true });
    }
    this.schedule();
  }

  refresh(): void {
    const bar = this.toolbarEl;
    // Measure the roomy state first: labels come back when a wider leaf, a
    // shorter model name, or a hidden mode button makes space for them.
    bar.removeClass("oc-toolbar-compact");

    // (a) a child pushed past the row's content edge, or (b) an optional label
    // already ellipsized by a theme/parent constraint. Either means "compact".
    const edge = bar.getBoundingClientRect().right;
    const overflows = Array.from(bar.children).some(
      (el) => el instanceof HTMLElement && el.getBoundingClientRect().right > edge + 1,
    );
    const clipped = Array.from(bar.querySelectorAll<HTMLElement>(".oc-toolbtn-text")).some(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    bar.toggleClass("oc-toolbar-compact", overflows || clipped);
  }

  destroy(): void {
    if (this.frame !== null) {
      this.toolbarEl.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.ro?.disconnect();
    this.mo?.disconnect();
    this.ro = null;
    this.mo = null;
  }

  private schedule(): void {
    const win = this.toolbarEl.ownerDocument.defaultView;
    if (!win || this.frame !== null) return;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = null;
      this.refresh();
    });
  }
}

/** File extensions we can attach as plain text (non-image) context. */
const TEXT_EXT = new Set(["md", "txt", "csv", "tsv", "json", "html", "htm", "xml", "log", "yaml", "yml", "css", "js"]);

/** How much of the viewport has to be covered before we call it a keyboard.
 *
 *  Nothing else on a phone takes 100px off the viewport bottom, and every
 *  iPhone keyboard is well over 200px, so this separates "keyboard" from
 *  "scrollbar/rotation jitter" with room to spare. */
const KEYBOARD_MIN_COVER = 100;

/** Capacitor's Keyboard plugin, present in the Obsidian mobile app.
 *
 *  Its `keyboardWillShow`/`keyboardWillHide` events carry the real keyboard
 *  height and fire on every device, unlike `visualViewport` diffing — which
 *  silently reports nothing whenever the WebView neither resizes nor shrinks its
 *  visual viewport. Reading it structurally keeps the plugin's "no Node/Electron
 *  APIs" rule (G8) and its `isDesktopOnly: false` manifest honest: the object is
 *  simply absent on desktop. */
interface CapacitorKeyboard {
  addListener?: (event: string, cb: (info: { keyboardHeight?: number }) => void) => void;
}
function capacitorKeyboard(): CapacitorKeyboard | undefined {
  return (window as { Capacitor?: { Plugins?: { Keyboard?: CapacitorKeyboard } } }).Capacitor?.Plugins
    ?.Keyboard;
}

export class ChatView extends ItemView {
  private acp: AcpBridgeClient | null = null;
  /** Teardown for the listeners this view registered on the shared client. */
  private acpUnsubscribers: (() => void)[] = [];
  /** Local transcript for the ACP path (the harness owns session state; this
   *  is only for sessions-as-notes persistence — data-model.md Session). */
  private acpHistory: ChatMessage[] = [];
  private sendBtnEl: HTMLButtonElement | null = null;
  private messagesEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private composerEl!: HTMLTextAreaElement;
  private modelBtnEl!: HTMLElement;
  /** Small pin shown in the model chip when the live model is a pinned one. */
  private modelPinEl!: HTMLElement;
  private agentBtnEl!: HTMLElement;
  private thinkBtnEl!: HTMLElement;
  private attachBtnEl!: HTMLElement;
  private attachmentsEl!: HTMLElement;
  private pendingImages: ImageAttachment[] = [];
  private pendingTextAttachments: { name: string; content: string }[] = [];
  /** Pre-write snapshots keyed by the tool's own path string, captured on the
   *  first approved write to that path in this session (W7.5). Undo reads it. */
  private writeSnapshots = new Map<string, { existed: boolean; content: string }>();
  /** Removable one-turn context chips (W3.5) — selection/note/folder/active-note. */
  private contextChips: ContextChip[] = [];
  /** Message typed while the agent is running (W2.4). Single slot: sending
   *  again replaces it. Drained when the turn settles. */
  private queued: { text: string; images: ImageAttachment[]; textAttachments: { name: string; content: string }[] } | null = null;
  /** True while `sendQueued()` is running, so the drain in `send()`'s finally
   *  doesn't re-enter for the message it just sent. */
  private draining = false;
  private queueEl!: HTMLElement;
  private queueTextEl!: HTMLElement;
  /** Jump-to-latest pill (W2.3) + whether the transcript is pinned to the
   *  bottom. Only auto-scroll while pinned, so reading back never gets yanked. */
  private jumpEl!: HTMLElement;
  private pinned = true;
  private toolbarLayout: ToolbarLayout | null = null;
  private welcomeEl: HTMLElement | null = null;
  /** Connection banner (W7.10) — hidden while connected. */
  private connEl!: HTMLElement;
  /** Last sent turn, kept for Regenerate (W7.8). */
  private lastTurnText: string | null = null;
  private lastTurnImages: ImageAttachment[] = [];
  private slashMenuEl: HTMLElement | null = null;
  private slashIndex = 0;
  private mentionArmed = true;
  /** Links typed as `[[…]]` — referenced in the prompt but NOT force-attached
   *  (W3.6); `@`-mentions keep the existing attach-on-send behaviour. */
  private referenceOnlyLinks = new Set<string>();
  /** Newest assistant block — the only one offering Regenerate (W7.8). */
  private lastAssistantBlockEl: HTMLElement | null = null;
  private sessionPath = "";
  /** `created` of the note at `sessionPath`, so re-saving never restamps it. */
  private sessionCreated: number | null = null;
  /** Display name of this conversation. Harness-supplied when available,
   *  otherwise derived from the first message, otherwise a placeholder. */
  private sessionTitle: string | null = null;
  /** True once the note carries a name (loaded or renamed): stops a later
   *  harness title from silently renaming a conversation the user already saw. */
  private titleLocked = false;
  private titleBtnEl: HTMLElement | null = null;
  private liveDotEl: HTMLElement | null = null;
  /** Body of the most recently settled activity run, so a turn's changed files
   *  can be folded into it instead of a second card below the answer. */
  private lastFinishedBodyEl: HTMLElement | null = null;
  private streaming = false;
  private citations: string[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: ObsidianChatPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText() {
    // The tab (desktop) and the native bar (phone) both read this, so a named
    // session identifies itself without a second header.
    return this.sessionTitle ?? "Obsidian Chat";
  }

  getIcon() {
    return "message-square";
  }

  async onOpen() {
    const c = this.contentEl;
    c.empty();
    c.addClass("oc-view");
    // Phone-only chrome (tab-bar clearance, touch sizing) keys off the device,
    // not the pane width — a narrow desktop leaf must keep desktop spacing.
    c.toggleClass("oc-phone", Platform.isPhone);
    c.toggleClass("oc-density-compact", this.plugin.settings.uiDensity === "compact");

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
      this.liveDotEl = title.createSpan({ cls: "oc-live" });
      const titleBtn = title.createEl("button", {
        cls: "oc-session-title-btn",
        attr: { type: "button", "aria-label": "Rename session" },
      });
      this.titleBtnEl = titleBtn;
      titleBtn.createSpan({ cls: "oc-session-title", text: this.sessionTitle ?? "New chat" });
      titleBtn.addEventListener("click", () => this.beginTitleRename());
      const hActions = header.createDiv({ cls: "oc-header-actions" });
      const hist = hActions.createEl("button", { cls: "oc-icon-btn", attr: { "aria-label": "History", title: "History" } });
      setIcon(hist, "history");
      hist.addEventListener("click", () => this.showHistory());
      const plus = hActions.createEl("button", { cls: "oc-icon-btn", attr: { "aria-label": "New session", title: "New session" } });
      setIcon(plus, "plus");
      plus.addEventListener("click", () => this.newSession());
    }

    // ---- connection banner (W7.10) — hidden unless something's wrong ----
    this.connEl = c.createDiv({ cls: "oc-conn" });
    this.connEl.hidden = true;

    // ---- transcript ----
    const messages = c.createDiv({ cls: "oc-messages" });
    this.messagesEl = messages;

    // ---- context chips (citations / attachments) ----
    // Created inside the composer card below: context belongs to the message
    // being written, not to the transcript.
    // Scrolling back through the transcript must not fight the stream (W2.3).
    this.registerDomEvent(messages, "scroll", () => {
      const nearBottom = messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 24;
      this.pinned = nearBottom;
      if (this.jumpEl) this.jumpEl.hidden = nearBottom;
    });

    // ---- queued message row (W2.4) — hidden until something is queued ----
    this.queueEl = c.createDiv({ cls: "oc-queue" });
    this.queueEl.hidden = true;
    this.queueTextEl = this.queueEl.createSpan({ cls: "oc-queue-text" });
    const queueSendBtn = this.queueEl.createEl("button", { cls: "oc-queue-btn", text: "Send now" });
    queueSendBtn.addEventListener("click", () => void this.steerQueued());
    const queueXBtn = this.queueEl.createEl("button", { cls: "oc-queue-btn", text: "Discard" });
    queueXBtn.addEventListener("click", () => {
      this.queued = null;
      this.renderQueue();
    });

    // ---- composer ----
    // One bordered card holds both the input row and the mode-chip toolbar below it
    // (divided by a hairline), so the whole card — not just whitespace — is what
    // separates the composer from the flowing transcript above.
    // The wrapper is what the keyboard handler pins (see syncKeyboardState);
    // it spans the full-width flex column so the inner card keeps its own margins.
    const composer = c.createDiv({ cls: "oc-composer-wrap" });
    this.composerWrapEl = composer;
    const composerInner = composer.createDiv({ cls: "oc-composer" });
    this.composerBoxEl = composerInner;
    const box = composerInner.createDiv({ cls: "oc-inputbox" });
    this.wireDropTarget(box);
    // Context chips ride at the top of the card they will be sent with.
    this.chipsEl = box.createDiv({ cls: "oc-chips" });
    // Pending image attachments render as a compact pill row at the top of the card.
    this.attachmentsEl = box.createDiv({ cls: "oc-attachments" });
    this.attachmentsEl.style.display = "none";
    const inputRow = box.createDiv({ cls: "oc-input-row" });
    const ta = inputRow.createEl("textarea", {
      cls: "oc-input",
      attr: {
        placeholder: Platform.isMobileApp ? "Ask anything…" : "Ask anything — @ for notes, / for commands",
        rows: "1",
        "aria-label": "Message",
      },
    });
    this.composerEl = ta as HTMLTextAreaElement;
    ta.addEventListener("paste", (e) => this.handlePaste(e));
    // Send floats inside the input row (bottom-right corner) so the toolbar row below
    // is free to just be the three mode chips.
    const sendBtn = inputRow.createEl("button", { cls: "oc-send", attr: { "aria-label": "Send" } });
    this.sendBtnEl = sendBtn as HTMLButtonElement;
    setIcon(sendBtn, "arrow-up");
    sendBtn.addEventListener("click", () => {
      if (this.streaming) void this.cancelStreaming();
      else void this.send();
    });
    ta.addEventListener("keydown", (e) => {
      if (this.slashMenuEl) {
        if (e.key === "ArrowDown") { e.preventDefault(); this.moveSlash(1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); this.moveSlash(-1); return; }
        if (e.key === "Enter") { e.preventDefault(); this.runSlash(this.slashIndex); return; }
        if (e.key === "Escape") { this.hideSlash(); return; }
      }
      // Cmd/Ctrl+Enter always sends; plain Enter follows the user's setting
      // (W2.5 — mobile keyboards benefit from Enter = newline).
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        this.send();
        return;
      }
      // On a phone there is no Cmd/Ctrl key, so Return inserts a newline and
      // the send button sends — the standard mobile chat contract (W2.5).
      // Desktop follows the user's `sendShortcut` setting.
      if (e.key === "Enter" && !e.shiftKey && !Platform.isMobileApp && this.plugin.settings.sendShortcut !== "mod-enter") {
        e.preventDefault();
        this.send();
      }
    });
    ta.addEventListener("input", () => {
      this.applyComposerHeight();
      this.syncSendEnabled();
      this.updateSlashMenu();
      this.maybeOpenMention();
    });
    // The composer grows with the viewport, not a fixed pixel cap (W2.1), and
    // recomputes when the iOS keyboard opens/closes or the window resizes.
    this.registerDomEvent(window, "resize", () => this.syncKeyboardState());
    // iOS keyboard: `visualViewport` shrinks/scrolls as the keyboard animates,
    // which `window.resize` alone does not report. (`registerDomEvent` is typed
    // for Window/Document/HTMLElement only, hence the manual listener pair.)
    const vv = window.visualViewport;
    if (vv) {
      const onViewportChange = () => this.syncKeyboardState();
      vv.addEventListener("resize", onViewportChange);
      vv.addEventListener("scroll", onViewportChange);
      this.register(() => {
        vv.removeEventListener("resize", onViewportChange);
        vv.removeEventListener("scroll", onViewportChange);
      });
    }
    this.registerDomEvent(ta, "focus", () => window.requestAnimationFrame(() => this.syncKeyboardState()));
    // The dismissal can finish without a trailing `visualViewport` resize on
    // iOS, which would strand the lifted state — re-check on blur too.
    this.registerDomEvent(ta, "blur", () => window.requestAnimationFrame(() => this.syncKeyboardState()));
    // The authoritative signal, when it exists: Capacitor's Keyboard plugin. The
    // `visualViewport` diffing below is only a fallback — on a device that
    // neither resizes the WebView nor shrinks its visual viewport it reports
    // nothing at all, which is how four attempts at this bug managed to be no-ops.
    const capKb = capacitorKeyboard();
    if (capKb?.addListener) {
      capKb.addListener("keyboardWillShow", (info) => {
        this.capacitorKeyboardHeight = Math.round(info?.keyboardHeight ?? 0);
        this.syncKeyboardState();
      });
      capKb.addListener("keyboardWillHide", () => {
        this.capacitorKeyboardHeight = 0;
        this.syncKeyboardState();
      });
    }
    this.register(() => {
      if (this.snapshotTimer !== null) window.clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    });
    this.registerDomEvent(document, "visibilitychange", () => this.applyComposerHeight());
    // Esc stops the run from anywhere in the view (W6.8).
    this.registerDomEvent(c, "keydown", (ev) => {
      if (ev.key === "Escape" && this.streaming) {
        ev.preventDefault();
        void this.cancelStreaming();
      }
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
    this.modelPinEl = this.modelBtnEl.createSpan({ cls: "oc-toolbtn-pin oc-toolbtn-hidden" });
    setIcon(this.modelPinEl, "pin");
    setIcon(this.modelBtnEl.createSpan({ cls: "oc-toolbtn-chevron" }), "chevron-down");
    this.modelBtnEl.addEventListener("click", () => this.openModelPicker());

    this.thinkBtnEl = toolbar.createEl("button", { cls: "oc-toolbtn oc-toolbtn-think" });
    this.thinkBtnEl.createSpan({ cls: "oc-toolbtn-icon" });
    this.thinkBtnEl.createSpan({ cls: "oc-toolbtn-text" });
    this.thinkBtnEl.addEventListener("click", () => this.showThinkingMenu());

    this.agentBtnEl = toolbar.createEl("button", { cls: "oc-toolbtn oc-toolbtn-agent" });
    this.agentBtnEl.createSpan({ cls: "oc-toolbtn-icon" });
    this.agentBtnEl.createSpan({ cls: "oc-toolbtn-text" });
    this.agentBtnEl.addEventListener("click", () => this.showAgentMenu());

    // Usage / context meter (W4.2) — last child so it sits at the row's end.
    // A small circular ring whose arc fills with context usage; hidden until the
    // harness reports a reading (opencode does).
    this.usageEl = toolbar.createDiv({ cls: "oc-usage oc-toolbtn-hidden" });
    this.usageFillEl = this.usageEl;
    this.toolbarLayout = new ToolbarLayout(toolbar);

    // The phone layout is pinned with inline geometry, so anything that
    // changes the height of the banner, the queue row or the composer card has
    // to re-run the pin — otherwise a late connection banner is drawn over the
    // transcript and the queue sits under the composer.
    const ownerWin = c.ownerDocument.defaultView;
    const LayoutRO = ownerWin?.ResizeObserver;
    if (typeof LayoutRO === "function") {
      this.layoutObserver = new LayoutRO(() => this.applyComposerHeight());
      for (const el of [this.composerWrapEl, this.connEl, this.queueEl]) {
        if (el) this.layoutObserver.observe(el);
      }
      this.register(() => {
        this.layoutObserver?.disconnect();
        this.layoutObserver = null;
      });
    }

    await this.refreshToolbar();
    this.applyComposerHeight();
    this.syncSendEnabled();
    // Jump-to-latest pill (W2.3) — shown only once the reader scrolls up.
    this.jumpEl = c.createEl("button", { cls: "oc-jump", attr: { "aria-label": "Jump to latest" } });
    setIcon(this.jumpEl.createSpan(), "arrow-down");
    this.jumpEl.createSpan({ text: "New" });
    this.jumpEl.hidden = true;
    this.jumpEl.addEventListener("click", () => {
      this.pinned = true;
      this.scrollToBottom();
    });
    // Warm the vault index so @-mentions can offer notes immediately.
    void this.plugin.index.ensureLoaded();
    // Best-effort eager connect so the toolbar reflects real
    // harness-declared modes/thinking-levels from the start
    // (FR-007/FR-008), not only after the first message is sent.
    // connect() retries internally while the hosted bridge
    // finishes spawning, so a cold start won't leave the model
    // picker hidden.
    void this.ensureAcp()
      .connect()
      .then(() => this.refreshToolbar())
      .catch(() => {});
    // Reopening the view while a session is still live must show that
    // conversation, not an empty transcript in front of an agent that
    // remembers everything.
    if (this.plugin.hasLiveAcpSession() && this.plugin.currentSessionPath) {
      await this.loadSession(this.plugin.currentSessionPath);
      return;
    }
    this.showWelcome();
  }

  // ---------- empty state (W6.1) ----------

  /** Welcome panel: brand, three entry actions, recent sessions. Removed by the
   *  first user message and restored by "New session". */
  private showWelcome(): void {
    if (this.welcomeEl) return;
    const el = this.messagesEl.createDiv({ cls: "oc-welcome" });
    // No brand row: the header (and the phone's native bar) already names the
    // view, so a repeated title read as duplication. The panel asks the one
    // question a new session has to answer.
    el.createDiv({ cls: "oc-welcome-title", text: "What are we working on?" });
    el.createDiv({ cls: "oc-welcome-sub", text: "Grounded in this vault. Nothing leaves your machine." });

    const active = this.app.workspace.getActiveFile();
    const grid = el.createDiv({ cls: "oc-welcome-grid" });
    const card = (icon: string, title: string, hint: string, onClick: () => void) => {
      const b = grid.createEl("button", { cls: "oc-welcome-card", attr: { type: "button" } });
      setIcon(b.createSpan({ cls: "oc-welcome-card-icon" }), icon);
      b.createSpan({ cls: "oc-welcome-card-title", text: title });
      b.createSpan({ cls: "oc-welcome-card-hint", text: hint });
      b.addEventListener("click", onClick);
    };
    card("file-text", "Ask about this note", active?.basename ?? "No note open", () => {
      if (!this.app.workspace.getActiveFile()) {
        new Notice("No active note");
        return;
      }
      void this.addActiveNote();
      this.composerEl.focus();
    });
    card("network", "Find connections", "Across recent notes", () => {
      if (this.app.workspace.getActiveFile()) void this.addActiveNote();
      this.fillComposer("Find connections between this note and my recent notes.");
    });
    card("calendar", "Catch up on the week", "Projects · Inbox · recent notes", () => {
      this.fillComposer("Summarize what I worked on this week from my recent notes.");
    });
    card("plus", "Start from scratch", "No context attached", () => {
      this.clearContextChips();
      this.composerEl.focus();
    });
    void this.renderRecentSessions(el);
    this.welcomeEl = el;
  }

  /** Puts a prepared question in the composer, ready to edit or send. */
  private fillComposer(text: string): void {
    this.composerEl.value = text;
    this.applyComposerHeight();
    this.syncSendEnabled();
    this.composerEl.focus();
    const end = text.length;
    this.composerEl.setSelectionRange(end, end);
  }

  private hideWelcome(): void {
    this.welcomeEl?.remove();
    this.welcomeEl = null;
  }

  /** Newest three session notes in the session folder. Prefers frontmatter
   *  `title` when the harness supplied one (W7.11), else the filename. */
  private async renderRecentSessions(parent: HTMLElement): Promise<void> {
    const folder = this.sessionFolder();
    const files = this.plugin.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 3);
    if (!files.length) return;
    const wrap = parent.createDiv({ cls: "oc-welcome-recent" });
    wrap.createDiv({ cls: "oc-welcome-recent-title", text: "Recent" });
    for (const f of files) {
      const fm = this.plugin.app.metadataCache.getFileCache(f)?.frontmatter as { title?: string } | undefined;
      const b = wrap.createEl("button", { cls: "oc-recent-item", attr: { type: "button" } });
      b.createSpan({ cls: "oc-recent-name", text: fm?.title ?? f.basename });
      b.createSpan({ cls: "oc-recent-date", text: relativeDate(f.stat.mtime) });
      b.addEventListener("click", () => void this.loadSession(f.path));
    }
  }

  // ---------- context chips (W3.5) ----------

  /** Adds the active note as one-turn context. */
  private async addActiveNote(): Promise<void> {
    const f = this.plugin.app.workspace.getActiveFile();
    if (!f) {
      new Notice("No active note");
      return;
    }
    this.addContextChip({ id: `active:${f.path}`, kind: "active-note", label: f.basename, path: f.path });
  }

  /** Adds a selection/note/folder chip (file menu, drag-drop, command). */
  addContextChip(chip: ContextChip): void {
    if (this.contextChips.some((c) => c.id === chip.id)) return;
    this.contextChips.push(chip);
    this.renderChips(this.citations);
  }

  private clearContextChips(): void {
    if (!this.contextChips.length) return;
    this.contextChips = [];
    this.renderChips(this.citations);
  }

  /** Drag & drop onto the composer (W3.4): images become vision pills,
   *  text/markdown becomes attached context, anything else is refused. */
  private wireDropTarget(box: HTMLElement): void {
    box.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      box.addClass("oc-drop-active");
    });
    box.addEventListener("dragleave", (e) => {
      if (e.relatedTarget instanceof Node && box.contains(e.relatedTarget)) return;
      box.removeClass("oc-drop-active");
    });
    box.addEventListener("drop", (e) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      box.removeClass("oc-drop-active");
      let accepted = 0;
      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (IMAGE_EXT.has(ext)) {
          this.addPendingImageFromFile(file);
          accepted++;
        } else if (TEXT_EXT.has(ext)) {
          this.addFileFromDevice(file);
          accepted++;
        }
      }
      if (!accepted) new Notice("Unsupported file type");
    });
  }

  /** Focuses the composer (used after adding a context chip from outside). */
  focusComposer(): void {
    this.composerEl?.focus();
  }

  /** Replays a stored turn's work — thoughts and tool calls — as one collapsed
   *  group (W7.4), the same DOM as a live group minus the timer. */
  private renderStoredActivity(items: ActivityItem[], reasoning: { text: string; durationSeconds?: number }[] = []): void {
    const wrap = this.messagesEl.createDiv({ cls: "oc-activity" });
    wrap.setAttribute("data-expanded", "false");
    const header = wrap.createEl("button", { cls: "oc-activity-header", attr: { type: "button" } });
    const iconEl = header.createSpan({ cls: "oc-activity-icon" });
    const failed = items.some((i) => i.status === "failed");
    if (failed) iconEl.addClass("oc-activity-failed");
    setIcon(iconEl, failed ? "alert-triangle" : "check");
    header.createSpan({ cls: "oc-activity-label", text: workLabel(items, reasoning.length) });
    const diff = groupDiff(items);
    if (diff) header.createSpan({ cls: "oc-activity-diff", text: `+${diff.add} −${diff.del}` });
    const chevEl = header.createSpan({ cls: "oc-activity-chevron" });
    setIcon(chevEl, "chevron-right");
    const body = wrap.createDiv({ cls: "oc-activity-body" });
    this.wireCollapsible(header, wrap, (expanded) => {
      chevEl.empty();
      setIcon(chevEl, expanded ? "chevron-down" : "chevron-right");
    });
    for (const r of reasoning) this.renderStoredThought(body, r.text, r.durationSeconds);
    for (const item of items) {
      const row = body.createDiv({ cls: "oc-tool" + (item.status === "failed" ? " oc-tool-error" : "") });
      const ri = row.createSpan({ cls: "oc-tool-icon" });
      setIcon(ri, toolIcon(item.rawName, item.kind, item.status));
      row.createSpan({ cls: "oc-tool-verb", text: item.verb });
      const labelEl = row.createSpan({ cls: "oc-tool-label", text: item.label });
      const right = row.createSpan({ cls: "oc-tool-right" });
      if (item.diff) this.renderDiffStat(right, `+${item.diff.add} -${item.diff.del}`);
      if (item.isPath && item.target) {
        labelEl.addClass("oc-tool-label-link");
        labelEl.addEventListener("click", () => void this.openVaultTarget(item.target!));
      }
    }
  }

  /** A turn's changed files, folded into the run that produced them (W7.5).
   *  The run header already carries the diff totals, so this reports names and
   *  offers undo — it never repeats the summary as a second card below the
   *  answer. The standalone card is kept only for a turn with no visible run. */
  private renderChangesCard(items: ActivityItem[]): void {
    const writeNames = new Set(["write", "append", "patch", "delete", "move", "copy", "edit"]);
    const writes = items.filter(
      (i) => i.isPath && i.target && i.status === "completed" && (writeNames.has(i.name) || i.kind === "edit"),
    );
    if (!writes.length) return;
    const byPath = new Map<string, { add: number; del: number }>();
    for (const w of writes) {
      const e = byPath.get(w.target!) ?? { add: 0, del: 0 };
      if (w.diff) {
        e.add += w.diff.add;
        e.del += w.diff.del;
      }
      byPath.set(w.target!, e);
    }
    const host = this.lastFinishedBodyEl?.isConnected ? this.lastFinishedBodyEl : null;
    if (host) {
      const group = host.createDiv({ cls: "oc-changes-mini" });
      const head = group.createDiv({ cls: "oc-changes-mini-head" });
      head.createDiv({
        cls: "oc-changes-mini-title",
        text: `Changed ${byPath.size} ${byPath.size === 1 ? "note" : "notes"}`,
      });
      if (byPath.size > 1) {
        const undoAll = head.createEl("button", { cls: "oc-changes-mini-undo-all", text: "Undo all" });
        undoAll.addEventListener("click", () => void this.undoAll([...byPath.keys()]));
      }
      for (const [path, info] of byPath) this.renderChangeRow(group, path, info);
      return;
    }

    // Fallback: no run was rendered this turn, so the card stands alone.
    const card = this.messagesEl.createDiv({ cls: "oc-changes" });
    const expanded = byPath.size <= 3;
    card.setAttribute("data-expanded", expanded ? "true" : "false");
    const header = card.createEl("button", { cls: "oc-changes-header", attr: { type: "button" } });
    header.createSpan({
      cls: "oc-changes-title",
      text: `Changed ${byPath.size} ${byPath.size === 1 ? "note" : "notes"}`,
    });
    const chev = header.createSpan({ cls: "oc-changes-chevron" });
    setIcon(chev, expanded ? "chevron-down" : "chevron-right");
    this.wireCollapsible(header, card, (isOpen) => {
      chev.empty();
      setIcon(chev, isOpen ? "chevron-down" : "chevron-right");
    });
    const body = card.createDiv({ cls: "oc-changes-body" });
    for (const [path, info] of byPath) this.renderChangeRow(body, path, info);
    const undoAll = card.createEl("button", { cls: "oc-changes-undo-all", text: "Undo all" });
    undoAll.addEventListener("click", () => void this.undoAll([...byPath.keys()]));
  }

  private renderChangeRow(parent: HTMLElement, path: string, info: { add: number; del: number }): void {
    const row = parent.createDiv({ cls: "oc-changes-row" });
    setIcon(row.createSpan({ cls: "oc-changes-icon" }), "file-text");
    const pathEl = row.createSpan({ cls: "oc-changes-path", text: path });
    pathEl.addClass("oc-tool-label-link");
    pathEl.addEventListener("click", () => void this.openVaultTarget(path));
    if (info.add || info.del) {
      this.renderDiffStat(row.createSpan({ cls: "oc-tool-right" }), `+${info.add} -${info.del}`);
    }
    const undoBtn = row.createEl("button", { cls: "oc-changes-undo", text: "Undo" });
    if (!this.writeSnapshots.has(path)) {
      undoBtn.disabled = true;
      undoBtn.setAttribute("title", "No snapshot was taken for this action");
    }
    undoBtn.addEventListener("click", () => void this.undoPath(path, undoBtn));
  }

  /** Restores one path from its pre-write snapshot (W7.5). */
  private async undoPath(path: string, btn?: HTMLButtonElement): Promise<void> {
    const snap = this.writeSnapshots.get(path);
    if (!snap) return;
    const f = this.resolveVaultFile(path);
    if (snap.existed) {
      if (f) await this.plugin.app.vault.modify(f, snap.content);
      else {
        const parent = path.split("/").slice(0, -1).join("/");
        if (parent && !this.plugin.app.vault.getAbstractFileByPath(parent)) {
          await this.plugin.app.vault.createFolder(parent).catch(() => {});
        }
        await this.plugin.app.vault.create(path, snap.content);
      }
    } else if (f) {
      await this.plugin.app.vault.trash(f, false);
    }
    if (btn) {
      btn.disabled = true;
      btn.setText("Undone");
    }
    new Notice(`Restored ${basename(path)}`);
  }

  private async undoAll(paths: string[]): Promise<void> {
    let n = 0;
    for (const p of paths) {
      if (!this.writeSnapshots.has(p)) continue;
      try {
        await this.undoPath(p);
        n++;
      } catch (err) {
        new Notice(`Undo failed for ${p}: ${String((err as Error).message ?? err)}`);
      }
    }
    if (n) new Notice(`Restored ${n} note${n === 1 ? "" : "s"}`);
  }

  /** Connection banner (W7.10): visible only when connecting or unreachable,
   *  so a dropped bridge explains itself instead of surfacing as an error row
   *  only after the user sends something. */
  private updateConnection(): void {
    if (!this.connEl) return;
    const state = this.acp?.getConnectionState() ?? "idle";
    if (this.liveDotEl) {
      this.liveDotEl.setAttribute(
        "data-state",
        state === "connected" ? "live" : state === "connecting" ? "connecting" : state === "unreachable" ? "error" : "",
      );
    }
    if (state === "connected" || state === "idle") {
      this.connEl.hidden = true;
      this.applyComposerHeight();
      return;
    }
    this.connEl.hidden = false;
    this.connEl.setAttribute("data-state", state);
    this.connEl.empty();
    this.connEl.createSpan({ cls: "oc-conn-dot" });
    this.connEl.createSpan({
      cls: "oc-conn-text",
      text: state === "connecting" ? "Connecting to host…" : "Host unreachable",
    });
    if (state === "unreachable") {
      const details = this.connEl.createEl("button", { cls: "oc-queue-btn", text: "Details" });
      details.addEventListener("click", () => this.openConnectionInfo());
    }
    // Banner just appeared or changed height: the transcript starts below it.
    this.applyComposerHeight();
  }

  /** Opens the connection/debug panel (W7.10; also the `connection-info` command).
   *  The keyboard sample rides along so the last-reported phone geometry can be
   *  read back without a console (W7.13). */
  openConnectionInfo(): void {
    new ConnectionInfoModal(this.plugin.app, this.acp?.getDebugInfo(), this.lastKeyboardSnapshot).open();
  }

  /** Re-applies view-scoped settings after the settings tab saves (W6.9). */
  applyViewSettings(): void {
    this.contentEl.toggleClass("oc-density-compact", this.plugin.settings.uiDensity === "compact");
    this.applyComposerHeight();
  }

  /** Tracks the on-screen keyboard and lets CSS place the composer for it (W7.13).
   *
   *  Why the first three attempts showed no change at all: they all tried to
   *  *re-position* the composer for however much the keyboard hid, and every one
   *  of them derived that amount from `window.innerHeight - vv.height`. When the
   *  WebView resizes for the keyboard instead of overlaying it, `innerHeight`
   *  shrinks in lockstep with `vv.height`, so that expression is ~0: the lift
   *  was 0, the reserved padding was 0, and the DOM was never touched. The band
   *  the user sees is not hidden area at all — it is constant layout that is
   *  merely *uncovered* once the keyboard hides Obsidian's bottom tab bar: the
   *  mobile `.oc-composer` reserves `56px + env(safe-area-inset-bottom)` of
   *  clearance for exactly that bar. Position math cannot remove a padding.
   *
   *  So detection here reads Obsidian's own `--keyboard-height`. On the target
   *  device the WebView neither resizes (`innerHeight` constant at 852) nor
   *  shrinks its visual viewport (`vv.height` constant at 852) while that
   *  variable reads 328px — so every viewport-diffing approach measured zero and
   *  silently did nothing. The viewport diffs are kept only as fallbacks for
   *  Android/hardware-keyboard cases where the variable may be absent. */
  private syncKeyboardState(): void {
    if (!Platform.isMobileApp) return;
    if (!this.composerWrapEl) return;
    const vv = window.visualViewport;
    // Rotation (and split view) changes every dimension we record, so a stale
    // resting baseline would read the new geometry as "keyboard open" forever.
    if (vv && Math.abs(vv.width - this.vvRestingWidth) > 1) {
      this.vvRestingWidth = vv.width;
      this.vvRestingHeight = vv.height;
      this.winRestingHeight = window.innerHeight;
    }
    if (vv) this.vvRestingHeight = Math.max(this.vvRestingHeight, vv.height);
    this.winRestingHeight = Math.max(this.winRestingHeight, window.innerHeight);

    const covered = Math.max(
      Math.round(this.readKeyboardHeight()),
      Math.round(this.capacitorKeyboardHeight),
      Math.round(this.winRestingHeight - window.innerHeight),
      Math.round(this.vvRestingHeight - (vv?.height ?? this.vvRestingHeight)),
    );
    const open = covered > KEYBOARD_MIN_COVER;

    // Obsidian already ends the app at the keyboard's top edge: it clamps
    // `.app-container` with `max-height: calc(100vh - var(--keyboard-height))`,
    // measured on the device as 524px = 852 - 328 while the keyboard is up. So
    // the keyboard's height must NOT be reserved again here — doing that pushed
    // the card above the bottom of an already correctly-sized view and left the
    // original band of blank space under it (and squeezed the transcript to
    // 28px). The only thing actually wrong was this box's own tab-bar clearance,
    // `56px + env(safe-area-inset-bottom)`, which needs to collapse to a plain
    // gap while the keyboard covers that bar. */
    if (this.composerBoxEl) {
      if (open) this.composerBoxEl.style.paddingBottom = "8px";
      else this.composerBoxEl.style.removeProperty("padding-bottom");
    }

    // Only a *state* change reflows: `applyComposerHeight()` reads `scrollHeight`,
    // and `--keyboard-height` can tick through several values as it animates.
    this.contentEl.toggleClass("oc-kb", open);
    const stateKey = open ? "1" : "0";
    if (stateKey !== this.keyboardStateKey) {
      this.keyboardStateKey = stateKey;
      this.keyboardOpen = open;
      this.applyComposerHeight();
    }
    // Trailing-debounced, so the chain is measured once the keyboard has settled
    // (and only while it is up — dismissing it is required to read the panel).
    if (open) this.scheduleKeyboardSample();
  }

  /** Obsidian publishes the on-screen keyboard's height here (0 when it is
   *  down); `:root { --keyboard-height: 0px }` is its own default, and it is the
   *  only signal that reports the keyboard on every device. */
  private readKeyboardHeight(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height");
    const px = Number.parseFloat(raw);
    return Number.isFinite(px) ? px : 0;
  }

  /** Samples the box chain the keyboard fix depends on (W7.13).
   *
   *  Obsidian may size its own containers for the keyboard (`--keyboard-height`, a
   *  `max-height` clamp on `.app-container`), and the box that actually strangles
   *  this view is one of those, not anything this plugin's CSS declares. The phone
   *  has no console, so the chain is read out through the connection-info panel.
   *  Only called while the keyboard is up: opening that panel dismisses the
   *  keyboard, so a sample taken on the way down is all you would be left with. */
  private sampleKeyboard(): KeyboardDebugInfo {
    const vv = window.visualViewport;
    const h = (el: Element | null | undefined) => (el instanceof HTMLElement ? el.clientHeight : -1);
    return {
      open: true,
      covered: Math.max(0, Math.round(this.readKeyboardHeight())),
      pinned: this.keyboardOpen,
      innerHeight: Math.round(window.innerHeight),
      visualHeight: Math.round(vv?.height ?? 0),
      visualOffsetTop: Math.round(vv?.offsetTop ?? 0),
      restingHeight: Math.round(this.vvRestingHeight),
      screenHeight: Math.round(window.screen.height),
      keyboardVar:
        getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height").trim() || "(unset)",
      appHeight: h(document.querySelector(".app-container")),
      viewContentHeight: h(this.contentEl.parentElement),
      viewHeight: h(this.contentEl),
      messagesHeight: h(this.messagesEl),
      composerHeight: h(this.composerWrapEl),
    };
  }

  /** Re-arms a trailing 250ms sample, so the numbers describe the settled
   *  keyboard rather than a frame of its opening animation — and so the layout
   *  reads in `sampleKeyboard` do not run for every event of that animation. */
  private scheduleKeyboardSample(): void {
    if (this.snapshotTimer !== null) window.clearTimeout(this.snapshotTimer);
    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = null;
      this.lastKeyboardSnapshot = this.sampleKeyboard();
    }, 250);
  }

  /** Viewport-capped composer autosize (W2.1).
   *
   *  Deliberately the JS path rather than CSS `field-sizing: content`: the
   *  latter is unreliable in iOS WKWebView, and this plugin's phone target is
   *  exactly where the old fixed 240px cap misbehaved. The cap tracks the
   *  window so the composer can never eat the transcript. */
  private applyComposerHeight(): void {
    const ta = this.composerEl;
    if (!ta) return;
    ta.style.height = "auto";
    const cap = Math.max(150, window.innerHeight * 0.55);
    ta.style.height = Math.min(ta.scrollHeight, cap) + "px";
    this.pinComposer();
    // Publish the card's height so overlays anchored above it (jump pill,
    // slash menu) follow a grown composer instead of a hard-coded 104px.
    const cardH = Math.ceil(this.composerWrapEl?.getBoundingClientRect().height ?? 0);
    if (cardH > 0) this.contentEl.style.setProperty("--oc-composer-h", `${cardH}px`);
  }

  /** Pins the transcript and the composer to the view's edges — inline styles,
   *  deliberately.
   *
   *  Measured on the device: the view is a flex column (`display=flex`) whose
   *  children nevertheless refuse to fill it. The composer wrapper sat in flow,
   *  ~230px above the view's end, and `.oc-messages` — the item with
   *  `flex: 1 1 auto` — stayed at content height (153px) instead of expanding,
   *  so the transcript clipped mid-element and the leftover area read as a grey
   *  slab over the view. Nothing that depends on that column distributing space
   *  works here (no `flex-grow`, no `margin: auto`), so both boxes are pinned to
   *  the view's edges instead, which is arrangement-independent.
   *
   *  Only on mobile: the desktop sidebar's flex layout is untouched. */
  private pinComposer(): void {
    const wrap = this.composerWrapEl;
    if (!wrap || !Platform.isMobileApp) return;
    const corners = (el: HTMLElement, top: string, bottom: string) => {
      el.style.position = "absolute";
      el.style.left = "0";
      el.style.right = "0";
      el.style.top = top;
      el.style.bottom = bottom;
    };
    wrap.style.position = "absolute";
    wrap.style.left = "0";
    wrap.style.right = "0";
    wrap.style.bottom = "0";
    wrap.style.zIndex = "2";
    // Measured while the wrapper is already out of flow, so this is its own
    // content height: the card including the chips row, plus a 4px gap.
    const GAP_ABOVE_COMPOSER = 4;
    const wrapH = Math.ceil(wrap.clientHeight);
    const composerTop = wrapH + GAP_ABOVE_COMPOSER;
    // A queued message is its own row and also sits out of flow on the phone;
    // stack it directly above the card and lift the transcript above both.
    const queueH = this.queueEl && !this.queueEl.hidden ? Math.ceil(this.queueEl.clientHeight) : 0;
    if (this.queueEl && queueH > 0) corners(this.queueEl, "auto", `${composerTop}px`);
    const transcriptBottom = composerTop + queueH;
    if (this.messagesEl) {
      // The banner is in flow at the very top when it is showing, so the
      // transcript starts below it rather than underneath it.
      const top = this.connEl && !this.connEl.hidden ? Math.ceil(this.connEl.clientHeight) : 0;
      corners(this.messagesEl, `${top}px`, `${transcriptBottom}px`);
      // The transcript now ends above the composer, so it no longer needs to
      // reserve the composer's height as scroll padding.
      this.messagesEl.style.paddingBottom = "";
    }
  }

  // ---------- transcript rendering (workspace style) ----------

  private addSystemMessage(text: string) {
    const el = this.messagesEl.createDiv({ cls: "oc-system" });
    el.setText(text);
    this.scrollToBottom();
    return el;
  }

  private addUserMessage(text: string, images?: ImageAttachment[], withTime = true) {
    this.hideWelcome();
    const el = this.messagesEl.createDiv({ cls: "oc-block oc-user" });
    const head = el.createDiv({ cls: "oc-turn-head" });
    head.createSpan({ cls: "oc-turn-name", text: "You" });
    // Restored turns carry no stored timestamp, so they are labelled without
    // one rather than pretending the message was sent now.
    if (withTime) {
      head.createSpan({
        cls: "oc-turn-time",
        text: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      });
    }
    const md = el.createDiv({ cls: "oc-body-md" });
    renderMarkdown(this.plugin.app, md, text, this.sessionPath, this).catch(() => md.setText(text));
    this.attachMessageActions(el, false);
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
    this.attachMessageActions(el, true);
    this.lastAssistantBlockEl = el;
    this.scrollToBottom();
    return md;
  }

  /** Copy / quote on every message (W3.7), plus Regenerate on the newest
   *  assistant reply (W7.8). Actions appear on hover for pointer devices and
   *  via long-press (native menu) on touch. */
  private attachMessageActions(blockEl: HTMLElement, isAssistant: boolean): void {
    const actions = blockEl.createDiv({ cls: "oc-msg-actions" });
    const copyBtn = actions.createEl("button", {
      cls: "oc-msg-action",
      attr: { type: "button", "aria-label": "Copy message", title: "Copy" },
    });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", () => void this.copyBlockText(blockEl, copyBtn));
    const quoteBtn = actions.createEl("button", {
      cls: "oc-msg-action",
      attr: { type: "button", "aria-label": "Quote in composer", title: "Quote in composer" },
    });
    setIcon(quoteBtn, "quote");
    quoteBtn.addEventListener("click", () => this.quoteBlock(blockEl));
    if (isAssistant) {
      const regenBtn = actions.createEl("button", {
        cls: "oc-msg-action oc-msg-regen",
        attr: { type: "button", "aria-label": "Regenerate", title: "Regenerate — asks again in this session" },
      });
      setIcon(regenBtn, "refresh-cw");
      regenBtn.addEventListener("click", () => void this.regenerate());
      regenBtn.hidden = true; // shown only while this is the newest reply
    }
    // Touch: long-press opens the same actions in a native menu.
    blockEl.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Copy message").setIcon("copy").onClick(() => void this.copyBlockText(blockEl, copyBtn)));
      menu.addItem((i) => i.setTitle("Quote in composer").setIcon("quote").onClick(() => this.quoteBlock(blockEl)));
      menu.showAtMouseEvent(ev);
    });
  }

  private blockText(blockEl: HTMLElement): string {
    return blockEl.querySelector(".oc-body-md")?.textContent ?? "";
  }

  private async copyBlockText(blockEl: HTMLElement, btn: HTMLElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.blockText(blockEl));
    } catch {
      return;
    }
    btn.empty();
    setIcon(btn, "check");
    window.setTimeout(() => {
      btn.empty();
      setIcon(btn, "copy");
    }, 1200);
  }

  /** Puts the message into the composer as a blockquote (W3.7). */
  private quoteBlock(blockEl: HTMLElement): void {
    const quoted = this.blockText(blockEl)
      .split(/\r?\n/)
      .map((l) => `> ${l}`)
      .join("\n");
    const existing = this.composerEl.value.trim();
    this.composerEl.value = existing ? `${existing}\n\n${quoted}\n\n` : `${quoted}\n\n`;
    this.applyComposerHeight();
    this.composerEl.focus();
    this.composerEl.selectionStart = this.composerEl.selectionEnd = this.composerEl.value.length;
  }

  /** Regenerate is offered only on the newest assistant reply (W7.8). */
  private markRegenerable(blockEl: HTMLElement | null): void {
    if (!blockEl) return;
    for (const btn of Array.from(this.messagesEl.querySelectorAll<HTMLElement>(".oc-msg-regen"))) btn.hidden = true;
    const btn = blockEl.querySelector<HTMLElement>(".oc-msg-regen");
    if (btn) btn.hidden = false;
  }

  /** Re-asks the last turn in the same session (W7.8).
   *  ACP has no session rewind, so this is a genuine re-ask rather than a
   *  history branch — the button's tooltip says exactly that. */
  private async regenerate(): Promise<void> {
    if (this.streaming || !this.lastTurnText) return;
    this.pendingImages = [...this.lastTurnImages];
    this.renderAttachments();
    this.streaming = true;
    this.setSendButtonMode("stop");
    this.lastAssistantText = "";
    try {
      await this.sendViaAcp(this.lastTurnText); // no user message echoed
    } catch (err) {
      this.addStatusRow("error", `Error: ${String((err as Error).message ?? err)}`);
    } finally {
      this.clearPendingAttachments();
      this.streaming = false;
      this.setSendButtonMode("send");
      await this.refreshToolbar();
      if (this.queued && !this.draining) void this.sendQueued();
    }
  }

  /** A one-line status row in the transcript — a turn's error, or why it
   *  stopped. Breaks out of any open activity group; never styled as a tool. */
  private addStatusRow(kind: "error" | "notice", text: string) {
    this.finalizeActivityGroup();
    const row = this.messagesEl.createDiv({ cls: `oc-status oc-status-${kind}` });
    setIcon(row.createSpan({ cls: "oc-status-icon" }), kind === "error" ? "alert-triangle" : "info");
    row.createSpan({ cls: "oc-status-text", text });
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

  /** One rendered row per ACP toolCallId, inside the current activity group
   *  (`toolRows`/`activityGroups` — specs/003-workspace-parity W1.3). */
  private toolRows = new Map<string, {
    item: ActivityItem;
    /** The item array of the group this row lives in, which may already be
     *  finalized — late updates still land on the right row. */
    items: ActivityItem[];
    idx: number;
    rowEl: HTMLElement;
    iconEl: HTMLElement;
    verbEl: HTMLElement;
    labelEl: HTMLElement;
    rightEl: HTMLElement;
  }>();
  /** The current consecutive run of tool calls, rendered as ONE collapsible
   *  block. Null between runs — `finalizeActivityGroup()` clears it, and the
   *  next tool event opens a fresh group. */
  private activityGroupEl: HTMLElement | null = null;
  private activityHeaderEl: HTMLElement | null = null;
  private activityBodyEl: HTMLElement | null = null;
  private activityIconEl: HTMLElement | null = null;
  private activityLabelEl: HTMLElement | null = null;
  private activityDiffEl: HTMLElement | null = null;
  private activityItems: ActivityItem[] = [];
  private activityStartedAt = 0;
  private activityLiveText = "";
  private activityTimer: number | null = null;
  private activityUserToggled = false;
  /** Thought bursts inside the current group, for its settled label. */
  private activityThoughts = 0;
  /** Finished activity items for the current turn — attached to the assistant
   *  history entry at turn end so a reopened session replays the trail (W7.4). */
  private turnActivity: ActivityItem[] = [];
  /** Live plan checklist (W4.1) — one panel per session, replaced in place.
   *  opencode does not emit plans today; the panel stays absent when none come. */
  private planEl: HTMLElement | null = null;
  private planBodyEl: HTMLElement | null = null;
  private planCountEl: HTMLElement | null = null;
  private planUserToggled = false;
  /** Latest harness-reported usage (W4.2). */
  private usage: UsageInfo | null = null;
  private usageEl: HTMLElement | null = null;
  private usageFillEl: HTMLElement | null = null;

  /** The composer's outer wrapper — the element the keyboard handler pins. */
  private composerWrapEl: HTMLElement | null = null;
  /** Re-pins the phone layout whenever the banner, queue or card changes size.
   *  Without it, a connection banner that appears after the first pin leaves
   *  `.oc-messages` at top 0 and the warning overlaps the transcript. */
  private layoutObserver: ResizeObserver | null = null;
  /** The `.oc-composer` box inside that wrapper — what the keyboard height is
   *  reserved on (inline, from the measured value). */
  private composerBoxEl: HTMLElement | null = null;
  /** Largest visual-viewport height observed with the keyboard closed. Diffs
   *  against this to detect the keyboard; see `syncKeyboardState`. */
  private vvRestingHeight = 0;
  /** Viewport width the resting baselines were taken at — a different width
   *  means a rotation, and the heights recorded for the old one are meaningless. */
  private vvRestingWidth = 0;
  /** Largest layout-viewport height observed (same baseline), used to tell a
   *  resized WebView apart from an overlaid one. */
  private winRestingHeight = 0;
  /** Whether the keyboard currently counts as open (mirrors `.oc-kb`). */
  private keyboardOpen = false;
  /** Memo of the last applied keyboard state, so the continuous
   *  `visualViewport` events during the keyboard animation do not reflow. */
  private keyboardStateKey = "";
  /** Last keyboard geometry sample, for the connection-info panel (W7.13). */
  private lastKeyboardSnapshot: KeyboardDebugInfo | null = null;
  /** Pending trailing sample timer (see `scheduleKeyboardSample`). */
  private snapshotTimer: number | null = null;
  /** Keyboard height in px reported by Capacitor's Keyboard plugin; 0 when the
   *  plugin is absent (desktop) or the keyboard is down. */
  private capacitorKeyboardHeight = 0;

  /** Wires a header as an accessible disclosure for `wrapperEl`, driven by
   *  that element's `data-expanded` attribute (the CSS contract shared by
   *  activity groups, thought blocks and the plan panel). */
  private wireCollapsible(
    headerEl: HTMLElement,
    wrapperEl: HTMLElement,
    onToggle?: (expanded: boolean) => void,
  ): void {
    headerEl.setAttribute("role", "button");
    headerEl.setAttribute("tabindex", "0");
    headerEl.setAttribute("aria-expanded", wrapperEl.getAttribute("data-expanded") ?? "true");
    const toggle = () => {
      const next = wrapperEl.getAttribute("data-expanded") === "false";
      wrapperEl.setAttribute("data-expanded", next ? "true" : "false");
      headerEl.setAttribute("aria-expanded", next ? "true" : "false");
      onToggle?.(next);
    };
    headerEl.addEventListener("click", toggle);
    headerEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  }

  private stopActivityTimer(): void {
    if (this.activityTimer !== null) {
      window.clearInterval(this.activityTimer);
      this.activityTimer = null;
    }
  }

  /** Opens a group for the current run, or returns the existing one. While the
   *  run is live the header shows the newest action plus an elapsed ticker. */
  private ensureActivityGroup(): void {
    if (this.activityGroupEl) return;
    // Work that follows some answer text starts below it, and the text after
    // the work starts a new bubble below that, so the transcript reads in order.
    if (this.pendingAssistantMd) {
      this.pendingAssistantMd.removeClass("streaming");
      this.pendingAssistantMd = null;
      this.pendingAcc = "";
    }
    const wrap = this.messagesEl.createDiv({ cls: "oc-activity" });
    wrap.setAttribute("data-expanded", "true");
    wrap.setAttribute("data-live", "true");
    const header = wrap.createEl("button", { cls: "oc-activity-header", attr: { type: "button" } });
    const iconEl = header.createSpan({ cls: "oc-activity-icon" });
    const labelEl = header.createSpan({ cls: "oc-activity-label" });
    const diffEl = header.createSpan({ cls: "oc-activity-diff" });
    const chevEl = header.createSpan({ cls: "oc-activity-chevron" });
    setIcon(chevEl, "chevron-down");
    const body = wrap.createDiv({ cls: "oc-activity-body" });
    this.wireCollapsible(header, wrap, (expanded) => {
      this.activityUserToggled = true;
      chevEl.empty();
      setIcon(chevEl, expanded ? "chevron-down" : "chevron-right");
    });
    this.activityGroupEl = wrap;
    this.activityHeaderEl = header;
    this.activityBodyEl = body;
    this.activityIconEl = iconEl;
    this.activityLabelEl = labelEl;
    this.activityDiffEl = diffEl;
    this.activityItems = [];
    this.activityThoughts = 0;
    this.activityStartedAt = Date.now();
    this.activityLiveText = "Working…";
    labelEl.setText(this.activityLiveText);
    iconEl.addClass("oc-spin");
    setIcon(iconEl, "loader");
    this.activityTimer = window.setInterval(() => {
      if (!this.activityLabelEl) return;
      const secs = (Date.now() - this.activityStartedAt) / 1000;
      this.activityLabelEl.setText(`${this.activityLiveText} · ${formatDuration(secs)}`);
    }, 1000);
  }

  /** Freezes the current run: settles the header to `N steps · Ns`, collapses
   *  it unless the user expanded it or something failed, and clears the refs so
   *  the next tool call starts a new group. */
  private finalizeActivityGroup(): void {
    if (!this.activityGroupEl) return;
    this.finalizeThought();
    this.stopActivityTimer();
    const items = this.activityItems;
    if (!items.length && !this.activityThoughts) {
      // Opened for a thought that turned out to be whitespace — leave no trace.
      this.activityGroupEl.remove();
      this.activityGroupEl = null;
      this.activityHeaderEl = null;
      this.activityBodyEl = null;
      this.activityIconEl = null;
      this.activityLabelEl = null;
      this.activityDiffEl = null;
      return;
    }
    this.activityGroupEl.setAttribute("data-live", "false");
    const secs = Math.max(0, (Date.now() - this.activityStartedAt) / 1000);
    const failed = items.some((i) => i.status === "failed");
    if (this.activityIconEl) {
      this.activityIconEl.removeClass("oc-spin");
      this.activityIconEl.empty();
      this.activityIconEl.toggleClass("oc-activity-failed", failed);
      setIcon(this.activityIconEl, failed ? "alert-triangle" : "check");
    }
    if (this.activityLabelEl) this.activityLabelEl.setText(workLabel(items, this.activityThoughts, secs));
    if (this.activityDiffEl) {
      const d = groupDiff(items);
      this.activityDiffEl.setText(d ? `+${d.add} −${d.del}` : "");
    }
    if (!failed && !this.activityUserToggled) {
      this.activityGroupEl.setAttribute("data-expanded", "false");
      this.activityHeaderEl?.setAttribute("aria-expanded", "false");
      const chev = this.activityHeaderEl?.querySelector(".oc-activity-chevron");
      if (chev instanceof HTMLElement) {
        chev.empty();
        setIcon(chev, "chevron-right");
      }
    }
    this.turnActivity.push(...items);
    // Kept for renderChangesCard: changed files belong inside this run.
    this.lastFinishedBodyEl = this.activityBodyEl;
    this.activityGroupEl = null;
    this.activityHeaderEl = null;
    this.activityBodyEl = null;
    this.activityIconEl = null;
    this.activityLabelEl = null;
    this.activityDiffEl = null;
    this.activityItems = [];
    this.activityLiveText = "";
    this.activityUserToggled = false;
    // toolRows is NOT cleared here: a tool can still be running when thinking
    // or text interrupts its group, and its later updates must find its row.
  }

  /** Opens a tool row's target note when it resolves to a real vault file. */
  private async openVaultTarget(target: string): Promise<void> {
    const f = this.resolveVaultFile(target) ?? (target.includes(".") ? null : this.resolveVaultFile(`${target}.md`));
    if (f) await this.app.workspace.getLeaf(false).openFile(f);
  }

  /** One row per ACP tool call, grouped into the current run's collapsible
   *  block (W1.3/W1.4). Updates look the row up by toolCallId and re-render in
   *  place — ACP resends only changed fields (the target often arrives on the
   *  second update, and the title is absent from `completed`). */
  private addOrUpdateToolCall(ev: Extract<StreamEvent, { type: "tool_call" }>) {
    let entry = this.toolRows.get(ev.toolCallId);
    if (!entry) this.ensureActivityGroup();
    const item = applyToolEvent(entry?.item, ev);
    if (!entry) {
      const rowEl = this.activityBodyEl!.createDiv({ cls: "oc-tool" });
      const iconEl = rowEl.createSpan({ cls: "oc-tool-icon" });
      const verbEl = rowEl.createSpan({ cls: "oc-tool-verb" });
      const labelEl = rowEl.createSpan({ cls: "oc-tool-label" });
      const rightEl = rowEl.createSpan({ cls: "oc-tool-right" });
      entry = { item, items: this.activityItems, idx: this.activityItems.length, rowEl, iconEl, verbEl, labelEl, rightEl };
      this.toolRows.set(ev.toolCallId, entry);
      this.activityItems.push(item);
    } else {
      entry.item = item;
      entry.items[entry.idx] = item;
      // Already settled into the turn record (its group finalized) — keep that
      // copy current too, or the saved trail would show it still running.
      const ti = this.turnActivity.findIndex((i) => i.id === item.id);
      if (ti >= 0) this.turnActivity[ti] = item;
    }

    entry.iconEl.empty();
    setIcon(entry.iconEl, toolIcon(item.rawName, item.kind, item.status));
    entry.verbEl.setText(item.verb);
    entry.labelEl.setText(item.label);
    entry.rowEl.toggleClass("oc-tool-error", item.status === "failed");
    entry.rowEl.toggleClass("oc-tool-pending", item.status === "pending" || item.status === "in_progress");
    entry.rightEl.empty();
    if (item.diff) this.renderDiffStat(entry.rightEl, `+${item.diff.add} -${item.diff.del}`);
    const tip = [item.verb, item.target, item.durationSeconds !== undefined ? formatDuration(item.durationSeconds) : ""]
      .filter(Boolean)
      .join(" · ");
    if (tip) entry.rowEl.setAttribute("title", tip);
    // Path targets open the note on click (W7.6); only wire once per row.
    if (item.isPath && item.target && !entry.labelEl.hasClass("oc-tool-label-link")) {
      entry.labelEl.addClass("oc-tool-label-link");
      entry.labelEl.addEventListener("click", () => void this.openVaultTarget(item.target!));
    }

    if (item.status === "pending" || item.status === "in_progress") {
      this.activityLiveText = [item.verb, item.label].filter(Boolean).join(" ");
    }
    if (this.activityLabelEl && entry.items === this.activityItems) {
      const secs = (Date.now() - this.activityStartedAt) / 1000;
      this.activityLabelEl.setText(`${this.activityLiveText} · ${formatDuration(secs)}`);
    }
    this.scrollToBottom();
  }

  /** Renders/updates the harness plan checklist (W4.1).
   *
   *  The protocol replaces the entire entry list on every update, so this
   *  re-renders the rows in place and keeps the panel's transcript position.
   *  opencode emits no plans today — a harness that does gets the panel for
   *  free, and one that doesn't simply never shows it. */
  private updatePlan(entries: PlanEntry[]): void {
    if (!entries.length) return;
    if (!this.planEl) {
      const wrap = this.messagesEl.createDiv({ cls: "oc-plan" });
      wrap.setAttribute("data-expanded", "true");
      const header = wrap.createEl("button", { cls: "oc-plan-header", attr: { type: "button" } });
      header.createSpan({ cls: "oc-plan-title", text: "Plan" });
      const countEl = header.createSpan({ cls: "oc-plan-count" });
      const chevEl = header.createSpan({ cls: "oc-plan-chevron" });
      setIcon(chevEl, "chevron-down");
      const body = wrap.createDiv({ cls: "oc-plan-body" });
      this.wireCollapsible(header, wrap, (expanded) => {
        this.planUserToggled = true;
        chevEl.empty();
        setIcon(chevEl, expanded ? "chevron-down" : "chevron-right");
      });
      this.planEl = wrap;
      this.planBodyEl = body;
      this.planCountEl = countEl;
    }
    const done = entries.filter((e) => e.status === "completed").length;
    this.planCountEl?.setText(`${done}/${entries.length}`);
    const body = this.planBodyEl;
    if (!body) return;
    body.empty();
    for (const entry of entries) {
      const row = body.createDiv({ cls: "oc-plan-row" });
      row.setAttribute("data-status", entry.status);
      const iconEl = row.createSpan({ cls: "oc-plan-icon" });
      if (entry.status === "completed") {
        setIcon(iconEl, "check");
        iconEl.addClass("oc-plan-done");
      } else if (entry.status === "in_progress") {
        setIcon(iconEl, "loader");
        iconEl.addClass("oc-spin");
      } else {
        setIcon(iconEl, "circle");
      }
      const textEl = row.createSpan({ cls: "oc-plan-text" });
      textEl.setText(entry.content.length > 120 ? entry.content.slice(0, 120) + "…" : entry.content);
      if (entry.priority === "high") row.createSpan({ cls: "oc-plan-prio", attr: { title: "High priority" } });
    }
    const allDone = entries.every((e) => e.status === "completed");
    const anyRunning = entries.some((e) => e.status === "in_progress");
    if (!this.planUserToggled && this.planEl) {
      const expanded = anyRunning && !allDone;
      this.planEl.setAttribute("data-expanded", expanded ? "true" : "false");
      const chev = this.planEl.querySelector(".oc-plan-chevron");
      if (chev instanceof HTMLElement) {
        chev.empty();
        setIcon(chev, expanded ? "chevron-down" : "chevron-right");
      }
    }
    this.scrollToBottom();
  }

  /** Renders the harness's context/cost reading in the toolbar (W4.2).
   *  Hidden entirely until the harness reports one. */
  private updateUsage(u: UsageInfo): void {
    this.usage = u;
    if (!this.usageEl || !this.usageFillEl) return;
    const pct = u.size > 0 ? Math.min(100, (u.used / u.size) * 100) : 0;
    this.usageEl.toggleClass("oc-usage-warn", pct >= 70 && pct < 90);
    this.usageEl.toggleClass("oc-usage-critical", pct >= 90);
    this.usageEl.setAttribute("data-label", `ctx ${Math.round(pct)}%`);
    // Below 70% a context reading is trivia that costs a toolbar slot; the
    // tooltip still carries the exact numbers, so only surface it as a warning.
    this.usageEl.toggleClass("oc-toolbtn-hidden", pct < 70);
    const cost = u.cost
      ? ` · ${u.cost.currency === "USD" ? "$" : u.cost.currency + " "}${u.cost.amount.toFixed(2)}`
      : "";
    this.usageEl.setAttribute(
      "title",
      `${u.used.toLocaleString()} / ${u.size.toLocaleString()} tokens (${Math.round(pct)}%)${cost}`,
    );
  }

  // ---------- threaded, collapsible thinking (specs/002-acp-only-chat-ux US4) ----------
  //
  // `agent_thought_chunk` has no start/stop marker of its own (unlike some
  // vendor agent SDKs' content-block events — research.md R8), so a burst's boundary is
  // inferred here: it stays open across consecutive "reasoning" events and
  // closes the instant a "token" or "tool_call" event interrupts it.

  private pendingThought: {
    wrapperEl: HTMLElement;
    headerEl: HTMLElement;
    labelEl: HTMLElement;
    contentEl: HTMLElement;
    text: string;
    startedAt: number;
    timer: number | null;
  } | null = null;
  /** Reasoning bursts finalized so far in the current turn, attached to the
   *  assistant history entry for persistence (data-model.md Reasoning Block). */
  private pendingReasoningBursts: { text: string; durationSeconds?: number }[] = [];
  /** Session id applyConfigOverrides() last ran for — compared against
   *  acp.getSessionId() rather than tracked per AcpBridgeClient instance,
   *  since the same instance silently starts a new session id after a dead
   *  (404) session is replaced (e.g. the bridge restarted) without going
   *  through ensureAcp()'s "create a fresh client" branch. */
  private overridesAppliedForSessionId: string | null = null;

  private wireThoughtToggle(wrapperEl: HTMLElement, headerEl: HTMLElement) {
    this.wireCollapsible(headerEl, wrapperEl);
  }

  /** Appends one streamed reasoning chunk, opening a new block if none is
   *  currently open. */
  private addThoughtDelta(text: string) {
    // Some backends flush the reasoning stream with a trailing whitespace-only
    // chunk (e.g. a lone "\n") once real content is already done. Don't let
    // that open a block on its own; once one's open, appending it is harmless.
    if (!this.pendingThought && !text.trim()) return;
    if (!this.pendingThought) {
      // Thinking is part of the turn's work: it goes in the same group as the
      // tool calls around it, collapsed, instead of a block of its own.
      this.ensureActivityGroup();
      this.activityLiveText = "Thinking";
      const wrapperEl = this.activityBodyEl!.createDiv({ cls: "oc-thought-block" });
      wrapperEl.setAttribute("data-streaming", "true");
      wrapperEl.setAttribute("data-expanded", "false");
      const headerEl = wrapperEl.createDiv({ cls: "oc-thought-header" });
      headerEl.setAttribute("tabindex", "0");
      headerEl.setAttribute("role", "button");
      headerEl.setAttribute("aria-expanded", "false");
      headerEl.setAttribute("aria-label", "Extended thinking — click to expand");
      const labelEl = headerEl.createSpan({ cls: "oc-thought-label", text: "Thinking 0s…" });
      const contentEl = wrapperEl.createDiv({ cls: "oc-thought-content" });
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        labelEl.setText(`Thinking ${Math.floor((Date.now() - startedAt) / 1000)}s…`);
      }, 1000);
      this.wireThoughtToggle(wrapperEl, headerEl);
      this.pendingThought = { wrapperEl, headerEl, labelEl, contentEl, text: "", startedAt, timer };
    }
    const pt = this.pendingThought;
    pt.text += text;
    // Plain text while streaming: a full Markdown re-render per chunk is
    // quadratic, and the block is collapsed anyway. Rendered once at the end.
    pt.contentEl.setText(pt.text);
    this.scrollToBottom();
  }

  /** Closes the currently-open thought block (if any): freezes its label,
   *  auto-collapses it, and records the burst for persistence. A no-op if no
   *  block is open, so callers can call it unconditionally. */
  private finalizeThought() {
    const pt = this.pendingThought;
    if (!pt) return;
    if (pt.timer !== null) window.clearInterval(pt.timer);
    if (!pt.text.trim()) {
      // Nothing but whitespace ever streamed into this block — drop it
      // entirely rather than leave an empty "Thought for Ns" ghost behind.
      pt.wrapperEl.remove();
      this.pendingThought = null;
      return;
    }
    const durationSeconds = Math.floor((Date.now() - pt.startedAt) / 1000);
    pt.labelEl.setText(`Thought for ${durationSeconds}s`);
    renderMarkdown(this.plugin.app, pt.contentEl, pt.text, this.sessionPath, this).catch(() => pt.contentEl.setText(pt.text));
    this.activityThoughts++;
    pt.headerEl.setAttribute("aria-label", "Extended thinking — click to expand");
    pt.wrapperEl.setAttribute("data-streaming", "false");
    if (pt.text.trim()) this.pendingReasoningBursts.push({ text: pt.text, durationSeconds });
    this.pendingThought = null;
  }

  /** Renders a previously-saved reasoning burst, collapsed by default
   *  (FR-010), when reopening a session. */
  private renderStoredThought(parentEl: HTMLElement, text: string, durationSeconds?: number) {
    const wrapperEl = parentEl.createDiv({ cls: "oc-thought-block" });
    wrapperEl.setAttribute("data-streaming", "false");
    wrapperEl.setAttribute("data-expanded", "false");
    const headerEl = wrapperEl.createDiv({ cls: "oc-thought-header" });
    headerEl.setAttribute("tabindex", "0");
    headerEl.setAttribute("role", "button");
    headerEl.setAttribute("aria-expanded", "false");
    headerEl.setAttribute("aria-label", "Extended thinking — click to expand");
    headerEl.createSpan({ cls: "oc-thought-label", text: durationSeconds !== undefined ? `Thought for ${durationSeconds}s` : "Thought" });
    const contentEl = wrapperEl.createDiv({ cls: "oc-thought-content" });
    renderMarkdown(this.plugin.app, contentEl, text, this.sessionPath, this).catch(() => contentEl.setText(text));
    this.wireThoughtToggle(wrapperEl, headerEl);
  }

  private scrollToBottom() {
    if (!this.pinned) return; // reading back — don't yank the viewport (W2.3)
    if (this.jumpEl) this.jumpEl.hidden = true;
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Renders the streaming answer at most once per frame, one render at a
   *  time: a render per token is quadratic, and overlapping async renders
   *  into the same element can interleave. The latest text always wins. */
  private streamInto(md: HTMLElement, text: string) {
    this.streamTarget = { md, text };
    if (this.streamScheduled) return;
    this.streamScheduled = true;
    window.requestAnimationFrame(() => void this.flushStream());
  }

  private streamTarget: { md: HTMLElement; text: string } | null = null;
  private streamScheduled = false;

  private async flushStream(): Promise<void> {
    const target = this.streamTarget;
    this.streamTarget = null;
    if (target) {
      await renderMarkdown(this.plugin.app, target.md, target.text, this.sessionPath, this).catch(() => target.md.setText(target.text));
      // Only the bubble still being written keeps the cursor; a render that
      // lands after `done` must not put it back.
      target.md.toggleClass("streaming", target.md === this.pendingAssistantMd);
      this.scrollToBottom();
    }
    if (this.streamTarget) window.requestAnimationFrame(() => void this.flushStream());
    else this.streamScheduled = false;
  }

  // ---------- grounding / context ----------

  /** Attach the content of any `[[wikilink]]` targets in the query. */
  private async attachMentions(query: string, idx: VaultIndex): Promise<RetrievedNote[]> {
    // `[[…]]` typed directly by the user is a reference, not an attach request (W3.6).
    const targets = extractWikilinks(query).filter((t) => !this.referenceOnlyLinks.has(t));
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

  /** Citation chips (non-removable) followed by the removable context chips —
   *  one visual language for both (W3.5). */
  private renderChips(citations: string[]) {
    this.citations = citations;
    this.chipsEl.empty();
    for (const cite of citations) {
      const chip = this.chipsEl.createDiv({ cls: "oc-chip" });
      setIcon(chip.createSpan({ cls: "oc-chip-icon" }), "file-text");
      chip.createSpan({ cls: "oc-chip-label", text: cite.replace(/\.md$/, "") });
      const x = chip.createEl("button", { cls: "oc-chip-x", attr: { "aria-label": "Remove citation" } });
      setIcon(x, "x");
      x.addEventListener("click", () => {
        this.citations = this.citations.filter((c) => c !== cite);
        chip.remove();
      });
    }
    for (const ctx of this.contextChips) {
      const chip = this.chipsEl.createDiv({ cls: "oc-chip oc-chip-context" });
      const icon = ctx.kind === "selection" ? "text-select" : ctx.kind === "folder" ? "folder" : "file-text";
      setIcon(chip.createSpan({ cls: "oc-chip-icon" }), icon);
      chip.createSpan({ cls: "oc-chip-label", text: ctx.label });
      chip.setAttribute("title", ctx.path ?? ctx.label);
      const x = chip.createEl("button", { cls: "oc-chip-x", attr: { "aria-label": "Remove context" } });
      setIcon(x, "x");
      x.addEventListener("click", () => {
        this.contextChips = this.contextChips.filter((c) => c.id !== ctx.id);
        this.renderChips(this.citations);
      });
    }
    // Chips live inside the composer card now, so adding one can grow the card.
    this.applyComposerHeight();
    this.syncSendEnabled();
  }

  // ---------- vision attachments ----------

  /** Image attachment is always offered — whether the connected harness's model
   *  actually accepts images is a harness-side concern the plugin can't know
   *  generically (Constitution Principle II: no provider-specific logic here). */
  private visionEnabled(): boolean {
    return true;
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
    this.syncSendEnabled();
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

  // ---------- send / stream ----------

  private async send(queuedText?: string) {
    const text = (queuedText ?? this.composerEl.value).trim();
    if (!text) return;
    // Typing while the agent works queues instead of dropping (W2.4).
    if (this.streaming && queuedText === undefined) {
      this.enqueue(text);
      return;
    }
    // Only the fixed local commands are intercepted here. Anything else
    // starting with "/" — including a harness-declared command — is normal
    // prompt text: ACP has no separate command-invocation method, the
    // harness interprets "/" syntax in the prompt itself (research.md R7).
    if (!this.slashMenuEl) {
      const local = ChatView.LOCAL_COMMANDS.find((c) => c.name === text.split(" ")[0]);
      if (local) {
        this.runSlashCommand(local);
        this.composerEl.value = "";
        return;
      }
    }
    if (queuedText === undefined) this.composerEl.value = "";
    this.applyComposerHeight();
    this.pinned = true; // an explicit send always re-pins the transcript
    this.lastTurnText = text;
    this.lastTurnImages = [...this.pendingImages];
    this.streaming = true;
    this.setSendButtonMode("stop");
    this.addUserMessage(text, this.pendingImages);
    this.lastAssistantText = "";

    try {
      await this.sendViaAcp(text);
    } catch (err) {
      if (err instanceof AcpUnavailableError) {
        this.addStatusRow("error", `Host unavailable: ${err.message}`); // FR-012
      } else {
        this.addStatusRow("error", `Error: ${String((err as Error).message ?? err)}`);
      }
    } finally {
      this.clearPendingAttachments();
      this.clearContextChips();
      this.referenceOnlyLinks.clear();
      this.streaming = false;
      this.setSendButtonMode("send");
      await this.refreshToolbar();
      // Drain a queued follow-up now that the turn has fully settled (W2.4).
      if (this.queued && !this.draining) void this.sendQueued();
    }
  }

  /** Queues a message typed while the agent is still working (W2.4).
   *  The transcript only ever shows messages in send order, so the user
   *  message is echoed when the queue drains — not now. */
  private enqueue(text: string): void {
    if (this.queued) new Notice("Queued message replaced");
    this.queued = {
      text,
      images: [...this.pendingImages],
      textAttachments: [...this.pendingTextAttachments],
    };
    this.composerEl.value = "";
    this.clearPendingAttachments();
    this.applyComposerHeight();
    this.syncSendEnabled();
    this.renderQueue();
  }

  private renderQueue(): void {
    if (!this.queueEl) return;
    if (!this.queued) {
      this.queueEl.hidden = true;
      this.applyComposerHeight();
      return;
    }
    const preview = this.queued.text.length > 60 ? this.queued.text.slice(0, 60) + "…" : this.queued.text;
    this.queueTextEl.setText(`Queued · ${preview}`);
    this.queueEl.hidden = false;
    // The queue row is out of flow on the phone; re-stack before it paints.
    this.applyComposerHeight();
  }

  /** Sends exactly one queued message, echoing it like a normal send (W2.4). */
  private async sendQueued(): Promise<void> {
    if (!this.queued || this.draining) return;
    const item = this.queued;
    this.queued = null;
    this.renderQueue();
    this.draining = true;
    this.pendingImages = item.images;
    this.pendingTextAttachments = item.textAttachments;
    try {
      await this.send(item.text);
    } finally {
      this.draining = false;
    }
  }

  /** "Send now" — cancels the in-flight turn; the queue drains in `send()`'s
   *  finally, so the queued message goes out immediately after (W2.4). */
  private async steerQueued(): Promise<void> {
    if (!this.queued) return;
    await this.cancelStreaming();
  }

  private setSendButtonMode(mode: "send" | "stop") {
    if (!this.sendBtnEl) return;
    this.sendBtnEl.empty();
    setIcon(this.sendBtnEl, mode === "stop" ? "square" : "arrow-up");
    const label = mode === "stop" ? "Stop (Esc)" : "Send";
    this.sendBtnEl.setAttribute("aria-label", label);
    this.sendBtnEl.setAttribute("title", label);
    this.syncSendEnabled();
  }

  /** An empty composer's send button is decoration; a disabled one says so.
   *  While a turn is streaming the button is Stop and always active. */
  private syncSendEnabled(): void {
    if (!this.sendBtnEl) return;
    if (this.streaming) {
      this.sendBtnEl.disabled = false;
      return;
    }
    const hasContent =
      this.composerEl.value.trim().length > 0 ||
      this.pendingImages.length > 0 ||
      this.pendingTextAttachments.length > 0;
    this.sendBtnEl.disabled = !hasContent;
  }

  /** session/cancel (FR-005 acceptance scenario 2: cancel stops streaming promptly). */
  private async cancelStreaming() {
    if (this.acp) await this.acp.cancel();
  }

  /** Borrows the plugin-owned ACP client and wires this view's listeners,
   *  without connecting — safe to call repeatedly (idempotent). The client
   *  itself is NOT owned here: it outlives the view (see `detachAcp`). */
  private ensureAcp(): AcpBridgeClient {
    if (!this.acp) {
      this.acp = this.plugin.acp();
      this.acpUnsubscribers.push(
        this.acp.onEvent((e) => this.handleStreamEvent(e)),
        this.acp.onPermissionRequest((p) => void this.handlePermissionRequest(p)),
        // Agent mode / thinking level / "/" commands are entirely harness-declared
        // (specs/002-acp-only-chat-ux R5/R6/R7) — re-render whenever they change.
        this.acp.onStateChange(() => {
          this.refreshToolbar();
          this.updateConnection();
        }),
      );
    }
    return this.acp;
  }

  /** Drops this view's subscriptions without touching the session. */
  private detachAcp(): void {
    for (const unsubscribe of this.acpUnsubscribers) unsubscribe();
    this.acpUnsubscribers = [];
    this.acp = null;
  }

  /** Sends one turn over ACP (contracts/plugin-bridge-acp.md). Unlike the old
   *  gateway, the harness owns conversation state once a session exists, so
   *  only this turn's content blocks are sent — not the full history. */
  private async sendViaAcp(text: string) {
    const acp = this.ensureAcp();
    this.pendingReasoningBursts = [];
    this.toolRows.clear();
    this.lastFinishedBodyEl = null;
    this.turnSettled = false;
    this.acpHistory.push({ role: "user", content: text, images: this.pendingImages.length ? this.pendingImages : undefined });
    try {
      await acp.connect();
      const sid = acp.getSessionId();
      if (sid && sid !== this.overridesAppliedForSessionId) {
        this.overridesAppliedForSessionId = sid;
        await this.applyConfigOverrides();
        await this.refreshToolbar();
      }
      const blocks = await this.buildAcpPromptBlocks(text);
      await acp.prompt(blocks);
    } finally {
      this.turnSettled = true; // covers the error path — "done" never fires then
      this.finalizeThought(); // catch any block still open at turn end
      this.finalizeActivityGroup(); // settle/collapse the run's activity group
      // Snapshot the turn's writes for the changes card before the array resets.
      const finishedActivity = [...this.turnActivity];
      // Persist whatever we have — including just the user's message, or a
      // reasoning burst with no final reply — even if the connection failed,
      // the turn errored, or the harness never replied, so a record always
      // lands in the folder (FR-003) instead of being silently lost.
      if (this.lastAssistantText || this.pendingReasoningBursts.length || this.turnActivity.length) {
        this.acpHistory.push({
          role: "assistant",
          content: this.lastAssistantText,
          reasoning: this.pendingReasoningBursts.length ? this.pendingReasoningBursts : undefined,
          activity: this.turnActivity.length ? [...this.turnActivity] : undefined,
        });
      }
      this.lastAssistantText = "";
      this.pendingReasoningBursts = [];
      this.turnActivity = [];
      this.renderChangesCard(finishedActivity);
      try {
        await this.persistSession(this.acpHistory);
      } catch (err) {
        new Notice(`Couldn't save session: ${String((err as Error).message ?? err)}`);
      }
    }
  }

  /** Builds this turn's ACP prompt content blocks: `@mention`-attached note
   *  content and advisory `.chat/rules.md`/vault-rules context (still
   *  reaching the harness as context, per data-model.md's correction —
   *  `.chat/rules.md` is not an access-control gate), then the user's text
   *  and any image attachments (US3: FR-009 @mention carryover). */
  private async buildAcpPromptBlocks(text: string): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = [];
    // Context chips ride with this turn (W3.5): selection first, then note
    // references. Note bodies are read now, not when the chip was added, so a
    // long-lived chip can never carry a stale body.
    for (const chip of this.contextChips) {
      if (chip.kind === "selection" && chip.text) {
        const lines = chip.startLine && chip.endLine ? ` lines="${chip.startLine}-${chip.endLine}"` : "";
        blocks.push({
          type: "text",
          text: `# Selected text\n<editor_selection path="${chip.path ?? "unknown"}"${lines}>\n${chip.text}\n</editor_selection>`,
        });
      } else if (chip.kind === "folder" && chip.path) {
        blocks.push({ type: "text", text: `# Folder reference\n[[${chip.path}]]` });
      } else if (chip.path) {
        const f = this.plugin.app.vault.getAbstractFileByPath(chip.path);
        if (f instanceof TFile) {
          const content = await this.plugin.app.vault.cachedRead(f);
          const body = content.length > 20000 ? content.slice(0, 20000) + "\n…[truncated]" : content;
          blocks.push({
            type: "text",
            text: `# Note context\n[[${chip.path.replace(/\.md$/, "")}]]\n\n${body}`,
          });
        }
      }
    }
    const mentioned = await this.attachMentions(text, this.plugin.index);
    if (mentioned.length) {
      const ctx = mentioned.map((n) => `## [[${n.rel.replace(/\.md$/, "")}]]\n${n.snippet}`).join("\n\n");
      blocks.push({ type: "text", text: `# Mentioned context\n\n${ctx}` });
    }
    if (this.plugin.settings.injectVaultRules) {
      const rules = await this.readAdvisoryRulesContext(mentioned[0]?.rel);
      if (rules) blocks.push({ type: "text", text: `# Vault rules\n\n${rules}` });
    }
    this.renderChips(mentioned.map((n) => n.rel));
    blocks.push({ type: "text", text });
    for (const img of this.pendingImages) {
      const m = /^data:([^;]+);base64,(.*)$/.exec(img.dataUrl);
      if (m) blocks.push({ type: "image", data: m[2], mimeType: m[1] });
    }
    return blocks;
  }

  /** Top-level vault-rules.md/.chat/rules.md/AGENTS.md + nearest-folder
   *  `.chat/rules.md`, unchanged from `assembleGrounding`'s existing
   *  behavior — advisory instruction text, not an access-control gate. */
  private async readAdvisoryRulesContext(primaryNotePath?: string): Promise<string> {
    let vaultRules: string | undefined;
    for (const p of ["vault-rules.md", ".chat/rules.md", "AGENTS.md"]) {
      const f = this.plugin.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) vaultRules = (vaultRules ? vaultRules + "\n\n" : "") + (await this.plugin.app.vault.cachedRead(f));
    }
    if (primaryNotePath) {
      const folderRules = await this.readNearestFolderRules(primaryNotePath);
      if (folderRules) vaultRules = (vaultRules ? vaultRules + "\n\n" : "") + folderRules;
    }
    return vaultRules ?? "";
  }

  /** ACP's `ToolCallLocation.path` is documented as an absolute filesystem
   *  path, but Obsidian's vault API needs a vault-relative one, and the
   *  plugin has no reliable way to know the harness's configured working
   *  directory (Constitution Principle II — no harness-specific config in
   *  the plugin). Resolve defensively: try the path as given, then
   *  progressively shorter suffixes, until one matches a real vault file. A
   *  path that matches nothing (e.g. a not-yet-created file) correctly
   *  returns null. */
  private resolveVaultFile(path: string): TFile | null {
    if (!path) return null;
    const direct = this.plugin.app.vault.getAbstractFileByPath(path);
    if (direct instanceof TFile) return direct;
    const segments = path.split("/").filter(Boolean);
    for (let i = 1; i < segments.length; i++) {
      const f = this.plugin.app.vault.getAbstractFileByPath(segments.slice(i).join("/"));
      if (f instanceof TFile) return f;
    }
    return null;
  }

  /** Maps ACP's `session/request_permission` onto an inline approval card
   *  (persistent per-tool allow/deny, session-lifetime Undo) —
   *  specs/002-acp-only-chat-ux User Story 2. Always shown the same way
   *  regardless of agent mode — mode is entirely harness-owned (FR-007); if
   *  a harness's active mode means it won't propose a write, this method is
   *  simply never called for it. */
  private async handlePermissionRequest(p: PendingPermissionRequest) {
    if (!this.acp) return;
    const s = this.plugin.settings;
    const toolCall = p.request.toolCall as any;
    const action = toolCall.title ?? toolCall.kind ?? "tool";
    const rawPath = toolCall.locations?.[0]?.path ?? "";
    const preview: WritePreview = {
      action,
      path: rawPath,
      summary: toolCall.title ?? action,
      diff: toolCallContentLines(toolCall.content, "completed"),
    };
    const pickOption = (kind: string) => p.request.options.find((o) => o.kind === kind);
    const respond = async (allowed: boolean, remember: boolean) => {
      const kind = allowed ? (remember ? "allow_always" : "allow_once") : "reject_once";
      const option = pickOption(kind) ?? p.request.options[0];
      if (option && this.acp) await this.acp.respondPermission(p.requestId, option.optionId);
    };

    // Persistent per-tool decision (Copilot semantics) — bypasses the card
    // entirely for an action the user already decided on.
    if (s.toolAllowlist[action] !== undefined) {
      await respond(s.toolAllowlist[action], false);
      return;
    }

    const handle = renderApprovalCard(this.messagesEl, preview, async (d) => {
      if (d.remember) {
        s.toolAllowlist[action] = d.allowed;
        await this.plugin.saveSettings();
      }
      // Snapshot BEFORE sending the approval response, so it reflects
      // pre-write state (data-model.md Undo Snapshot).
      let snapshot: { existed: boolean; content: string } | null = null;
      if (d.allowed) {
        const f = this.resolveVaultFile(rawPath);
        snapshot = f ? { existed: true, content: await this.plugin.app.vault.cachedRead(f) } : { existed: false, content: "" };
        // Remember the first pre-write state per path so the changes card can
        // undo the whole session's work on that file (W7.5).
        if (rawPath && !this.writeSnapshots.has(rawPath)) this.writeSnapshots.set(rawPath, snapshot);
      }
      await respond(d.allowed, !!d.remember);
      handle.settle({
        allowed: d.allowed,
        onUndo: d.allowed
          ? async () => {
              try {
                const f = this.resolveVaultFile(rawPath);
                if (snapshot?.existed) {
                  if (f) await this.plugin.app.vault.modify(f, snapshot.content);
                  else new Notice(`Couldn't find ${rawPath} to restore`);
                } else if (f) {
                  await this.plugin.app.vault.trash(f, false);
                }
              } catch (err) {
                new Notice(`Undo failed: ${String((err as Error).message ?? err)}`);
              }
            }
          : undefined,
      });
    });
  }

  private async handleStreamEvent(e: StreamEvent) {
    switch (e.type) {
      case "token":
        this.finalizeThought();
        this.finalizeActivityGroup();
        if (!this.pendingAssistantMd) {
          // A second bubble in the same turn (text, work, more text): keep the
          // saved reply readable as one message.
          if (this.lastAssistantText) this.lastAssistantText += "\n\n";
          this.pendingAssistantMd = this.beginAssistantMessage();
        }
        this.pendingAcc += e.text;
        this.lastAssistantText += e.text;
        this.streamInto(this.pendingAssistantMd, this.pendingAcc);
        break;
      case "reasoning":
        if (this.turnSettled) break; // stale post-done notification — see turnSettled
        this.addThoughtDelta(e.text);
        break;
      case "tool_call":
        this.finalizeThought();
        this.addOrUpdateToolCall(e);
        break;
      case "plan":
        this.finalizeThought();
        this.updatePlan(e.entries);
        break;
      case "usage":
        this.updateUsage(e);
        break;
      case "session_info":
        // W7.11: the harness titles the session after its first exchange. Adopt
        // it only while the name is still ours to choose (not loaded/renamed).
        if (e.title && !this.titleLocked) {
          this.sessionTitle = e.title;
          this.refreshTitleChrome();
        }
        break;
      case "done":
        this.turnSettled = true;
        this.finalizeThought();
        this.finalizeActivityGroup();
        this.markRegenerable(this.lastAssistantBlockEl);
        if (this.pendingAssistantMd) this.pendingAssistantMd.removeClass("streaming");
        this.pendingAssistantMd = null;
        this.pendingAcc = "";
        // A turn that stopped for any reason but a normal finish says so —
        // otherwise a length or step limit reads as the answer being cut off.
        {
          const why = STOP_REASON_TEXT[e.finishReason ?? ""];
          if (why) this.addStatusRow("notice", why);
        }
        // Session persistence now happens in sendViaAcp() once session/prompt
        // resolves, using acpHistory — see data-model.md Session.
        break;
      case "error":
        this.finalizeThought();
        this.finalizeActivityGroup();
        this.addStatusRow("error", e.message);
        break;
    }
  }

  private pendingAssistantMd: HTMLElement | null = null;
  private pendingAcc = "";
  private lastAssistantText = "";
  /** False only while a turn is in flight (set in sendViaAcp, cleared on
   *  "done"). opencode's ACP server has a known protocol violation where it
   *  resolves `session/prompt` (stopReason: end_turn) before its own
   *  session/update pipeline finishes flushing — anomalyco/opencode#17505,
   *  #18672 — so a stray `agent_thought_chunk` notification can arrive over
   *  our persistent SSE stream after we've already rendered the final answer
   *  and marked the turn done. Since real reasoning always precedes the
   *  answer, a reasoning burst that shows up once the turn has settled is
   *  that stale artifact, not new content — drop it instead of opening a
   *  trailing "Thought for Ns" block for it. */
  private turnSettled = true;

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
    // No `model`/`provider` field — the plugin doesn't know this in the ACP
    // world (Constitution Principle II; data-model.md Session).
    // `created` is the session's own birthday, so it is kept across re-saves
    // (and across a reopen, where loadSession reads it back from the note).
    const now = Date.now();
    this.sessionCreated ??= now;
    const title = this.ensureSessionTitle(messages);
    const meta = {
      created: this.sessionCreated,
      updated: now,
      tokens: approxTokens(messages),
      title,
    };
    const body = metaToFrontmatter(meta) + "\n" + renderBody(title, messages);
    const f = this.plugin.app.vault.getAbstractFileByPath(this.sessionPath);
    if (f instanceof TFile) await this.plugin.app.vault.modify(f, body);
    else await this.plugin.app.vault.create(this.sessionPath, body);
    this.plugin.currentSessionPath = this.sessionPath;
  }

  /** Chooses the name a not-yet-named session will be saved under. */
  private ensureSessionTitle(messages: ChatMessage[]): string {
    if (this.sessionTitle) return this.sessionTitle;
    const firstQuestion = messages.find((m) => m.role === "user")?.content ?? "";
    const derived = titleFromText(firstQuestion);
    this.sessionTitle = derived;
    this.refreshTitleChrome();
    return derived;
  }

  /** Updates the header label, then asks the leaf to refresh the tab and the
   *  phone's native bar. Frontmatter writes belong to the rename path. */
  private refreshTitleChrome(): void {
    const span = this.contentEl?.querySelector(".oc-session-title");
    if (span instanceof HTMLElement) span.setText(this.sessionTitle ?? "New chat");
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
  }

  /** Click-to-rename in the header. Frontmatter only: the filename stays the
   *  stable timestamped id, so no link or store path can break. */
  private beginTitleRename(): void {
    const btn = this.titleBtnEl;
    const parent = btn?.parentElement;
    // The button is swapped for the field, never wrapped around it: an <input>
    // inside a <button> is invalid and swallows focus on some platforms.
    if (!btn || !parent || parent.querySelector(".oc-session-rename")) return;
    const current = this.sessionTitle ?? "";
    btn.hidden = true;
    const input = parent.createEl("input", {
      cls: "oc-session-rename",
      attr: { type: "text", placeholder: "Session name", value: current, "aria-label": "Session name" },
    });
    input.focus();
    input.select();
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      input.remove();
      btn.hidden = false;
      btn.empty();
      btn.createSpan({ cls: "oc-session-title", text: this.sessionTitle ?? "New chat" });
      if (!commit || !next || next === current) return;
      this.sessionTitle = next;
      this.titleLocked = true;
      this.refreshTitleChrome();
      await this.writeTitleToNote(next);
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void finish(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener("blur", () => void finish(true));
  }

  /** Rename persistence goes through Obsidian's own frontmatter helper, so the
   *  note body, its canonical transcript block, and any unrelated keys survive. */
  private async writeTitleToNote(title: string): Promise<void> {
    if (!this.sessionPath) return;
    const f = this.app.vault.getAbstractFileByPath(this.sessionPath);
    if (!(f instanceof TFile)) return;
    try {
      await this.app.fileManager.processFrontMatter(f, (fm) => {
        fm.title = title;
      });
    } catch (err) {
      new Notice(`Couldn't rename session: ${String((err as Error).message ?? err)}`);
    }
  }

  private async newSession() {
    this.hideSlash();
    if (this.pendingThought?.timer !== null && this.pendingThought?.timer !== undefined) {
      window.clearInterval(this.pendingThought.timer);
    }
    this.pendingThought = null;
    this.pendingReasoningBursts = [];
    this.hideWelcome();
    this.messagesEl.empty();
    this.renderChips([]);
    this.sessionPath = "";
    this.sessionCreated = null;
    this.sessionTitle = null;
    this.titleLocked = false;
    this.refreshTitleChrome();
    this.acpHistory = [];
    this.detachAcp();
    await this.plugin.closeAcpSession();
    await this.refreshToolbar(); // hide mode/thinking controls until the new session reconnects
    void this.ensureAcp()
      .connect()
      .then(() => this.refreshToolbar())
      .catch(() => {});
    // A fresh session opens on the welcome panel, not on a lone system line.
    this.showWelcome();
    this.applyComposerHeight();
    this.syncSendEnabled();
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

  /** Reopens a saved session note. This rebuilds BOTH the visible transcript
   *  and `acpHistory` — without the latter, the next turn would persist only
   *  itself and overwrite the reopened note.
   *
   *  Note that this restores the *record*, not the agent's memory: the harness
   *  session behind a reopened note is gone, so the agent does not have this
   *  conversation in context. Resuming it (ACP `session/load`/`session/resume`)
   *  is tracked in docs/TODO-session-continuity.md. */
  private async loadSession(path: string) {
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    const body = await this.plugin.app.vault.cachedRead(f);
    const messages = parseSessionNote(body);
    // Until ACP resumption lands (docs/TODO-session-continuity.md) a reopened
    // note cannot be rejoined on the harness. Opening a *different*
    // conversation therefore ends the live one — otherwise the next turn would
    // append to this note while the agent is still holding another
    // conversation in context.
    const replacedLiveSession = this.plugin.currentSessionPath !== path && this.plugin.hasLiveAcpSession();
    if (replacedLiveSession) {
      this.detachAcp();
      await this.plugin.closeAcpSession();
    }
    this.hideWelcome();
    this.messagesEl.empty();
    this.sessionPath = path;
    const meta = parseSessionMeta(body);
    this.sessionCreated = meta?.created ?? null;
    // Named notes keep their name; legacy notes borrow their first question so
    // an old conversation still identifies itself in the header and tab.
    const firstQuestion = messages.find((m) => m.role === "user")?.content ?? "";
    this.sessionTitle = meta?.title ?? (firstQuestion ? titleFromText(firstQuestion) : null);
    this.titleLocked = Boolean(this.sessionTitle);
    this.refreshTitleChrome();
    this.acpHistory = messages;
    for (const message of messages) this.renderStoredMessage(message);
    if (replacedLiveSession) this.addSystemMessage("Reopened. The agent doesn't have this conversation in context yet.");
    this.scrollToBottom();
  }

  /** Renders one persisted message back into the transcript, with thoughts
   *  (FR-010) and activity (W7.4) restored collapsed. */
  private renderStoredMessage(message: ChatMessage): void {
    if (message.role === "assistant") {
      if (message.activity?.length || message.reasoning?.length) {
        this.renderStoredActivity(message.activity ?? [], message.reasoning ?? []);
      }
      if (message.content) {
        const md = this.beginAssistantMessage();
        renderMarkdown(this.plugin.app, md, message.content, this.sessionPath, this).catch(() =>
          md.setText(message.content),
        );
      }
      this.markRegenerable(this.lastAssistantBlockEl);
      return;
    }
    if (message.role === "user") {
      // Image bytes are deliberately not persisted (session/store.ts), so only
      // attachments that still carry data can be shown.
      this.addUserMessage(message.content, message.images?.filter((img) => img.dataUrl), false);
      return;
    }
    if (message.content) this.addSystemMessage(message.content);
  }

  // ---------- composer toolbar ----------

  /** Last real thought_level option seen this session — kept so the thinking
   *  button can render disabled (not hidden) when the current model doesn't
   *  support it, instead of disappearing (see refreshToolbar). */
  private lastThinkOption: SessionConfigOption | undefined;

  /** The harness's `thought_level`-category config option, if it declares
   *  one (falls back to a name-pattern match since `category` is optional in
   *  the schema) — specs/002-acp-only-chat-ux R6. */
  private findThinkingOption(): SessionConfigOption | undefined {
    const options = this.acp?.getConfigOptions();
    if (!options?.length) return undefined;
    return (
      options.find((o) => o.category === "thought_level") ??
      options.find((o) => /think|reasoning|effort/i.test(o.name))
    );
  }

  /** The harness's `model`-category config option, if it declares one — same
   *  mechanism as thinking level, just a different category and rendered
   *  with a search modal instead of a plain menu since a model list can be
   *  long (same distinction the old BYOK model picker made). */
  private findModelOption(): SessionConfigOption | undefined {
    const options = this.acp?.getConfigOptions();
    if (!options?.length) return undefined;
    return options.find((o) => o.category === "model") ?? options.find((o) => /model/i.test(o.name));
  }

  /** Agent mode as a `SessionConfigOption{category:"mode"}` — the fallback
   *  a harness uses when it doesn't implement ACP's dedicated
   *  `SessionModeState` primitive. Confirmed live against opencode: its
   *  `session/new` response carries no `modes` field at all, only a
   *  `{id:"mode", category:"mode", type:"select", ...}` config option — so
   *  without this fallback the agent-mode button never renders for it. */
  private findModeOption(): SessionConfigOption | undefined {
    const options = this.acp?.getConfigOptions();
    if (!options?.length) return undefined;
    return options.find((o) => o.category === "mode") ?? options.find((o) => /\bmode\b/i.test(o.name));
  }

  private async refreshToolbar() {
    // Model — same harness-declared mechanism as agent mode/thinking level,
    // via a "model"-category config option. No option declared = no button
    // (FR-008 pattern), not a placeholder.
    const modelOpt = this.findModelOption();
    const modelValues = modelOpt?.type === "select" ? flattenSelectOptions(modelOpt.options) : [];
    const hasModel = modelValues.length > 0;
    this.modelBtnEl.toggleClass("oc-toolbtn-hidden", !hasModel);
    if (hasModel && modelOpt?.type === "select") {
      const current = modelValues.find((o) => o.value === modelOpt.currentValue) ?? modelValues[0];
      const pinned = this.plugin.settings.pinnedModels.includes(current.value);
      const isDefault = this.plugin.settings.defaultModel === current.value;
      this.modelBtnEl.find(".oc-toolbtn-text").setText(current.name);
      this.modelPinEl.toggleClass("oc-toolbtn-hidden", !pinned);
      const hint = [`Model: ${current.name}`];
      if (pinned) hint.push("pinned");
      if (isDefault) hint.push("default for new sessions");
      this.modelBtnEl.setAttribute("title", hint.join(" · "));
    }

    // Agent mode — entirely harness-declared (FR-007), via either ACP's
    // dedicated SessionModeState or (opencode) a "mode"-category config
    // option. No modes declared via either = no button (FR-008). Icon is
    // per-mode-id where the id matches a well-known name (opencode's own
    // "build"/"plan"), falling back to a generic icon for anything else —
    // display-only, not a plugin-owned mode enum (FR-007 stays intact since
    // the mode set/switching itself is still 100% harness-declared).
    const modeItems = this.agentModeItems();
    this.agentBtnEl.toggleClass("oc-toolbtn-hidden", modeItems.length === 0);
    if (modeItems.length) {
      const current = modeItems.find((m) => m.current) ?? modeItems[0];
      setIcon(this.agentBtnEl.find(".oc-toolbtn-icon"), MODE_ICONS[current.id.toLowerCase()] ?? "workflow");
      this.agentBtnEl.find(".oc-toolbtn-text").setText(current.name);
      this.agentBtnEl.setAttribute("title", current.description ? `Agent mode: ${current.name} — ${current.description}` : `Agent mode: ${current.name}`);
    }

    // Thinking level — same mechanism, via the harness's thought_level config
    // option. Unlike model/mode, this button is never hidden: it's always
    // shown, greyed out (oc-toolbtn-disabled) whenever the current model/
    // harness doesn't currently declare the option, active when it does —
    // so it doesn't disappear/reappear as models are switched.
    const thinkOpt = this.findThinkingOption();
    if (thinkOpt) this.lastThinkOption = thinkOpt;
    const shownThinkOpt = thinkOpt ?? this.lastThinkOption;
    setIcon(this.thinkBtnEl.find(".oc-toolbtn-icon"), "brain");
    this.thinkBtnEl.toggleClass("oc-toolbtn-hidden", false);
    this.thinkBtnEl.toggleClass("oc-toolbtn-disabled", !thinkOpt);
    if (shownThinkOpt) {
      const label =
        shownThinkOpt.type === "boolean"
          ? shownThinkOpt.currentValue
            ? "On"
            : "Off"
          : flattenSelectOptions(shownThinkOpt.options).find((o) => o.value === shownThinkOpt.currentValue)?.name ?? shownThinkOpt.currentValue;
      this.thinkBtnEl.find(".oc-toolbtn-text").setText(label);
      this.thinkBtnEl.setAttribute(
        "title",
        thinkOpt ? `${shownThinkOpt.name}: ${label}` : `${shownThinkOpt.name}: not available for the current model`,
      );
    } else {
      this.thinkBtnEl.find(".oc-toolbtn-text").setText("Thinking");
      this.thinkBtnEl.setAttribute("title", "Thinking: not available for the current model/harness");
    }

    // attach button always visible (files + images)
    this.attachBtnEl.setAttribute("title", "Attach a file / image");
    // Re-measure compression now that labels/icons may have changed (W2.2).
    this.toolbarLayout?.refresh();
  }

  /** Opens the model picker: a click applies to this session, a pin reorders
   *  the list, and the target icon sets the new-session default — with the
   *  top row returning to the harness's own default. */
  private openModelPicker() {
    const opt = this.findModelOption();
    if (!opt || opt.type !== "select") {
      new Notice("This harness hasn't declared any selectable models.");
      return;
    }
    const items = flattenSelectOptions(opt.options);
    if (!items.length) return;
    const settings = this.plugin.settings;
    new AcpModelSuggestModal(this.plugin.app, items, {
      currentValue: opt.currentValue,
      pinned: settings.pinnedModels,
      defaultModel: settings.defaultModel,
      // Session-scoped on purpose: persisting the pick is what used to keep
      // every later session on a model that might no longer be usable.
      onChoose: (value) => void this.acp?.setConfigOption(opt.id, value),
      onTogglePin: (value) => this.togglePinnedModel(value),
      onSetDefault: (value) => this.setDefaultModel(value),
    }).open();
  }

  /** Re-renders the toolbar (pin marker / default hint) after the picker or
   *  the settings tab changed a model preference. */
  refreshModelPrefs(): void {
    void this.refreshToolbar();
  }

  /** Pin/unpin a model. Returns whether it is pinned now, so the open picker
   *  can update its row without waiting for a settings round-trip. */
  private async togglePinnedModel(value: string): Promise<boolean> {
    const pins = this.plugin.settings.pinnedModels;
    const pinned = !pins.includes(value);
    this.plugin.settings.pinnedModels = pinned ? [...pins, value] : pins.filter((p) => p !== value);
    await this.plugin.saveSettings();
    this.refreshModelPrefs();
    return pinned;
  }

  private async setDefaultModel(value: string | null): Promise<void> {
    this.plugin.settings.defaultModel = value;
    await this.plugin.saveSettings();
    this.refreshModelPrefs();
    new Notice(value ? `New sessions open on ${value}` : "New sessions use the harness default model");
  }

  /** Normalizes agent mode into one shape regardless of which of ACP's two
   *  mode mechanisms the harness uses (see findModeOption's note). */
  private agentModeItems(): Array<{ id: string; name: string; description?: string; current: boolean }> {
    const modes = this.acp?.getModes();
    if (modes?.availableModes?.length) {
      return modes.availableModes.map((m) => ({ id: m.id, name: m.name, description: m.description ?? undefined, current: m.id === modes.currentModeId }));
    }
    const opt = this.findModeOption();
    if (opt?.type === "select") {
      return flattenSelectOptions(opt.options).map((o) => ({ id: o.value, name: o.name, description: o.description ?? undefined, current: o.value === opt.currentValue }));
    }
    return [];
  }

  private showAgentMenu() {
    const items = this.agentModeItems();
    if (!items.length) return;
    const current = items.find((m) => m.current)?.id;
    const modes = this.acp?.getModes();
    openAcpPickerMenu(this.agentBtnEl, items, current, (item) => {
      if (modes) void this.acp?.setMode(item.id);
      else void this.acp?.setConfigOption(this.findModeOption()!.id, item.id);
      this.rememberConfigOverride("mode", item.id);
    });
  }

  private showThinkingMenu() {
    const opt = this.findThinkingOption();
    if (!opt) {
      new Notice(`${this.lastThinkOption?.name ?? "Thinking"} isn't available for the current model.`);
      return;
    }
    if (opt.type === "boolean") {
      const next = !opt.currentValue;
      void this.acp?.setConfigOption(opt.id, next);
      this.rememberConfigOverride(opt.id, next);
      return;
    }
    const items = flattenSelectOptions(opt.options).map((o) => ({ id: o.value, name: o.name }));
    if (!items.length) return;
    openAcpPickerMenu(this.thinkBtnEl, items, opt.currentValue, (item) => {
      void this.acp?.setConfigOption(opt.id, item.id);
      this.rememberConfigOverride(opt.id, item.id);
    });
  }

  /** Persists the user's choice (specs/002-acp-only-chat-ux) so the next
   *  session opens on the same mode/thinking level instead of whatever the
   *  harness's own raw default is — reapplied in applyConfigOverrides() right
   *  after connect(). Session-scoped only: a harness with no matching option
   *  simply ignores an unknown id. The model is NOT remembered this way — a
   *  one-off model pick must not become every session's model (that is what
   *  `defaultModel` is for), see openModelPicker(). */
  private rememberConfigOverride(optionId: string, value: string | boolean) {
    this.plugin.settings.acpConfigOverrides = { ...this.plugin.settings.acpConfigOverrides, [optionId]: value };
    void this.plugin.saveSettings();
  }

  /** Reapplies last-picked config options to a freshly connected session —
   *  called once per connect(), not on every turn, since setConfigOption is
   *  otherwise session-scoped only (data-model.md correction: the harness
   *  doesn't remember a plugin's prior choice across sessions on its own).
   *
   *  The model is resolved separately because it is the only option with a
   *  fallback chain: an explicit default wins, otherwise nothing is sent and
   *  the harness's own config decides. */
  private async applyConfigOverrides() {
    await this.applyDefaultModel();
    const overrides = this.plugin.settings.acpConfigOverrides;
    if (!overrides) return;
    const options = this.acp?.getConfigOptions() ?? [];
    for (const [optionId, value] of Object.entries(overrides)) {
      if (optionId === "model") continue; // owned by defaultModel (applyDefaultModel)
      if (optionId === "mode" && !options.some((o) => o.id === "mode")) {
        const modes = this.acp?.getModes();
        if (modes?.availableModes?.some((m) => m.id === value)) await this.acp?.setMode(String(value));
        continue;
      }
      if (options.some((o) => o.id === optionId)) await this.acp?.setConfigOption(optionId, value);
    }
  }

  /** Opens a new session on the configured default model — or on nothing at
   *  all, so the harness's own default wins. A default the harness no longer
   *  offers is reported and skipped rather than replayed: sending an unknown
   *  value leaves the session on an unusable model and the failure only
   *  surfaces later, as a provider error on the first prompt. */
  private async applyDefaultModel() {
    const opt = this.findModelOption();
    if (!opt || opt.type !== "select") return;
    const values = flattenSelectOptions(opt.options);
    const choice = resolveModelChoice(values, this.plugin.settings.defaultModel, opt.currentValue);
    if (choice.action === "set") {
      await this.acp?.setConfigOption(opt.id, choice.value);
      return;
    }
    if (choice.action === "missing") {
      new Notice(
        `Obsidian Chat: the default model "${choice.value}" isn't offered by this harness — using the harness default.`,
      );
    }
  }

  // ---------- @-mention / attach ----------

  /** Detect an in-progress `@query` or `[[query` token at the end of the
   *  message. Value-based (no `selectionStart` dependency) so it behaves
   *  exactly like the `/` slash menu. `wikilink` marks the `[[` trigger, which
   *  inserts a note reference without attaching its content (W3.6). */
  private activeMention(): { at: number; query: string; wikilink: boolean } | null {
    const val = this.composerEl.value;
    const m = val.match(/(?:^|[\s([{.,;:!?])@([^\s@\[\]]*)$/);
    if (m) return { at: val.length - m[1].length - 1, query: m[1], wikilink: false };
    const w = val.match(/\[\[([^\]\n]*)$/);
    if (w) return { at: val.length - w[1].length - 2, query: w[1], wikilink: true };
    return null;
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
    const end = act.wikilink ? act.at + 2 + act.query.length : act.at + 1 + act.query.length;
    new NoteMentionModal(this.plugin.app, items, (item) => this.applyMention(item, act.at, end, act.wikilink)).open();
  }

  /** Apply a chosen mention: insert a `[[wikilink]]` (note) or attach an image.
   *  `[[`-triggered links are recorded as reference-only so the note is offered
   *  to the agent by path rather than force-attached (W3.6). */
  private applyMention(item: MentionItem, start: number, end: number, wikilink = false) {
    if (item.kind === "image") {
      this.replaceComposerRange(start, end, wikilink ? `![[${item.path}]]` : "");
      if (!wikilink) void this.mentionImage(item.path);
    } else {
      this.replaceComposerRange(start, end, `[[${item.link}]]`);
      if (wikilink) this.referenceOnlyLinks.add(item.link);
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

  // ---------- slash commands (specs/002-acp-only-chat-ux User Story 5) ----------

  /** Fixed, plugin-local commands — always available, never sent to the
   *  harness. Everything else the "/" menu offers comes from the connected
   *  harness's declared `AvailableCommand`s (research.md R7). */
  private static LOCAL_COMMANDS = [
    { name: "/clear", hint: "Start a new session" },
    { name: "/help", hint: "Show available commands" },
  ];

  /** Merges the fixed local commands with whatever the connected harness
   *  currently declares, live (`available_commands_update`). */
  private allSlashCommands(): { name: string; hint: string }[] {
    const dynamic = (this.acp?.getCommands() ?? []).map((c) => ({ name: `/${c.name}`, hint: c.description ?? "" }));
    return [...ChatView.LOCAL_COMMANDS, ...dynamic];
  }

  private updateSlashMenu() {
    const val = this.composerEl.value;
    this.hideSlash();
    if (!val.startsWith("/") || val.includes("\n")) return;
    const first = val.trim().split(" ")[0];
    const filtered = this.allSlashCommands().filter((c) => c.name.startsWith(first));
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
    const cmd = this.allSlashCommands().find((c) => c.name === name);
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
    if (cmd.name === "/clear") {
      this.newSession();
      this.composerEl.value = "";
      return;
    }
    if (cmd.name === "/help") {
      this.addSystemMessage(this.allSlashCommands().map((c) => `${c.name} — ${c.hint}`).join("\n"));
      this.composerEl.value = "";
      return;
    }
    // A harness-declared command — the plugin doesn't execute it itself; fill
    // it into the composer so the user can add input, then send normally
    // (the harness interprets the "/" syntax in the prompt text — see send()).
    this.composerEl.value = `${cmd.name} `;
    this.composerEl.focus();
    const len = this.composerEl.value.length;
    this.composerEl.setSelectionRange(len, len);
  }

  private setStatus(txt: string) {
    this.addSystemMessage(txt);
  }

  async onClose() {
    this.toolbarLayout?.destroy();
    this.toolbarLayout = null;
    // The harness session deliberately outlives this view: closing the tab, or
    // Obsidian rebuilding the leaf on a layout change, must not end the
    // conversation. Only this view's subscriptions go away. The session is
    // ended explicitly by "New session" and by plugin unload.
    this.detachAcp();
  }
}

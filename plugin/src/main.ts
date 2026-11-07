/** Obsidian Chat plugin entry point.
 *  Registers the chat view (two layouts), the settings tab, a ribbon + command
 *  to open the chat, and owns the shared VaultIndex (read-only, for @mention). */
import { Plugin, WorkspaceLeaf, Platform, Notice, TFile, TFolder, FileSystemAdapter, type Editor } from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/chat-view";
import { ObsidianChatSettingTab, DEFAULT_SETTINGS, type ObsidianChatSettings } from "./settings";
import { VaultIndex } from "./retrieval/index";
import { AcpBridgeClient } from "./acp/client";
import { AcpHost } from "./host/server";
import { migrateDefaultModel, normalizePinnedModels } from "./chat/model-prefs";
import { SessionStore, type StoreAdapter } from "./session/store";
import type { ShellAttachConfig } from "./shell/types";
import { ShellRuntime } from "./shell/runtime";
import { ShellChatView, SHELL_VIEW_TYPE } from "./ui/shell-view";

export default class ObsidianChatPlugin extends Plugin {
  settings: ObsidianChatSettings = DEFAULT_SETTINGS;
  index!: VaultIndex;
  /** Present only on the host device: serves the harness and the vault. */
  host: AcpHost | null = null;
  /** Host-owned append-only conversation store (the chat UI is its viewer). */
  private sessionStore: SessionStore | null = null;
  /** New ACP shell runtime (US1 local attach; host relay arrives in US3). */
  private runtime: ShellRuntime | null = null;

  /** The ACP session outlives any single chat view. Closing the tab — or
   *  Obsidian re-laying out the workspace, which destroys and rebuilds the
   *  view — must not end the conversation on the harness, so the client is
   *  owned here and views merely subscribe to it. */
  private acpClient: AcpBridgeClient | null = null;
  private acpClientConfig: { baseUrl: string; token: string } | null = null;
  /** Note backing the live session, so a reopened view can restore its
   *  transcript instead of coming back blank in front of a live session. */
  currentSessionPath: string | null = null;

  /** The host's JSONL session store, created on first use from the vault adapter. */
  store(): SessionStore {
    if (!this.sessionStore) {
      this.sessionStore = new SessionStore(
        this.app.vault.adapter as unknown as StoreAdapter,
        this.settings.sessionStoreFolder || ".chat/sessions",
      );
    }
    return this.sessionStore;
  }

  /** The new shell attach configuration (US1 wires it to the client). */
  shellAttachConfig(): ShellAttachConfig {
    const shell = this.settings.shell;
    return {
      mode: shell.mode,
      command: shell.command,
      cwd: shell.cwd,
      remoteUrl: shell.remoteUrl,
      remoteToken: shell.remoteToken,
    };
  }

  /** The new shell runtime: local attach, record persistence, no legacy bridge. */
  shellRuntime(): ShellRuntime {
    if (!this.runtime) {
      this.runtime = new ShellRuntime({
        app: this.app,
        settings: () => ({
          shell: this.shellAttachConfig(),
          sessionStoreFolder: this.settings.sessionStoreFolder || ".chat/sessions",
          blacklistFolders: this.settings.blacklistFolders,
        }),
        store: () => this.store(),
        stopLegacy: async () => {
          await this.closeAcpSession();
          this.stopHost();
        },
        log: (message) => console.log(`[obsidian-chat shell] ${message}`),
      });
    }
    return this.runtime;
  }

  /** Opens the ACP shell view in a right-side pane (desktop) or a tab. */
  async activateShellView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(SHELL_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = Platform.isMobile ? workspace.getLeaf(true) : workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      if (leaf) await leaf.setViewState({ type: SHELL_VIEW_TYPE, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  /** The shared ACP client, rebuilt if the bridge settings changed under it. */
  acp(): AcpBridgeClient {
    // The host device talks to its own server over loopback with a token it
    // minted itself; every other device uses the configured host address.
    const { baseUrl, token } = this.host
      ? { baseUrl: `http://127.0.0.1:${this.host.port}`, token: this.host.localToken }
      : this.settings.gateway;
    if (this.acpClient && (this.acpClientConfig?.baseUrl !== baseUrl || this.acpClientConfig?.token !== token)) {
      void this.acpClient.close().catch(() => {});
      this.acpClient = null;
    }
    if (!this.acpClient) {
      this.acpClient = new AcpBridgeClient({ baseUrl, token });
      this.acpClientConfig = { baseUrl, token };
    }
    return this.acpClient;
  }

  /** True when a conversation is live on the harness right now. */
  hasLiveAcpSession(): boolean {
    return !!this.acpClient?.getSessionId();
  }

  /** Ends the harness-side session for good — explicit "New session", or
   *  plugin unload. Ordinary view teardown must NOT call this. */
  async closeAcpSession(): Promise<void> {
    const client = this.acpClient;
    this.acpClient = null;
    this.acpClientConfig = null;
    this.currentSessionPath = null;
    if (client) await client.close().catch(() => {});
  }

  /** Re-applies view-scoped settings (density) to every open chat view (W6.9). */
  refreshOpenChatViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
      if (leaf.view instanceof ChatView) leaf.view.applyViewSettings();
    }
  }

  /** Re-renders the composer toolbar on every open chat view — model pins and
   *  the default are edited in settings as well as in the picker, so both
   *  surfaces have to agree immediately. */
  refreshChatToolbars(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
      if (leaf.view instanceof ChatView) leaf.view.refreshModelPrefs();
    }
  }

  /** Shared by the command and the editor context menu (W3.1). */
  private addEditorSelectionToChat(editor: Editor): void {
    const text = editor.getSelection().trim();
    if (!text) {
      new Notice("No text selected");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    void this.addSelectionContext({
      text,
      path: file?.path,
      startLine: editor.getCursor("from").line + 1,
      endLine: editor.getCursor("to").line + 1,
    });
  }

  /** Adds a selection chip to the chat and reveals it (W3.1). */
  async addSelectionContext(ctx: {
    text: string;
    path?: string;
    startLine?: number;
    endLine?: number;
  }): Promise<void> {
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0]?.view;
    if (!(view instanceof ChatView)) return;
    const lines = ctx.text.split(/\r?\n/).length;
    view.addContextChip({
      id: `selection:${ctx.path ?? "unknown"}:${ctx.startLine ?? 0}-${ctx.endLine ?? 0}:${ctx.text.slice(0, 32)}`,
      kind: "selection",
      label: `${lines} line${lines === 1 ? "" : "s"} selected`,
      path: ctx.path,
      text: ctx.text,
      startLine: ctx.startLine,
      endLine: ctx.endLine,
    });
    view.focusComposer();
  }

  /** Adds a note/folder reference chip to the chat and reveals it (W3.3). */
  async addPathContext(path: string, label: string, isFolder: boolean): Promise<void> {
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0]?.view;
    if (!(view instanceof ChatView)) return;
    view.addContextChip({
      id: `${isFolder ? "folder" : "note"}:${path}`,
      kind: isFolder ? "folder" : "note",
      label,
      path,
    });
    view.focusComposer();
  }

  async onload() {
    await this.loadSettings();
    this.index = new VaultIndex(this.app, () => this.settings.chatFolder, () => this.settings.blacklistFolders);

    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
    this.registerView(SHELL_VIEW_TYPE, (leaf) => new ShellChatView(leaf, this));

    this.addRibbonIcon("message-square", "Open Obsidian Chat", () => {
      this.activateView();
    });
    this.addRibbonIcon("terminal-square", "Open ACP Shell", () => {
      void this.activateShellView();
    });

    this.addCommand({
      id: "open-chat",
      name: "Open Obsidian Chat",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "open-acp-shell",
      name: "Open ACP Shell (new shell)",
      callback: () => void this.activateShellView(),
    });

    // W3.1: send the editor's current selection to the chat as context.
    this.addCommand({
      id: "add-selection-to-chat",
      name: "Add selection to chat context",
      editorCallback: (editor) => this.addEditorSelectionToChat(editor),
    });

    // Same action from the editor's right-click menu (desktop), matching how
    // native tooling surfaces selection actions (W3.1).
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!editor.getSelection().trim()) return;
        menu.addItem((item) =>
          item
            .setTitle("Add selection to Obsidian Chat")
            .setIcon("message-square-plus")
            .onClick(() => this.addEditorSelectionToChat(editor)),
        );
      }),
    );

    // Notes/folders from the file explorer (W3.3).
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const isFile = file instanceof TFile;
        const isFolder = file instanceof TFolder;
        if (!isFile && !isFolder) return;
        menu.addItem((item) =>
          item
            .setTitle(isFile ? "Add to Obsidian Chat" : "Mention folder in Obsidian Chat")
            .setIcon("message-square-plus")
            .onClick(() => void this.addPathContext(file.path, file.name, isFolder)),
        );
      }),
    );

    this.addCommand({
      id: "connection-info",
      name: "Connection info",
      callback: () => {
        void this.activateView().then(() => {
          const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0]?.view;
          if (view instanceof ChatView) view.openConnectionInfo();
        });
      },
    });

    // The harness reads credentials and provider config at startup, so a
    // rotated key is invisible to a long-running child. Reloading it is how
    // that takes effect without quitting Obsidian — on the host itself or,
    // through the host bridge, from any paired device.
    this.addCommand({
      id: "restart-harness",
      name: "Restart harness",
      checkCallback: (checking) => {
        const local = Platform.isDesktopApp && this.settings.host.enabled;
        const remote = !!this.settings.gateway.baseUrl.trim() && !!this.settings.gateway.token.trim();
        if (!local && !remote) return false;
        if (!checking) void this.restartHarness();
        return true;
      },
    });

    this.addSettingTab(new ObsidianChatSettingTab(this.app, this));

    this.startHost();
    // onunload() only fires on plugin disable/reload, NOT on a full Obsidian
    // quit — `beforeunload` is what Electron fires as the app closes, so it's
    // the only reliable place to stop the harness when the app itself quits.
    this.registerDomEvent(window, "beforeunload", () => this.stopHost());
  }

  onunload() {
    void this.runtime?.close();
    void this.closeAcpSession();
    this.stopHost();
  }

  /** On the device designated as host, serve the harness and the vault from
   *  inside Obsidian: nothing to install or keep running beyond Obsidian and
   *  the harness CLI itself. */
  startHost(): void {
    if (this.host || !Platform.isDesktopApp || !this.settings.host.enabled) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    if (!this.settings.host.command.trim()) {
      new Notice("Obsidian Chat: hosting is on but no harness command is set.");
      return;
    }
    this.host = new AcpHost({
      app: this.app,
      command: this.settings.host.command,
      port: this.settings.host.port,
      cwd: adapter.getBasePath(),
      devices: () => this.settings.host.devices,
      blacklist: () => this.settings.blacklistFolders,
      log: (msg) => console.log(`[obsidian-chat host] ${msg}`),
    });
    this.host.start();
  }

  stopHost(): void {
    this.host?.stop();
    this.host = null;
  }

  /** Reloads the harness child so it re-reads credentials and provider
   *  config. Runs locally on the host, or asks the host to do it when this
   *  device is a remote client. */
  async restartHarness(): Promise<void> {
    if (Platform.isDesktopApp && this.settings.host.enabled) {
      if (!this.settings.host.command.trim()) {
        new Notice("Obsidian Chat: no harness command is set.");
        return;
      }
      if (this.host) this.host.restartHarness();
      else this.startHost();
      new Notice("Obsidian Chat: restarting harness…");
      return;
    }
    const { baseUrl, token } = this.settings.gateway;
    if (!baseUrl.trim() || !token.trim()) {
      new Notice("Obsidian Chat: hosting is off and no host address/device code is set.");
      return;
    }
    try {
      await this.acp().restartHarness();
      new Notice("Obsidian Chat: harness restart requested");
    } catch (err) {
      new Notice(`Obsidian Chat: could not restart harness — ${String((err as Error).message ?? err)}`);
    }
  }

  /** Applies a changed host setting: drops the live session (it belonged to
   *  the old harness) and restarts the server. */
  async restartHost(): Promise<void> {
    await this.closeAcpSession();
    this.stopHost();
    this.startHost();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    if (leaves.length) {
      leaf = leaves[0];
    } else if (Platform.isMobile) {
      // Mobile: open as a full-page main leaf.
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    } else {
      // Desktop: dock as a right sidebar pane.
      leaf = workspace.getRightLeaf(false);
      if (!leaf) leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    const data = (await this.loadData()) ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // Older installs stored a harness directory; the host block is now
    // self-contained, so fill any missing fields from the defaults.
    this.settings.host = { ...DEFAULT_SETTINGS.host, ...(data.host ?? {}) };
    this.settings.shell = { ...DEFAULT_SETTINGS.shell, ...(data.shell ?? {}) };
    this.settings.sessionStoreFolder = data.sessionStoreFolder ?? DEFAULT_SETTINGS.sessionStoreFolder;
    this.settings.activityDensity = data.activityDensity ?? DEFAULT_SETTINGS.activityDensity;
    delete (this.settings.host as { harnessDir?: string }).harnessDir;
    // Model pins/defaults: pins become opaque strings (the pre-ACP BYOK
    // `{providerId, model}` entries are dropped), and a pre-pin install's
    // `acpConfigOverrides.model` is promoted to `defaultModel` exactly once so
    // upgrading doesn't silently change which model a session opens on.
    this.settings.pinnedModels = normalizePinnedModels((data as { pinnedModels?: unknown }).pinnedModels);
    const migrated = migrateDefaultModel(
      (data as { defaultModel?: unknown }).defaultModel,
      data.acpConfigOverrides as Record<string, string | boolean> | undefined,
    );
    this.settings.defaultModel = migrated.defaultModel;
    this.settings.acpConfigOverrides = migrated.overrides;
    // Write the upgrade back once, so a legacy `pinnedModels` array or a
    // `model` key inside `acpConfigOverrides` doesn't linger on disk and get
    // re-migrated (or misread by a downgrade) later.
    const onDiskPins = JSON.stringify((data as { pinnedModels?: unknown }).pinnedModels ?? []);
    const upgraded =
      onDiskPins !== JSON.stringify(this.settings.pinnedModels) ||
      (data as { defaultModel?: unknown }).defaultModel === undefined;
    if (upgraded) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

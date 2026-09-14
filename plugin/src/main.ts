/** Obsidian Chat plugin entry point.
 *  Registers the chat view (two layouts), the settings tab, a ribbon + command
 *  to open the chat, and owns the shared VaultIndex (read-only, for @mention). */
import { Plugin, WorkspaceLeaf, Platform, Notice, TFile, TFolder, type Editor } from "obsidian";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { existsSync } from "fs";
import { join, delimiter } from "path";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/chat-view";
import { ObsidianChatSettingTab, DEFAULT_SETTINGS, type ObsidianChatSettings } from "./settings";
import { VaultIndex } from "./retrieval/index";

export default class ObsidianChatPlugin extends Plugin {
  settings: ObsidianChatSettings = DEFAULT_SETTINGS;
  index!: VaultIndex;
  private mcpProxyProc: ChildProcessWithoutNullStreams | null = null;
  private bridgeProc: ChildProcessWithoutNullStreams | null = null;

  /** Re-applies view-scoped settings (density) to every open chat view (W6.9). */
  refreshOpenChatViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
      if (leaf.view instanceof ChatView) leaf.view.applyViewSettings();
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

    this.addRibbonIcon("message-square", "Open Obsidian Chat", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-chat",
      name: "Open Obsidian Chat",
      callback: () => this.activateView(),
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

    this.addSettingTab(new ObsidianChatSettingTab(this.app, this));

    this.startHostedHarness();
    // onunload() only fires on plugin disable/reload, NOT on a full Obsidian
    // quit (confirmed: it never runs in that path) — `beforeunload` is what
    // Electron actually fires as the window/app is closing, so it's the only
    // reliable place to stop these processes when the app itself quits.
    this.registerDomEvent(window, "beforeunload", () => this.stopHostedHarness());
  }

  onunload() {
    this.stopHostedHarness();
  }

  /** Spawns the harness's own long-lived processes (harness/README.md) as
   *  children of this Obsidian process, on the one device designated as
   *  host (settings.host.enabled) — so the harness lives and dies with the
   *  always-on Obsidian app instead of being a separately-managed service
   *  someone has to remember to restart by hand. */
  private startHostedHarness() {
    if (!Platform.isDesktopApp || !this.settings.host.enabled) return;
    const dir = this.settings.host.harnessDir;
    if (!dir) {
      new Notice("Obsidian Chat: harness hosting is enabled but no harness directory is set.");
      return;
    }
    const proxyScript = join(dir, "src", "mcp-rules-proxy.mjs");
    const bridgeScript = join(dir, "src", "acp-bridge.mjs");
    const configPath = join(dir, "harness.config.json");
    if (!existsSync(proxyScript) || !existsSync(bridgeScript) || !existsSync(configPath)) {
      new Notice(`Obsidian Chat: harness directory "${dir}" is missing acp-bridge.mjs, mcp-rules-proxy.mjs, or harness.config.json.`);
      return;
    }

    this.mcpProxyProc = this.spawnHarnessProcess("mcp-proxy", proxyScript, dir);
    this.bridgeProc = this.spawnHarnessProcess("bridge", bridgeScript, dir);
  }

  private spawnHarnessProcess(label: "mcp-proxy" | "bridge", script: string, cwd: string): ChildProcessWithoutNullStreams {
    // Obsidian's Electron process launches with a minimal PATH (no login-shell
    // init, so no nvm/homebrew entries) — a bare `spawn("node", ...)` fails
    // with ENOENT there even when `node` works in a terminal. Prepend the
    // common macOS install locations so resolution succeeds regardless.
    const extraDirs = ["/opt/homebrew/bin", "/usr/local/bin", `${process.env.HOME ?? ""}/.nvm/shims`];
    const path = [...extraDirs, process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin"].filter(Boolean).join(delimiter);
    const proc = spawn("node", [script], { cwd, env: { ...process.env, PATH: path } });
    proc.stdout.on("data", (chunk) => console.log(`[harness:${label}]`, chunk.toString().trimEnd()));
    proc.stderr.on("data", (chunk) => console.error(`[harness:${label}]`, chunk.toString().trimEnd()));
    proc.on("error", (err) => new Notice(`Obsidian Chat: harness ${label} failed to start — ${err.message}`));
    proc.on("exit", (code, signal) => {
      if (signal) return; // killed by stopHostedHarness()
      console.error(`[harness:${label}] exited unexpectedly (code ${code})`);
      new Notice(`Obsidian Chat: harness ${label} exited unexpectedly (code ${code}). Check the console.`);
    });
    return proc;
  }

  private stopHostedHarness() {
    this.bridgeProc?.kill();
    this.bridgeProc = null;
    this.mcpProxyProc?.kill();
    this.mcpProxyProc = null;
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

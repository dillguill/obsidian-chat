/** Obsidian Chat plugin entry point.
 *  Registers the chat view (two layouts), the settings tab, a ribbon + command
 *  to open the chat, and owns the shared VaultIndex + tool runner. */
import { Plugin, WorkspaceLeaf, Platform } from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/chat-view";
import { ObsidianChatSettingTab, DEFAULT_SETTINGS, type ObsidianChatSettings } from "./settings";
import { VaultIndex } from "./retrieval/index";
import { createToolRunner, type ToolRunner } from "./tools/runner";
import { createTavilyProvider } from "./search/tavily";
import { runInlineEdit } from "./ui/inline-edit";

export default class ObsidianChatPlugin extends Plugin {
  settings: ObsidianChatSettings = DEFAULT_SETTINGS;
  index!: VaultIndex;
  tools!: ToolRunner;

  async onload() {
    await this.loadSettings();
    this.index = new VaultIndex(this.app, () => this.settings.chatFolder, () => this.settings.blacklistFolders);
    this.tools = createToolRunner({
      searchProvider: () =>
        this.settings.tavily.enabled && this.settings.tavily.apiKey ? createTavilyProvider(this.settings.tavily.apiKey) : null,
    });

    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

    this.addRibbonIcon("message-square", "Open Obsidian Chat", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-chat",
      name: "Open Obsidian Chat",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "inline-edit",
      name: "Inline edit selection with Obsidian Chat",
      callback: () => void runInlineEdit(this.app, this),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (editor.getSelection()) {
          menu.addItem((i) =>
            i.setTitle("Inline edit with Obsidian Chat").setIcon("wand").onClick(() => void runInlineEdit(this.app, this))
          );
        }
      })
    );

    this.addSettingTab(new ObsidianChatSettingTab(this.app, this));
  }

  onunload() {}

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

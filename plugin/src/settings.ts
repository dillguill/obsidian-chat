/** Settings model + settings tab. The plugin is an ACP client only — model,
 *  provider, and tool-execution config all live on the harness (Constitution
 *  Principle II); this file only holds plugin-local UX/connection state. */
import { App, Platform, PluginSettingTab, Setting, setIcon, TextComponent } from "obsidian";
import type ObsidianChatPlugin from "./main";

/** ACP bridge connection (specs/001-acp-mcp-migration). No `model` field —
 *  the model/provider is a config value on the harness itself (Principle
 *  II), never chosen by the plugin. */
export interface GatewayConfig {
  baseUrl: string;
  token: string;
}

export interface ObsidianChatSettings {
  gateway: GatewayConfig;
  /** Where chat sessions are stored (vault-relative folder, e.g. "chat/"). */
  chatFolder: string;
  /** Folders the agent must not read/search/edit (vault-relative, e.g. "Private/").
   *  Defaults mirror this vault's own AGENTS.md mandate (Journals/, _attachments/,
   *  .trash/) — the harness's mcp-rules-proxy enforces the same list, so both
   *  ends stay in agreement (specs/003-workspace-parity W5.1). */
  blacklistFolders: string[];
  /** Inject vault-rules.md / .chat/rules.md / AGENTS.md as advisory context. */
  injectVaultRules: boolean;
  /** Transcript/activity density (specs/003-workspace-parity W6.9). */
  uiDensity: "comfortable" | "compact";
  /** Which key sends a message (W2.5): plain Enter, or Cmd/Ctrl+Enter. */
  sendShortcut: "enter" | "mod-enter";
  /** persistent per-tool decisions: toolName -> allowed (true) or denied (false).
   *  Set via the "Always allow this action" checkbox on an approval card, not a
   *  setting UI here — this is the only write-safety state the plugin owns.
   *  Agent mode and thinking level are entirely harness-declared
   *  (specs/002-acp-only-chat-ux FR-007) — no plugin-owned equivalent. */
  toolAllowlist: Record<string, boolean>;
  /** Last value picked for each harness-declared config option id (model,
   *  mode, thought_level, ...), reapplied to every new session right after
   *  connect() so it opens on the same choice instead of the harness's own
   *  raw default — which is not guaranteed to be usable (e.g. opencode's
   *  default model can be a paid-only one). The plugin still owns none of
   *  the values or their meaning (FR-008) — this is opaque id->value replay. */
  acpConfigOverrides: Record<string, string | boolean>;
  /** Harness process lifecycle (desktop only). When `enabled`, this device's
   *  plugin instance spawns harness/src/{acp-bridge,mcp-rules-proxy}.mjs as
   *  child processes on load and kills them on unload — the always-on
   *  Obsidian desktop app IS the server, so the harness never runs as a
   *  separately-managed process. Off by default: only the one designated
   *  host machine should turn this on; every other install (other desktops,
   *  mobile) stays a pure remote client of that host's bridge. */
  host: {
    enabled: boolean;
    /** Absolute path to the harness/ directory on this machine (contains
     *  src/acp-bridge.mjs, src/mcp-rules-proxy.mjs, harness.config.json). */
    harnessDir: string;
  };
}

export const DEFAULT_SETTINGS: ObsidianChatSettings = {
  gateway: { baseUrl: "http://127.0.0.1:8765", token: "" },
  chatFolder: "chat/",
  blacklistFolders: ["Journals/", "_attachments/", ".trash/"],
  injectVaultRules: true,
  uiDensity: "comfortable",
  sendShortcut: "enter",
  toolAllowlist: {},
  acpConfigOverrides: {},
  host: { enabled: false, harnessDir: "" },
};

export class ObsidianChatSettingTab extends PluginSettingTab {
  plugin: ObsidianChatPlugin;
  private blacklistInput: TextComponent | null = null;
  constructor(app: App, plugin: ObsidianChatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Obsidian Chat" });

    // Interface (W6.9/W2.5) — how the transcript and composer behave.
    containerEl.createEl("h4", { text: "Interface" });
    new Setting(containerEl)
      .setName("Density")
      .setDesc("Comfortable spacing, or a tighter transcript and activity list.")
      .addDropdown((d) =>
        d
          .addOption("comfortable", "Comfortable")
          .addOption("compact", "Compact")
          .setValue(this.plugin.settings.uiDensity)
          .onChange((v) => {
            this.plugin.settings.uiDensity = v === "compact" ? "compact" : "comfortable";
            this.save();
            this.plugin.refreshOpenChatViews();
          }),
      );
    // Desktop-only: a phone keyboard has no Cmd/Ctrl, where Return always
    // inserts a newline and the send button sends (W2.5).
    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName("Send shortcut")
        .setDesc("Which key sends a message. Cmd/Ctrl+Enter always sends either way.")
        .addDropdown((d) =>
          d
            .addOption("enter", "Enter")
            .addOption("mod-enter", "Cmd/Ctrl+Enter")
            .setValue(this.plugin.settings.sendShortcut)
            .onChange((v) => {
              this.plugin.settings.sendShortcut = v === "mod-enter" ? "mod-enter" : "enter";
              this.save();
            }),
        );
    }

    containerEl.createEl("h4", { text: "ACP bridge" });
    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Your always-on machine's ACP bridge over Tailscale, e.g. https://100.x.y.z:8765")
      .addText((t) =>
        t.setValue(this.plugin.settings.gateway.baseUrl).onChange((v) => {
          this.plugin.settings.gateway.baseUrl = v;
          this.save();
        }),
      );
    new Setting(containerEl)
      .setName("Device token")
      .setDesc("Per-device bearer token from the harness tokens.json.")
      .addText((t) => {
        t.inputEl.type = "password";
        return t.setValue(this.plugin.settings.gateway.token).onChange((v) => {
          this.plugin.settings.gateway.token = v;
          this.save();
        });
      });

    if (Platform.isDesktopApp) {
      containerEl.createEl("h4", { text: "Harness hosting (this device)" });
      containerEl.createEl("p", {
        text: "Only the always-on machine should enable this. It spawns the harness's acp-bridge and mcp-rules-proxy as child processes when Obsidian starts and kills them when it quits — every other device just connects to that machine's Base URL above.",
        cls: "setting-item-description",
      });
      new Setting(containerEl)
        .setName("Host the harness on this device")
        .setDesc("Requires reloading the plugin (or restarting Obsidian) to take effect.")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.host.enabled).onChange((v) => {
            this.plugin.settings.host.enabled = v;
            this.save();
          }),
        );
      new Setting(containerEl)
        .setName("Harness directory")
        .setDesc("Absolute path to the harness/ folder (contains src/acp-bridge.mjs, harness.config.json).")
        .addText((t) =>
          t
            .setPlaceholder("/path/to/obsidian-chat/harness")
            .setValue(this.plugin.settings.host.harnessDir)
            .onChange((v) => {
              this.plugin.settings.host.harnessDir = v;
              this.save();
            }),
        );
    }

    containerEl.createEl("h4", { text: "Grounding" });
    new Setting(containerEl)
      .setName("Inject vault rules")
      .setDesc("Read vault-rules.md / AGENTS.md into the turn as advisory context.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.injectVaultRules).onChange((v) => {
          this.plugin.settings.injectVaultRules = v;
          this.save();
        }),
      );

    containerEl.createEl("h4", { text: "Chat storage" });
    new Setting(containerEl)
      .setName("Session folder")
      .setDesc("Where chat sessions are stored (vault-relative). Default: chat/")
      .addText((t) => {
        t.setPlaceholder("chat/");
        return t.setValue(this.plugin.settings.chatFolder).onChange((v) => {
          this.plugin.settings.chatFolder = v;
          this.save();
        });
      });

    containerEl.createEl("h4", { text: "Permissions" });
    new Setting(containerEl)
      .setName("Blacklist folders")
      .setDesc("Folders the agent can't read, search, or edit. Type to autocomplete, press Enter or + to add.")
      .addText((t) => {
        this.blacklistInput = t;
        t.setPlaceholder("e.g. Private/");
        const dl = containerEl.createEl("datalist", { attr: { id: "oc-folder-list" } });
        for (const folder of this.listFolders()) dl.createEl("option", { value: folder });
        t.inputEl.setAttribute("list", "oc-folder-list");
        t.inputEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            this.addBlacklist(t.getValue());
          }
        });
      })
      .addButton((b) => b.setIcon("plus").setTooltip("Add folder").onClick(() => this.addBlacklist(this.blacklistInput?.getValue() ?? "")));
    const bl = containerEl.createDiv({ cls: "oc-blacklist" });
    for (const folder of this.plugin.settings.blacklistFolders) {
      const chip = bl.createDiv({ cls: "oc-attach oc-attach-file" });
      chip.createSpan({ cls: "oc-attach-name", text: folder });
      const x = chip.createEl("button", { cls: "oc-attach-x", attr: { "aria-label": "Remove", type: "button" } });
      setIcon(x, "x");
      x.addEventListener("click", () => {
        this.plugin.settings.blacklistFolders = this.plugin.settings.blacklistFolders.filter((f) => f !== folder);
        this.save();
        this.display();
      });
    }

    containerEl.createEl("p", { text: "Changes save automatically, but some take effect on the next chat turn.", cls: "setting-item-description" });
  }

  private save() {
    this.plugin.saveSettings();
  }

  private listFolders(): string[] {
    const set = new Set<string>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      const dirs = f.path.split("/").slice(0, -1);
      for (let i = 1; i <= dirs.length; i++) set.add(dirs.slice(0, i).join("/") + "/");
    }
    return [...set].sort();
  }

  private addBlacklist(folder: string) {
    const f = folder.trim().replace(/^\/+|\/+$/g, "");
    if (!f) return;
    if (!this.plugin.settings.blacklistFolders.includes(f + "/")) this.plugin.settings.blacklistFolders.push(f + "/");
    if (this.blacklistInput) this.blacklistInput.setValue("");
    this.save();
    this.display();
  }
}

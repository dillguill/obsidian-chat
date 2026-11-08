/** Settings tab. Only shell/device/vault preferences live here: the harness
 *  command is configuration; model/provider choice belongs to the harness
 *  (Constitution Principle II). There is deliberately no note-folder,
 *  session-folder, gateway, or fixed model/thinking control here.
 */
import { App, Platform, PluginSettingTab, Setting, setIcon, TextComponent } from "obsidian";
import type ObsidianChatPlugin from "./main";
import { mintToken } from "./shell/device-auth.ts";
import {
  DEFAULT_SETTINGS,
  type ObsidianChatSettings,
} from "./settings-model.ts";

export { DEFAULT_SETTINGS };
export type { ObsidianChatSettings };

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

    containerEl.createEl("h4", { text: "Shell" });
    containerEl.createEl("p", {
      text: "One harness per install. Local mode spawns the harness and serves paired devices; remote mode attaches to a host over the VPN. Modes and config options come from the harness itself.",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Mode")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "Local (this device hosts)")
          .addOption("remote", "Remote (attach to a host)")
          .setValue(this.plugin.settings.shell.mode)
          .onChange(async (value) => {
            this.plugin.settings.shell.mode = value === "remote" ? "remote" : "local";
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    new Setting(containerEl)
      .setName("Harness command")
      .setDesc("Any ACP-speaking harness, e.g. `opencode acp`. Applied on the next shell session.")
      .addText((text) => {
        text.setPlaceholder("opencode acp").setValue(this.plugin.settings.shell.command);
        text.inputEl.addEventListener("change", async () => {
          this.plugin.settings.shell.command = text.getValue().trim();
          await this.plugin.saveSettings();
        });
      });
    if (this.plugin.settings.shell.mode === "local") {
      new Setting(containerEl)
        .setName("Listen port")
        .setDesc("Paired devices connect to this port on the host.")
        .addText((text) => {
          text.setValue(String(this.plugin.settings.shell.port ?? 8765));
          text.inputEl.addEventListener("change", async () => {
            const port = Number(text.getValue());
            if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
            this.plugin.settings.shell.port = port;
            await this.plugin.saveSettings();
          });
        });
      new Setting(containerEl)
        .setName("Bind address")
        .setDesc("Loopback by default. Only expose a VPN/private address deliberately.")
        .addText((text) => {
          text.setValue(this.plugin.settings.shell.bindAddress ?? "127.0.0.1");
          text.inputEl.addEventListener("change", async () => {
            this.plugin.settings.shell.bindAddress = text.getValue().trim() || "127.0.0.1";
            await this.plugin.saveSettings();
          });
        });
      new Setting(containerEl)
        .setName("Allow wider bind")
        .setDesc("Required before binding beyond loopback. Only do this on a trusted VPN/private network.")
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.allowWiderBind).onChange(async (value) => {
            this.plugin.settings.allowWiderBind = value;
            await this.plugin.saveSettings();
          }),
        );
      new Setting(containerEl)
        .setName("Restart harness")
        .setDesc("Reload the harness so it picks up new credentials.")
        .addButton((button) => button.setButtonText("Restart").onClick(() => void this.plugin.restartHarness()));
    } else {
      new Setting(containerEl)
        .setName("Host endpoint")
        .setDesc("ws:// or wss:// host address (the host's listen port, e.g. ws://100.x.y.z:8765/acp).")
        .addText((text) => {
          text.setPlaceholder("ws://100.x.y.z:8765/acp").setValue(this.plugin.settings.shell.remoteUrl ?? "");
          text.inputEl.addEventListener("change", async () => {
            this.plugin.settings.shell.remoteUrl = text.getValue().trim();
            await this.plugin.saveSettings();
          });
        });
      new Setting(containerEl)
        .setName("Device code")
        .setDesc("Created on the host under Paired devices.")
        .addText((text) => {
          text.inputEl.type = "password";
          text.setValue(this.plugin.settings.shell.remoteToken ?? "");
          text.inputEl.addEventListener("change", async () => {
            this.plugin.settings.shell.remoteToken = text.getValue().trim();
            await this.plugin.saveSettings();
          });
        });
    }
    new Setting(containerEl)
      .setName("Open the shell")
      .addButton((button) => button.setButtonText("Open shell").onClick(() => void this.plugin.activateShellView()));

    if (Platform.isDesktopApp && this.plugin.settings.shell.mode === "local") {
      containerEl.createEl("h4", { text: "Paired devices" });
      this.renderDevices(containerEl);
    }

    containerEl.createEl("h4", { text: "Vault access" });
    new Setting(containerEl)
      .setName("Inject vault rules")
      .setDesc("Read vault-rules.md / AGENTS.md into the turn as advisory context.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.injectVaultRules).onChange((value) => {
          this.plugin.settings.injectVaultRules = value;
          this.save();
        }),
      );
    new Setting(containerEl)
      .setName("Blacklist folders")
      .setDesc("Folders the agent can't read, search, or edit. Type to autocomplete, press Enter or + to add.")
      .addText((text) => {
        this.blacklistInput = text;
        text.setPlaceholder("e.g. Private/");
        const list = containerEl.createEl("datalist", { attr: { id: "oc-folder-list" } });
        for (const folder of this.listFolders()) list.createEl("option", { value: folder });
        text.inputEl.setAttribute("list", "oc-folder-list");
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.addBlacklist(text.getValue());
          }
        });
      })
      .addButton((button) =>
        button.setIcon("plus").setTooltip("Add folder").onClick(() => this.addBlacklist(this.blacklistInput?.getValue() ?? "")),
      );
    const chips = containerEl.createDiv({ cls: "oc-blacklist" });
    for (const folder of this.plugin.settings.blacklistFolders) {
      const chip = chips.createDiv({ cls: "oc-attach oc-attach-file" });
      chip.createSpan({ cls: "oc-attach-name", text: folder });
      const remove = chip.createEl("button", { cls: "oc-attach-x", attr: { "aria-label": "Remove", type: "button" } });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.plugin.settings.blacklistFolders = this.plugin.settings.blacklistFolders.filter((entry) => entry !== folder);
        this.save();
        this.display();
      });
    }

    containerEl.createEl("h4", { text: "Transcript" });
    new Setting(containerEl)
      .setName("Activity density")
      .setDesc("Chat keeps the conversation readable and collapses each turn's agent activity; Expanded shows every ACP update in arrival order.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("grouped", "Chat (activity collapsed)")
          .addOption("chronological", "Expanded protocol stream")
          .setValue(this.plugin.settings.activityDensity)
          .onChange(async (value) => {
            this.plugin.settings.activityDensity = value === "grouped" ? "grouped" : "chronological";
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("p", {
      text: "Conversations are stored in the vault's hidden .chat/sessions folder as JSONL. Old Markdown conversations are found and imported automatically — there is no folder setting.",
      cls: "setting-item-description",
    });
  }

  private renderDevices(containerEl: HTMLElement): void {
    let name = "";
    new Setting(containerEl)
      .setName("Add a device")
      .setDesc("The code is shown on the host; enter it on the device's own settings.")
      .addText((text) => text.setPlaceholder("e.g. phone").onChange((value) => (name = value.trim())))
      .addButton((button) =>
        button.setButtonText("Add").onClick(async () => {
          if (!name || this.plugin.settings.pairedDevices[name]) return;
          this.plugin.settings.pairedDevices[name] = mintToken();
          await this.plugin.saveSettings();
          this.display();
        }),
      );
    for (const [device, code] of Object.entries(this.plugin.settings.pairedDevices)) {
      new Setting(containerEl)
        .setName(device)
        .setDesc(code)
        .addExtraButton((button) =>
          button.setIcon("copy").setTooltip("Copy code").onClick(() => void navigator.clipboard.writeText(code)),
        )
        .addExtraButton((button) =>
          button.setIcon("trash-2").setTooltip("Revoke").onClick(async () => {
            delete this.plugin.settings.pairedDevices[device];
            await this.plugin.saveSettings();
            this.display();
          }),
        );
    }
  }

  private save(): void {
    void this.plugin.saveSettings();
  }

  private listFolders(): string[] {
    const set = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const dirs = file.path.split("/").slice(0, -1);
      for (let index = 1; index <= dirs.length; index += 1) set.add(dirs.slice(0, index).join("/") + "/");
    }
    return [...set].sort();
  }

  private addBlacklist(folder: string): void {
    const normalized = folder.trim().replace(/^\/+|\/+$/g, "");
    if (!normalized) return;
    if (!this.plugin.settings.blacklistFolders.includes(normalized + "/")) {
      this.plugin.settings.blacklistFolders.push(normalized + "/");
    }
    if (this.blacklistInput) this.blacklistInput.setValue("");
    this.save();
    this.display();
  }
}

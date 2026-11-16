/** Settings tab. Only shell/device/vault preferences live here: the harness
 *  command is configuration; model/provider choice belongs to the harness
 *  (Constitution Principle II). There is deliberately no note-folder,
 *  session-folder, gateway, or fixed model/thinking control here.
 */
import { silentWav, transcribe } from "./ui/voice.ts";
import { parseVoiceProvider } from "./voice/stt.ts";
import { App, Platform, PluginSettingTab, Setting, setIcon, TextComponent } from "obsidian";
import type ObsidianChatPlugin from "./main";
import {
  DEFAULT_PORT,
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

    containerEl.createEl("h4", { text: "This device" });
    containerEl.createEl("p", {
      text: "Role, address, port and name are kept on this device only; they are not synced with the vault.",
      cls: "setting-item-description",
    });
    // Only a desktop install can host (it spawns the harness and listens).
    new Setting(containerEl)
      .setName("Role")
      .addDropdown((dropdown) => {
        if (Platform.isDesktopApp) dropdown.addOption("local", "Host (runs the harness, serves other devices)");
        return dropdown
          .addOption("remote", "Remote (attaches to the host)")
          .setValue(Platform.isDesktopApp ? this.plugin.settings.shell.mode : "remote")
          .onChange(async (value) => {
            this.plugin.settings.shell.mode = value === "remote" ? "remote" : "local";
            await this.plugin.saveSettings();
            await this.plugin.restartHost();
            this.display();
          });
      });
    new Setting(containerEl)
      .setName("Device name")
      .setDesc("Shown in History and used to send approvals to the right device.")
      .addText((text) => {
        text.setValue(this.plugin.settings.shell.deviceName ?? "");
        text.inputEl.addEventListener("change", async () => {
          const name = text.getValue().trim();
          if (!name) return;
          this.plugin.settings.shell.deviceName = name;
          await this.plugin.saveSettings();
        });
      });
    if (Platform.isDesktopApp && this.plugin.settings.shell.mode === "local") {
      const port = this.plugin.settings.shell.port ?? DEFAULT_PORT;
      new Setting(containerEl)
        .setName("Listener port")
        .setDesc(
          `Loopback only. Publish it on your tailnet once with: tailscale serve --bg --https=9443 ${port}. Other devices then use https://<this-machine>.<tailnet>.ts.net:9443.`,
        )
        .addText((text) => {
          text.setValue(String(port));
          text.inputEl.addEventListener("change", async () => {
            const value = Number(text.getValue());
            if (!Number.isInteger(value) || value < 1024 || value > 65535) return;
            this.plugin.settings.shell.port = value;
            await this.plugin.saveSettings();
            await this.plugin.restartHost();
            this.display();
          });
        });
    } else {
      new Setting(containerEl)
        .setName("Host address")
        .setDesc("The host's tailnet name, as published by Tailscale Serve.")
        .addText((text) => {
          text.setPlaceholder("https://<host>.<tailnet>.ts.net:9443").setValue(this.plugin.settings.shell.remoteUrl ?? "");
          text.inputEl.addEventListener("change", async () => {
            this.plugin.settings.shell.remoteUrl = text.getValue().trim();
            await this.plugin.saveSettings();
          });
        });
    }

    containerEl.createEl("h4", { text: "Harness" });
    containerEl.createEl("p", {
      text: "Shared by all devices; only the host runs it. Modes and config options come from the harness itself.",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Harness command")
      .setDesc("Any ACP-speaking harness, e.g. `opencode acp`. Applied on the next harness start.")
      .addText((text) => {
        text.setPlaceholder("opencode acp").setValue(this.plugin.settings.shell.command);
        text.inputEl.addEventListener("change", async () => {
          this.plugin.settings.shell.command = text.getValue().trim();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Allowed Tailscale accounts")
      .setDesc("Logins that may attach through Tailscale Serve, comma-separated. Empty: any user on your tailnet.")
      .addText((text) => {
        text.setPlaceholder("you@example.com").setValue(this.plugin.settings.allowedTailscaleUsers.join(", "));
        text.inputEl.addEventListener("change", async () => {
          this.plugin.settings.allowedTailscaleUsers = text
            .getValue()
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
        });
      });
    if (Platform.isDesktopApp && this.plugin.settings.shell.mode === "local") {
      new Setting(containerEl)
        .setName("Restart harness")
        .setDesc("Reload the harness so it picks up new credentials.")
        .addButton((button) => button.setButtonText("Restart").onClick(() => void this.plugin.restartHarness()));
    }
    new Setting(containerEl)
      .setName("Open the shell")
      .addButton((button) => button.setButtonText("Open shell").onClick(() => void this.plugin.activateShellView()));

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
      .setName("Skills folder")
      .setDesc("Vault folder with skills: <name>/SKILL.md folders or single notes, with optional name/description frontmatter. The agent gets a short list once per conversation; type / in the composer to attach one. Leave empty to turn skills off.")
      .addText((text) => {
        text.setPlaceholder("e.g. Skills").setValue(this.plugin.settings.skillsFolder);
        const list = containerEl.createEl("datalist", { attr: { id: "oc-skills-folder-list" } });
        for (const folder of this.listFolders()) list.createEl("option", { value: folder.replace(/\/$/, "") });
        text.inputEl.setAttribute("list", "oc-skills-folder-list");
        text.onChange((value) => {
          this.plugin.settings.skillsFolder = value.trim().replace(/^\/+|\/+$/g, "");
          this.save();
        });
      });
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

    containerEl.createEl("h4", { text: "Voice input" });
    new Setting(containerEl)
      .setName("Voice input")
      .setDesc("Show the microphone on this device (not synced). It sends recordings to the speech-to-text server below. The keyboard's own dictation key always works too.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("whisper", "Whisper server")
          .addOption("off", "Off")
          .setValue(this.plugin.voiceProvider())
          .onChange((value) => {
            this.plugin.setVoiceProvider(parseVoiceProvider(value));
            this.plugin.refreshViews();
          }),
      );
    const stt = new Setting(containerEl)
      .setName("Speech-to-text server")
      .setDesc("Your whisper.cpp server (or any /v1/audio/transcriptions endpoint), e.g. https://stt.example. Adds a microphone button next to send. Audio goes only to this server and is never stored.")
      .addText((text) =>
        text
          .setPlaceholder("https://stt.example")
          .setValue(this.plugin.settings.sttUrl)
          .onChange((value) => {
            this.plugin.settings.sttUrl = value.trim();
            this.save();
            this.plugin.refreshViews();
          }),
      )
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          button.setDisabled(true).setButtonText("Testing…");
          try {
            await transcribe(this.plugin.settings.sttUrl, silentWav());
            stt.setDesc("Connected: the server accepted a test clip.");
          } catch (err) {
            stt.setDesc(`Not reachable: ${String((err as Error).message ?? err)}`);
          } finally {
            button.setDisabled(false).setButtonText("Test");
          }
        }),
      );

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

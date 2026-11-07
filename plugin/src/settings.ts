/** Settings model + settings tab. The plugin is an ACP client only — model,
 *  provider, and tool-execution config all live on the harness (Constitution
 *  Principle II); this file only holds plugin-local UX/connection state. */
import { App, Platform, PluginSettingTab, Setting, setIcon, TextComponent } from "obsidian";
import type ObsidianChatPlugin from "./main";
import { randomToken } from "./host/server";

/** ACP bridge connection (specs/001-acp-mcp-migration). No `model` field —
 *  the model/provider is a config value on the harness itself (Principle
 *  II), never chosen by the plugin. */
export interface GatewayConfig {
  baseUrl: string;
  token: string;
}

/** How this install reaches a harness (specs/004-acp-shell).
 *  `local` = the host spawns the configured harness; `remote` = attach over the
 *  VPN to a host instance. The legacy `gateway`/`host` blocks remain until the
 *  US9 deletion phase; new code reads only `shell`. */
export interface ShellSettings {
  mode: "local" | "remote";
  /** Local mode: any ACP-speaking harness, e.g. `opencode acp`. */
  command: string;
  /** Local mode: optional working directory override (defaults to the vault root). */
  cwd?: string;
  /** Remote mode: ws:// or wss:// host endpoint. */
  remoteUrl?: string;
  /** Remote mode: per-device transport token (never shown or logged). */
  remoteToken?: string;
}

export interface ObsidianChatSettings {
  gateway: GatewayConfig;
  /** Where chat sessions are stored (vault-relative folder, e.g. "chat/"). */
  chatFolder: string;
  /** Folders the agent must not read/search/edit (vault-relative, e.g. "Private/").
   *  Defaults mirror this vault's own AGENTS.md mandate (Journals/, _attachments/,
   *  .trash/). The host's vault MCP server (`host/vault-mcp.ts`) enforces this
   *  same list for agent tool calls, so agent and mention index agree. */
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
  /** Last value picked for each harness-declared config option id (mode,
   *  thought_level, ...), reapplied to every new session right after
   *  connect() so it opens on the same choice instead of the harness's own
   *  raw default. The plugin still owns none of the values or their meaning
   *  (FR-008) — this is opaque id->value replay.
   *
   *  `model` is deliberately NOT stored here: a model is the one option with
   *  a fallback chain (see `defaultModel`), and silently replaying the last
   *  pick is what left every new session on a model the account could no
   *  longer use. `migrateDefaultModel()` moves any legacy entry out. */
  acpConfigOverrides: Record<string, string | boolean>;
  /** Models pinned for quick access in the chat's model picker — opaque
   *  harness option values, in display order. Pinning is presentation only:
   *  it never changes what a new session opens on (that's `defaultModel`). */
  pinnedModels: string[];
  /** The model a new session should open on, or `null` to send nothing and
   *  let the harness use whatever it is configured with. A value the harness
   *  no longer lists is reported and ignored rather than replayed. */
  defaultModel: string | null;
  /** New shell attach configuration (specs/004-acp-shell). */
  shell: ShellSettings;
  /** Vault-relative folder holding the host-owned JSONL session records. */
  sessionStoreFolder: string;
  /** Transcript density for agent work: chronological (default) or grouped. */
  activityDensity: "chronological" | "grouped";
  /** Host mode (desktop only). Legacy until the US9 deletion phase. When `enabled`, this Obsidian instance runs
   *  the configured ACP harness as a child process, serves chat clients over
   *  HTTP/SSE, and serves the vault's MCP tools to the harness — see
   *  `host/server.ts`. Off by default: only the always-on machine turns it
   *  on; every other install connects to that machine's address. */
  host: {
    enabled: boolean;
    /** Any ACP-speaking harness, e.g. `opencode acp`. */
    command: string;
    port: number;
    /** Paired devices: name → bearer token. */
    devices: Record<string, string>;
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
  pinnedModels: [],
  defaultModel: null,
  shell: { mode: "local", command: "opencode acp" },
  sessionStoreFolder: ".chat/sessions",
  activityDensity: "chronological",
  host: { enabled: false, command: "opencode acp", port: 8765, devices: {} },
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

    // Models — a viewer for the two opaque values the chat toolbar writes.
    // The default is what a new session opens on; pins only reorder the
    // picker. Duplicated here because this is the only place a bad default
    // can be cleared while the harness is unreachable.
    containerEl.createEl("h4", { text: "Models" });
    const defaultModel = this.plugin.settings.defaultModel;
    new Setting(containerEl)
      .setName("Default model")
      .setDesc(
        defaultModel ??
          "Following the harness's own default. In the chat toolbar, pick a model and click its target icon to make it the default.",
      )
      .addExtraButton((b) =>
        b
          .setIcon("rotate-ccw")
          .setTooltip("Use the harness default")
          .setDisabled(!defaultModel)
          .onClick(async () => {
            this.plugin.settings.defaultModel = null;
            await this.plugin.saveSettings();
            this.plugin.refreshChatToolbars();
            this.display();
          }),
      );
    new Setting(containerEl)
      .setName("Pinned models")
      .setDesc(
        this.plugin.settings.pinnedModels.length
          ? "Shown at the top of the chat's model picker."
          : "None yet — click the pin icon next to a model in the chat's picker.",
      );
    if (this.plugin.settings.pinnedModels.length) {
      const pins = containerEl.createDiv({ cls: "oc-blacklist" });
      for (const model of this.plugin.settings.pinnedModels) {
        const chip = pins.createDiv({ cls: "oc-attach oc-attach-file" });
        chip.createSpan({ cls: "oc-attach-name", text: model });
        const x = chip.createEl("button", { cls: "oc-attach-x", attr: { "aria-label": "Unpin", type: "button" } });
        setIcon(x, "x");
        x.addEventListener("click", async () => {
          this.plugin.settings.pinnedModels = this.plugin.settings.pinnedModels.filter((m) => m !== model);
          await this.plugin.saveSettings();
          this.plugin.refreshChatToolbars();
          this.display();
        });
      }
    }

    containerEl.createEl("h4", { text: "ACP Shell" });
    containerEl.createEl("p", {
      text: "The new shell attaches to a configured ACP harness. Local mode spawns it from this Obsidian install; remote attach arrives with the host relay (US3).",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("Shell mode")
      .addDropdown((d) =>
        d
          .addOption("local", "Local (spawn harness)")
          .addOption("remote", "Remote (not implemented yet)")
          .setValue(this.plugin.settings.shell.mode)
          .onChange(async (v) => {
            this.plugin.settings.shell.mode = v === "remote" ? "remote" : "local";
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    new Setting(containerEl)
      .setName("Harness command")
      .setDesc("Any ACP-speaking harness, e.g. `opencode acp`. Applied on the next shell session.")
      .addText((t) => {
        t.setPlaceholder("opencode acp").setValue(this.plugin.settings.shell.command);
        t.inputEl.addEventListener("change", async () => {
          this.plugin.settings.shell.command = t.getValue().trim();
          await this.plugin.saveSettings();
        });
      });
    if (this.plugin.settings.shell.mode === "remote") {
      new Setting(containerEl)
        .setName("Remote endpoint")
        .setDesc("ws:// or wss:// host endpoint (remote attach is implemented in US3).")
        .addText((t) => {
          t.setPlaceholder("ws://100.x.y.z:8765/acp").setValue(this.plugin.settings.shell.remoteUrl ?? "");
          t.inputEl.addEventListener("change", async () => {
            this.plugin.settings.shell.remoteUrl = t.getValue().trim();
            await this.plugin.saveSettings();
          });
        });
    }
    new Setting(containerEl)
      .setName("Activity density")
      .setDesc("Chronological is the faithful default; grouped collapses runs of agent work.")
      .addDropdown((d) =>
        d
          .addOption("chronological", "Chronological")
          .addOption("grouped", "Grouped")
          .setValue(this.plugin.settings.activityDensity)
          .onChange(async (v) => {
            this.plugin.settings.activityDensity = v === "grouped" ? "grouped" : "chronological";
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Open the ACP shell")
      .setDesc("Opens the new shell view (US1: local attach, send/cancel, persisted record).")
      .addButton((b) => b.setButtonText("Open shell").onClick(() => void this.plugin.activateShellView()));

    if (Platform.isDesktopApp) {
      containerEl.createEl("h4", { text: "Host" });
      containerEl.createEl("p", {
        text: "Turn this on for the one always-on computer. Obsidian then runs your agent harness and serves the vault to it — nothing else to install or keep running. Other devices connect to this computer.",
        cls: "setting-item-description",
      });
      new Setting(containerEl)
        .setName("Host on this device")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.host.enabled).onChange(async (v) => {
            this.plugin.settings.host.enabled = v;
            await this.plugin.saveSettings();
            await this.plugin.restartHost();
            this.display();
          }),
        );
      if (this.plugin.settings.host.enabled) {
        new Setting(containerEl)
          .setName("Harness command")
          .setDesc("Any harness that speaks the Agent Client Protocol, e.g. `opencode acp`, `gemini --experimental-acp`, `goose acp`. Applied when you leave the field.")
          .addText((t) => {
            t.setPlaceholder("opencode acp").setValue(this.plugin.settings.host.command);
            t.inputEl.addEventListener("change", async () => {
              this.plugin.settings.host.command = t.getValue().trim();
              await this.plugin.saveSettings();
              await this.plugin.restartHost();
            });
          });
        new Setting(containerEl)
          .setName("Port")
          .setDesc("Other devices connect to http://<this computer>:<port>.")
          .addText((t) => {
            t.setValue(String(this.plugin.settings.host.port));
            t.inputEl.addEventListener("change", async () => {
              const port = Number(t.getValue());
              if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
              this.plugin.settings.host.port = port;
              await this.plugin.saveSettings();
              await this.plugin.restartHost();
            });
          });
        new Setting(containerEl)
          .setName("Restart harness")
          .setDesc("Reloads the agent harness so it picks up new credentials or provider config — no need to quit Obsidian.")
          .addButton((b) => b.setButtonText("Restart").onClick(() => void this.plugin.restartHarness()));
        this.renderDevices(containerEl);
      }
    }

    if (!this.plugin.settings.host.enabled || !Platform.isDesktopApp) {
      containerEl.createEl("h4", { text: "Connect to host" });
      new Setting(containerEl)
        .setName("Host address")
        .setDesc("The host computer's address and port, e.g. http://100.x.y.z:8765 over Tailscale or your local network.")
        .addText((t) =>
          t.setValue(this.plugin.settings.gateway.baseUrl).onChange((v) => {
            this.plugin.settings.gateway.baseUrl = v.trim();
            this.save();
          }),
        );
      new Setting(containerEl)
        .setName("Device code")
        .setDesc("Created on the host under Host → Paired devices.")
        .addText((t) => {
          t.inputEl.type = "password";
          return t.setValue(this.plugin.settings.gateway.token).onChange((v) => {
            this.plugin.settings.gateway.token = v.trim();
            this.save();
          });
        });
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

  /** Pairing: each device gets its own code, so one can be revoked alone. */
  private renderDevices(containerEl: HTMLElement): void {
    let name = "";
    new Setting(containerEl)
      .setName("Paired devices")
      .setDesc("Add a device, then enter its code in that device's Obsidian Chat settings.")
      .addText((t) => t.setPlaceholder("e.g. phone").onChange((v) => (name = v.trim())))
      .addButton((b) =>
        b.setButtonText("Add").onClick(async () => {
          if (!name || this.plugin.settings.host.devices[name]) return;
          this.plugin.settings.host.devices[name] = randomToken();
          await this.plugin.saveSettings();
          this.display();
        }),
      );
    for (const [device, code] of Object.entries(this.plugin.settings.host.devices)) {
      new Setting(containerEl)
        .setName(device)
        .setDesc(code)
        .addExtraButton((b) =>
          b.setIcon("copy").setTooltip("Copy code").onClick(() => void navigator.clipboard.writeText(code)),
        )
        .addExtraButton((b) =>
          b.setIcon("trash-2").setTooltip("Revoke").onClick(async () => {
            delete this.plugin.settings.host.devices[device];
            await this.plugin.saveSettings();
            this.display();
          }),
        );
    }
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

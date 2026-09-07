/** Settings model + settings tab (BYOK providers, Tavily, gateway, models). */
import { App, PluginSettingTab, Setting, Notice, setIcon, TextComponent } from "obsidian";
import type ObsidianChatPlugin from "./main";
import { ToolsModal } from "./ui/tools-modal";
import { fetchProviderModels } from "./chat/models";

export type ProviderType =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "groq"
  | "ollama"
  | "mistral"
  | "xai"
  | "opencode"
  | "custom";

export type RuntimeKind = "openai-compat" | "anthropic";

export interface ProviderPreset {
  id: ProviderType;
  label: string;
  kind: RuntimeKind;
  /** Base URL that auto-fills when this preset is chosen. Empty → show placeholder. */
  baseUrl: string;
  /** Suggested default model ("default model for chat"). */
  model?: string;
  /** Placeholder shown in the Base URL field when the value is empty. */
  basePlaceholder?: string;
}

/** Known provider presets. Selecting one auto-fills its base URL; `custom` is empty. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "openrouter", label: "OpenRouter", kind: "openai-compat", baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat" },
  { id: "openai", label: "OpenAI", kind: "openai-compat", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
  { id: "groq", label: "Groq", kind: "openai-compat", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "ollama", label: "Ollama (local)", kind: "openai-compat", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3.5:4b-mlx" },
  { id: "mistral", label: "Mistral", kind: "openai-compat", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  { id: "xai", label: "xAI (Grok)", kind: "openai-compat", baseUrl: "https://api.x.ai/v1", model: "grok-3-mini" },
  { id: "opencode", label: "OpenCode", kind: "openai-compat", baseUrl: "", model: "", basePlaceholder: "http://127.0.0.1:<port>/v1" },
  { id: "custom", label: "Custom", kind: "openai-compat", baseUrl: "", model: "", basePlaceholder: "https://your-endpoint/v1" },
];

export function presetFor(type: ProviderType): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === type);
}

export function runtimeKind(type: ProviderType): RuntimeKind {
  return presetFor(type)?.kind ?? "openai-compat";
}

export function isAnthropicType(type: ProviderType): boolean {
  return runtimeKind(type) === "anthropic";
}

/** Map a legacy/unknown type string to a current preset id. */
export function normalizeProviderType(t: string): ProviderType {
  if (t === "openai-compat") return "custom"; // legacy generic OpenAI-compatible
  return (PROVIDER_PRESETS.some((p) => p.id === t) ? t : "custom") as ProviderType;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Reasoning levels this model actually supports. Undefined = all (off/low/high). */
  thinkingLevels?: ThinkingLevel[];
  /** Whether this model accepts image input (vision). Undefined = enabled (default on).
   *  The composer only shows the image-attach button when the active model has vision. */
  vision?: boolean;
}

/** ACP bridge connection (specs/001-acp-mcp-migration). No `model` field —
 *  the model/provider is a config value on the harness itself (Principle
 *  II), never chosen by the plugin. */
export interface GatewayConfig {
  baseUrl: string;
  token: string;
}

export type ApprovalMode = "auto" | "review" | "plan";
export type GroundingMode = "tools" | "auto";
export type ChatMode = "research" | ApprovalMode;
export type ThinkingLevel = "off" | "low" | "high";

export interface ObsidianChatSettings {
  providers: ProviderConfig[];
  activeProviderId: string;
  gateway: GatewayConfig;
  /** Prefer the gateway (harness) for chat. Auto-true on mobile. */
  preferGateway: boolean;
  retrievalK: number;
  injectVaultRules: boolean;
  /** Where chat sessions are stored (vault-relative folder, e.g. "chat/"). */
  chatFolder: string;
  /** Quick-access models pinned from any provider: { providerId, model }. */
  pinnedModels: { providerId: string; model: string }[];
  /** Folders the agent must not read/search/edit (vault-relative, e.g. "Private/"). */
  blacklistFolders: string[];
  /** How vault context enters a turn:
   *  tools = none pre-loaded; the model pulls notes with search_vault/read_file
   *         (notes only enter via @mention, a tool call, or agent/auto mode).
   *  auto  = always retrieve top-k notes into the system prompt (old behavior). */
  groundingMode: GroundingMode;
  /** How write tools are gated:
   *  auto  = apply immediately (with a diff logged)
   *  review = always ask, diff shown (default)
   *  plan  = never apply, only preview ("plan mode") */
  approvalMode: ApprovalMode;
  /** Composer mode: "research" (default, tool-using research assistant) or a
   *  write-approval mode (auto/review/plan) that also sets approvalMode. */
  mode: ChatMode;
  /** loop cap: max tool rounds per turn before forced stop */
  maxToolRounds: number;
  /** per-turn token budget (approx) — loop stops if exceeded */
  tokenBudget: number;
  /** persistent per-tool decisions: toolName -> allowed (true) or denied/intent (true) */
  toolAllowlist: Record<string, boolean>;
  /** Which tools the model may call. Empty array = all tools enabled (default). */
  enabledTools: string[];
  /** Web search (Tavily) — key stays in settings; harness-side default later. */
  tavily: { apiKey: string; enabled: boolean };
  /** Reasoning effort surface (off / low / high). Stored; provider wiring is model-specific. */
  thinkingLevel: ThinkingLevel;
}

export const DEFAULT_SETTINGS: ObsidianChatSettings = {
  providers: [
    {
      id: "default",
      name: "OpenRouter",
      type: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "",
      model: "deepseek/deepseek-chat",
    },
  ],
  activeProviderId: "default",
  gateway: { baseUrl: "http://127.0.0.1:8765", token: "" },
  preferGateway: false,
  retrievalK: 5,
  injectVaultRules: true,
  chatFolder: "chat/",
  pinnedModels: [],
  blacklistFolders: [],
  groundingMode: "tools",
  approvalMode: "review",
  mode: "research",
  maxToolRounds: 4,
  tokenBudget: 12_000,
  toolAllowlist: {},
  enabledTools: [],
  tavily: { apiKey: "", enabled: false },
  thinkingLevel: "low",
};

export function getActiveProvider(s: ObsidianChatSettings): ProviderConfig {
  return s.providers.find((p) => p.id === s.activeProviderId) ?? s.providers[0];
}

export const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "low", "high"];

/** A provider with no `thinkingLevels` set supports all of them (BYOK models vary too much to assume otherwise). */
export function thinkingLevelsFor(p: ProviderConfig): ThinkingLevel[] {
  return p.thinkingLevels ?? ALL_THINKING_LEVELS;
}

export function hasThinkingLevel(p: ProviderConfig, level: ThinkingLevel): boolean {
  return thinkingLevelsFor(p).includes(level);
}

/** Whether a provider supports image input. Undefined = enabled (see ProviderConfig.vision). */
export function hasVision(p: ProviderConfig): boolean {
  return p.vision !== false;
}

export function setThinkingLevel(p: ProviderConfig, level: ThinkingLevel, enabled: boolean) {
  const cur = new Set(thinkingLevelsFor(p));
  if (enabled) cur.add(level);
  else cur.delete(level);
  p.thinkingLevels = cur.size === ALL_THINKING_LEVELS.length ? undefined : ALL_THINKING_LEVELS.filter((l) => cur.has(l));
}

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

    containerEl.createEl("h4", { text: "Providers" });
    for (const [i, p] of this.plugin.settings.providers.entries()) {
      this.renderProvider(containerEl, p, i);
    }
    // Plus icon below to add another provider.
    const addRow = containerEl.createDiv({ cls: "oc-add-provider" });
    const addBtn = addRow.createEl("button", { cls: "oc-add-provider-btn" });
    setIcon(addBtn, "plus");
    addBtn.createSpan({ text: " Add provider" });
    addBtn.addEventListener("click", () => {
      this.plugin.settings.providers.push({
        id: crypto.randomUUID(),
        name: "New provider",
        type: "custom",
        baseUrl: "",
        apiKey: "",
        model: "",
      });
      this.save();
      this.display();
    });

    containerEl.createEl("h4", { text: "ACP bridge" });
    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Your always-on machine's ACP bridge over Tailscale, e.g. https://100.x.y.z:8765")
      .addText((t) => t.setValue(this.plugin.settings.gateway.baseUrl).onChange((v) => (this.plugin.settings.gateway.baseUrl = v)));
    new Setting(containerEl)
      .setName("Device token")
      .setDesc("Per-device bearer token from the harness tokens.json.")
      .addText((t) => {
        t.inputEl.type = "password";
        return t.setValue(this.plugin.settings.gateway.token).onChange((v) => (this.plugin.settings.gateway.token = v));
      });
    new Setting(containerEl)
      .setName("Prefer bridge")
      .setDesc(
        "Use the ACP bridge (harness) when available. Auto-enabled on mobile. The model/provider is configured on the harness itself, not here (Constitution Principle II)."
      )
      .addToggle((t) => t.setValue(this.plugin.settings.preferGateway).onChange((v) => (this.plugin.settings.preferGateway = v)));

    containerEl.createEl("h4", { text: "Grounding" });
    new Setting(containerEl)
      .setName("Vault context")
      .setDesc("How notes get into a turn. 'Tools' = none pre-loaded; the model pulls notes with search_vault/read_file (or @mention). 'Auto' = always retrieve top-k notes.")
      .addDropdown((d) =>
        d
          .addOption("tools", "Tools (model pulls notes)")
          .addOption("auto", "Auto (always retrieve notes)")
          .setValue(this.plugin.settings.groundingMode)
          .onChange((v) => {
            this.plugin.settings.groundingMode = v as GroundingMode;
            this.save();
          })
      );
    new Setting(containerEl)
      .setName("Context notes")
      .setDesc("How many retrieved notes are injected into each answer (Auto mode only).")
      .addSlider((s) => s.setLimits(1, 10, 1).setValue(this.plugin.settings.retrievalK).onChange((v) => (this.plugin.settings.retrievalK = v)));
    new Setting(containerEl)
      .setName("Inject vault rules")
      .setDesc("Read vault-rules.md / AGENTS.md into the system prompt.")
      .addToggle((t) => t.setValue(this.plugin.settings.injectVaultRules).onChange((v) => (this.plugin.settings.injectVaultRules = v)));

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

    containerEl.createEl("h4", { text: "Web search (Tavily)" });
    new Setting(containerEl)
      .setName("Enable web search")
      .setDesc("Gives the agent a web_search tool. Results are cited.")
      .addToggle((t) => t.setValue(this.plugin.settings.tavily.enabled).onChange((v) => (this.plugin.settings.tavily.enabled = v)));
    new Setting(containerEl)
      .setName("Tavily API key")
      .addText((t) => {
        t.inputEl.type = "password";
        return t.setValue(this.plugin.settings.tavily.apiKey).onChange((v) => (this.plugin.settings.tavily.apiKey = v));
      });

    containerEl.createEl("h4", { text: "Write tools & safety" });
    new Setting(containerEl)
      .setName("Approval mode")
      .setDesc("auto = apply immediately (diff logged) · review = always ask (default) · plan = preview only, never apply")
      .addDropdown((d) =>
        d
          .addOption("auto", "Auto (apply immediately)")
          .addOption("review", "Review (ask with diff)")
          .addOption("plan", "Plan (preview only)")
          .setValue(this.plugin.settings.approvalMode)
          .onChange((v) => (this.plugin.settings.approvalMode = v as ApprovalMode))
      );
    new Setting(containerEl)
      .setName("Max tool rounds")
      .setDesc("Stop after this many tool calls per turn (loop cap).")
      .addSlider((s) => s.setLimits(1, 10, 1).setValue(this.plugin.settings.maxToolRounds).onChange((v) => (this.plugin.settings.maxToolRounds = v)));
    new Setting(containerEl)
      .setName("Token budget per turn")
      .setDesc("Approx tokens allowed before the tool loop is forced to stop.")
      .addText((t) => t.setValue(String(this.plugin.settings.tokenBudget)).onChange((v) => (this.plugin.settings.tokenBudget = Number(v) || 12000)));
    new Setting(containerEl)
      .setName("Tools")
      .setDesc("Choose which tools the model may call. Nothing checked off means every tool is available.")
      .addButton((b) =>
        b.setButtonText("Configure…").onClick(() => {
          new ToolsModal(this.app, this.plugin.settings, this.plugin.tools.definitions(), () => this.plugin.saveSettings()).open();
        })
      );

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

  private renderProvider(containerEl: HTMLElement, p: ProviderConfig, i: number) {
    const d = containerEl.createDiv({ cls: "oc-provider" });
    p.type = normalizeProviderType(p.type);
    const preset = presetFor(p.type);

    // header: name + active + remove
    const head = d.createDiv({ cls: "oc-provider-head" });
    head.createEl("h5", { text: p.name || "Provider" });
    const active = head.createEl("button", { cls: "oc-provider-active" });
    setIcon(active, "check");
    active.setAttribute("aria-label", "Set as active provider");
    active.toggleClass("is-active", p.id === this.plugin.settings.activeProviderId);
    active.addEventListener("click", () => {
      this.plugin.settings.activeProviderId = p.id;
      this.save();
      this.display();
    });
    const remove = head.createEl("button", { cls: "oc-provider-remove" });
    setIcon(remove, "trash-2");
    remove.setAttribute("aria-label", "Remove provider");
    remove.addEventListener("click", () => {
      this.plugin.settings.providers.splice(i, 1);
      if (this.plugin.settings.activeProviderId === p.id) {
        this.plugin.settings.activeProviderId = this.plugin.settings.providers[0]?.id ?? "";
      }
      this.save();
      this.display();
    });

    new Setting(d)
      .setName("Name")
      .setDesc("Label shown in the UI.")
      .addText((t) => t.setValue(p.name).onChange((v) => (p.name = v)));

    new Setting(d)
      .setName("Provider")
      .setDesc("Pick a provider — its base URL is filled in automatically. Custom lets you type one.")
      .addDropdown((dd) => {
        for (const pr of PROVIDER_PRESETS) dd.addOption(pr.id, pr.label);
        dd.setValue(p.type).onChange((v) => {
          const nt = normalizeProviderType(v);
          const pr = presetFor(nt);
          p.type = nt;
          p.baseUrl = pr?.baseUrl ?? ""; // auto-fill known preset; custom → empty placeholder
          if (pr?.model) p.model = pr.model;
          if (pr?.label && (p.name === "New provider" || p.name === preset?.label || !p.name)) p.name = pr.label;
          this.save();
          this.display();
        });
      });

    new Setting(d)
      .setName("Base URL")
      .setDesc("Local, cloud, or proxy endpoint. Custom providers use this.")
      .addText((t) => {
        t.setPlaceholder(preset?.basePlaceholder ?? "https://your-endpoint/v1");
        return t.setValue(p.baseUrl).onChange((v) => (p.baseUrl = v));
      });

    new Setting(d)
      .setName("API key")
      .setDesc("Stored here for direct-BYOK. The harness/gateway path never needs it on the host.")
      .addText((t) => {
        t.inputEl.type = "password";
        return t.setValue(p.apiKey).onChange((v) => (p.apiKey = v));
      });

    this.renderModelPicker(d, p, preset);

    // Advanced (thinking levels + vision) — collapsible to keep the card tidy.
    const det = d.createEl("details", { cls: "oc-provider-advanced" });
    det.createEl("summary", { text: "Advanced" });
    const adv = det.createDiv({ cls: "oc-provider-advanced-body" });
    new Setting(adv)
      .setName("Thinking levels")
      .setDesc("Reasoning levels this model supports — the composer's Thinking menu only offers these.")
      .addToggle((t) => t.setTooltip("Off").setValue(hasThinkingLevel(p, "off")).onChange((v) => setThinkingLevel(p, "off", v)))
      .addToggle((t) => t.setTooltip("Low").setValue(hasThinkingLevel(p, "low")).onChange((v) => setThinkingLevel(p, "low", v)))
      .addToggle((t) => t.setTooltip("High").setValue(hasThinkingLevel(p, "high")).onChange((v) => setThinkingLevel(p, "high", v)));
    new Setting(adv)
      .setName("Vision")
      .setDesc("Show the image-attach button for this model (multimodal only).")
      .addToggle((t) => t.setValue(hasVision(p)).onChange((v) => (p.vision = v)));
  }

  private renderModelPicker(d: HTMLElement, p: ProviderConfig, preset: ProviderPreset | undefined) {
    new Setting(d)
      .setName("Model (default for chat)")
      .setDesc("Pick from the provider's models, or type one.")
      .addText((t) => {
        t.setPlaceholder(preset?.model ?? "model-id");
        return t.setValue(p.model).onChange((v) => (p.model = v));
      });

    const row = d.createDiv({ cls: "oc-model-row" });
    const select = row.createEl("select", { cls: "dropdown" });
    select.setAttribute("aria-label", "Provider model list");
    const load = row.createEl("button", { cls: "mod-cta oc-model-load", text: "Load" });
    load.setAttribute("aria-label", "Load models from provider");
    select.addEventListener("change", () => {
      if (select.value) {
        p.model = select.value;
        this.save();
      }
    });
    load.addEventListener("click", async () => {
      new Notice("Loading models…");
      try {
        const ids = await fetchProviderModels(p);
        select.empty();
        if (!ids.length) {
          new Notice("No models returned — check the base URL / API key.");
          return;
        }
        for (const id of ids) {
          const opt = select.createEl("option", { text: id, value: id });
          if (id === p.model) opt.setAttribute("selected", "selected");
        }
        new Notice(`Loaded ${ids.length} models`);
      } catch (err) {
        new Notice(`Couldn't load models: ${String((err as Error).message ?? err)}`);
      }
    });
  }

  private save() {
    this.plugin.saveSettings();
    this.plugin.settings = this.plugin.settings; // re-read reference not needed
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

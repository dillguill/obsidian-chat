/** Obsidian Chat plugin entry point.
 *
 *  The plugin wires the ACP shell: one registered view, the host-owned session
 *  store, the shell runtime (local host or remote attach), and the one-time
 *  folder-free recovery of old Markdown conversations. The legacy chat view is
 *  gone; conversations live in JSONL and are viewed in the shell.
 */
import { parseVoiceProvider, type VoiceProvider } from "./voice/stt.ts";
import { FileSystemAdapter, Notice, Platform, Plugin, WorkspaceLeaf } from "obsidian";
import { ObsidianChatSettingTab } from "./settings";
import {
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  deviceShellOf,
  mergeShared,
  migrateSettings,
  parseDeviceShell,
  pointsAtSelf,
  sharedSettings,
  withDeviceShell,
  type DeviceShell,
  type ObsidianChatSettings,
} from "./settings-model.ts";
import { requireNodeModule } from "./shell/node.ts";
import { SessionStore, type StoreAdapter } from "./session/store";
import { relocateRecords, type RelocationReport } from "./session/relocate.ts";
import { NodeStoreAdapter, hostDataDir } from "./shell/node-store.ts";
import { importLegacySessions, looksLikeLegacyConversation, type LegacyNote, type MigrationReport } from "./session/migrate";
import { ShellChatView, SHELL_VIEW_TYPE } from "./ui/shell-view";
import { LegacyImportInfoModal, type LegacyImportDiagnostics } from "./ui/legacy-import-info";
import { ShellRuntime } from "./shell/runtime";
import type { ShellAttachConfig } from "./shell/types";

export default class ObsidianChatPlugin extends Plugin {
  settings: ObsidianChatSettings = DEFAULT_SETTINGS;
  /** Host-owned append-only conversation store (the shell UI is its viewer). */
  private sessionStore: SessionStore | null = null;
  /** The ACP shell runtime: local host (listener + harness + store) or remote attach. */
  private runtime: ShellRuntime | null = null;
  /** Result of the most recent legacy Markdown import, for History diagnostics. */
  private lastLegacyImport: LegacyImportDiagnostics | null = null;
  /** In-flight vault discovery, so view opens and commands share one scan. */
  private legacyImportRun: Promise<MigrationReport | null> | null = null;

  /** Where conversation records live. On desktop: the OS app-data folder,
   *  outside the vault and its sync (redesign item 5). Mobile never hosts and
   *  keeps the old in-vault location only as a fallback. */
  storage(): { adapter: StoreAdapter; folder: string; location: string } {
    if (!this.storageInfo) {
      const adapter = this.app.vault.adapter;
      if (Platform.isDesktopApp && adapter instanceof FileSystemAdapter) {
        const base = hostDataDir(this.app.vault.getName(), adapter.getBasePath());
        this.storageInfo = { adapter: new NodeStoreAdapter(base), folder: "sessions", location: `${base}/sessions` };
      } else {
        const folder = this.settings.sessionStoreFolder || ".chat/sessions";
        this.storageInfo = { adapter: adapter as unknown as StoreAdapter, folder, location: folder };
      }
    }
    return this.storageInfo;
  }
  private storageInfo: { adapter: StoreAdapter; folder: string; location: string } | null = null;

  /** The host's JSONL session store. */
  store(): SessionStore {
    if (!this.sessionStore) {
      const { adapter, folder } = this.storage();
      this.sessionStore = new SessionStore(adapter, folder);
    }
    return this.sessionStore;
  }

  /** One-time, idempotent copy of records from the old in-vault folder
   *  (`.chat/sessions`) to the host store. Originals stay until the user runs
   *  "Delete old in-vault conversation copies". */
  async relocateRecords(): Promise<RelocationReport | null> {
    if (!Platform.isDesktopApp) return null;
    if (this.relocation) return this.relocation;
    this.relocation = (async () => {
      const target = this.storage();
      if (target.folder === (this.settings.sessionStoreFolder || ".chat/sessions")) return null;
      const report = await relocateRecords({
        from: this.app.vault.adapter as unknown as StoreAdapter,
        fromFolder: this.settings.sessionStoreFolder || ".chat/sessions",
        to: target.adapter,
        toFolder: target.folder,
      });
      if (report.failed.length) {
        console.log(`[obsidian-chat] record move: ${report.failed.length} failed`, report.failed);
        new Notice(`Obsidian Chat: ${report.failed.length} conversation(s) could not be moved out of the vault; they stay readable there and will be retried.`);
      } else if (report.copied.length) {
        const count = report.copied.filter((name) => name.endsWith(".jsonl")).length;
        new Notice(`Obsidian Chat: moved ${count} conversation(s) out of the vault. Old copies in .chat/sessions can be removed with "Delete old in-vault conversation copies".`);
      }
      return report;
    })().catch((err) => {
      this.relocation = null;
      throw err;
    });
    return this.relocation;
  }
  private relocation: Promise<RelocationReport | null> | null = null;

  /** Deletes the old in-vault records, but only those the host store holds
   *  byte-for-byte; anything else is kept and reported. */
  async deleteOldVaultRecords(): Promise<void> {
    const fromFolder = this.settings.sessionStoreFolder || ".chat/sessions";
    const vault = this.app.vault.adapter;
    const target = this.storage();
    if (target.folder === fromFolder || !(await vault.exists(fromFolder))) {
      new Notice("Obsidian Chat: there are no old in-vault conversation copies.");
      return;
    }
    let removed = 0;
    let kept = 0;
    const listing = await vault.list(fromFolder);
    for (const path of listing.files) {
      const name = path.split("/").pop() ?? "";
      const copy = `${target.folder}/${name}`;
      try {
        // A record is only ever appended to, so the host copy must start with
        // the old one; the registry is rewritten, so its presence is enough.
        const same =
          (await target.adapter.exists(copy)) &&
          (name === "registry.json" || (await target.adapter.read(copy)).startsWith(await vault.read(path)));
        if (same) {
          await vault.remove(path);
          removed += 1;
        } else {
          kept += 1;
        }
      } catch {
        kept += 1;
      }
    }
    new Notice(`Obsidian Chat: removed ${removed} old in-vault copies${kept ? `; kept ${kept} without a matching copy` : ""}.`);
  }

  /** The shell attach configuration (local spawn or remote host). */
  shellAttachConfig(): ShellAttachConfig {
    const shell = this.settings.shell;
    return {
      mode: shell.mode,
      command: shell.command,
      cwd: shell.cwd,
      remoteUrl: shell.remoteUrl,
      port: shell.port ?? DEFAULT_PORT,
      deviceName: shell.deviceName,
    };
  }

  shellRuntime(): ShellRuntime {
    if (!this.runtime) {
      this.runtime = new ShellRuntime({
        app: this.app,
        settings: () => ({
          shell: this.shellAttachConfig(),
          sessionStoreFolder: this.settings.sessionStoreFolder || ".chat/sessions",
          blacklistFolders: this.settings.blacklistFolders,
          allowedTailscaleUsers: this.settings.allowedTailscaleUsers,
        }),
        store: () => this.store(),
        storage: () => this.storage(),
        beforeHostStart: async () => {
          await this.relocateRecords().catch((err) => console.log(`[obsidian-chat] record move failed: ${String(err)}`));
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

  async onload() {
    await this.loadSettings();
    // One-time, idempotent, folder-free discovery of pre-JSONL conversations
    // (T108). After layout is ready so plugin load stays fast; History triggers
    // it on demand if this has not finished yet.
    this.app.workspace.onLayoutReady(async () => {
      await this.relocateRecords().catch((err) => console.log(`[obsidian-chat] record move failed: ${String(err)}`));
      void this.importLegacyHistory();
      // The host serves other devices whether or not a chat pane is open here.
      void this.startHostIfLocal();
    });

    this.registerView(SHELL_VIEW_TYPE, (leaf) => new ShellChatView(leaf, this));
    this.addRibbonIcon("message-square", "Open chat", () => void this.activateShellView());
    this.addCommand({
      id: "open-acp-shell",
      name: "Open chat",
      callback: () => void this.activateShellView(),
    });
    this.addCommand({
      id: "acp-shell-connection-info",
      name: "Chat connection info",
      callback: async () => {
        await this.activateShellView();
        const view = this.app.workspace.getLeavesOfType(SHELL_VIEW_TYPE)[0]?.view;
        if (view instanceof ShellChatView) view.openConnectionInfo();
      },
    });
    this.addCommand({
      id: "reimport-legacy-chats",
      name: "Reimport legacy chats (diagnostics)",
      callback: () => void this.reimportLegacyHistory(),
    });
    this.addCommand({
      id: "delete-old-vault-records",
      name: "Delete old in-vault conversation copies",
      callback: () => void this.deleteOldVaultRecords(),
    });
    this.addCommand({
      id: "restart-harness",
      name: "Restart harness",
      callback: () => void this.restartHarness(),
    });

    this.addSettingTab(new ObsidianChatSettingTab(this.app, this));
    this.registerDomEvent(window, "beforeunload", () => void this.runtime?.close());
    // A phone coming back from the background or a network change: check the
    // link at once instead of waiting for the next heartbeat or backoff step.
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") this.runtime?.wake("visible");
    });
    this.registerDomEvent(window, "online", () => this.runtime?.wake("online"));
  }

  /** Host device: start the listener at load (FR: redesign item 2). The
   *  harness itself is still spawned lazily on the first session. */
  private async startHostIfLocal(): Promise<void> {
    if (!Platform.isDesktopApp || this.settings.shell.mode !== "local" || !this.settings.shell.command.trim()) return;
    try {
      await this.shellRuntime().startHost();
    } catch (err) {
      const message = String((err as Error).message ?? err);
      console.log(`[obsidian-chat] host listener did not start: ${message}`);
      new Notice(`Obsidian Chat: the host listener did not start — ${message}`);
    }
  }

  onunload() {
    void this.runtime?.close();
  }

  /** Settings-tab hook: restart the host/harness after connection changes. */
  async restartHost(): Promise<void> {
    if (this.settings.shell.mode !== "local") {
      await this.runtime?.close();
      this.runtime = null;
      return;
    }
    await this.restartHarness();
  }

  async restartHarness(): Promise<void> {
    if (this.settings.shell.mode !== "local") {
      new Notice("Restart the harness on the host device.");
      return;
    }
    try {
      await this.shellRuntime().restartHarness();
      new Notice("Obsidian Chat: harness restarted");
    } catch (err) {
      new Notice(`Obsidian Chat: could not restart the harness — ${String((err as Error).message ?? err)}`);
    }
  }

  // ---------- legacy conversation recovery (folder-free) ----------

  async importLegacyHistory(options: { silent?: boolean; deep?: boolean; force?: boolean } = {}): Promise<MigrationReport | null> {
    if (this.legacyImportRun) return this.legacyImportRun;
    const run = this.runLegacyImport(options).finally(() => {
      if (this.legacyImportRun === run) this.legacyImportRun = null;
    });
    this.legacyImportRun = run;
    return run;
  }

  private async runLegacyImport(options: { silent?: boolean; deep?: boolean; force?: boolean }): Promise<MigrationReport | null> {
    if (!Platform.isDesktopApp) return null;
    if (!options.force && !options.deep && this.settings.legacyImport?.version === 1) {
      const count = await this.store().list().then((sessions) => sessions.length).catch(() => 0);
      if (count > 0 || this.settings.legacyImport.imported === 0) return null;
    }
    const markdown = this.app.vault.getMarkdownFiles();
    if (!options.silent && markdown.length > 400) {
      new Notice(`Obsidian Chat: scanning ${markdown.length} notes for old conversations…`);
    }
    const candidates = new Map<string, (typeof markdown)[number]>();
    const texts = new Map<string, string>();
    let fromFrontmatter = 0;
    for (const file of markdown) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (frontmatter?.type === "chat-session") {
        candidates.set(file.path, file);
        fromFrontmatter += 1;
      }
    }
    let fromScan = 0;
    let readErrors = 0;
    for (const file of markdown) {
      if (candidates.has(file.path)) continue;
      try {
        const text = await this.app.vault.read(file);
        if (looksLikeLegacyConversation(text)) {
          candidates.set(file.path, file);
          texts.set(file.path, text);
          fromScan += 1;
        }
      } catch (err) {
        readErrors += 1;
        console.log(`[obsidian-chat] could not read ${file.path}: ${String(err)}`);
      }
    }
    const notes: LegacyNote[] = [];
    for (const [path, file] of candidates) {
      let text = texts.get(path);
      if (text === undefined) {
        try {
          text = await this.app.vault.read(file);
        } catch (err) {
          readErrors += 1;
          console.log(`[obsidian-chat] could not read legacy note ${path}: ${String(err)}`);
          continue;
        }
      }
      notes.push({ path, text, mtime: file.stat.mtime });
    }
    let report: MigrationReport | null = null;
    let error: string | undefined;
    try {
      report = await importLegacySessions({
        store: this.store(),
        notes,
        log: (message) => console.log(`[obsidian-chat] ${message}`),
      });
      this.settings.legacyImport = { version: 1, completedAt: Date.now(), imported: report.imported };
      await this.saveSettings();
    } catch (err) {
      error = String((err as Error).message ?? err);
      console.log(`[obsidian-chat] legacy import failed: ${error}`);
    }
    const storeCount = await this.store().list().then((sessions) => sessions.length).catch(() => 0);
    this.lastLegacyImport = {
      scannedMarkdown: markdown.length,
      storeFolder: this.storage().location,
      candidates: notes.length,
      candidatesFromFrontmatter: fromFrontmatter,
      candidatesFromScan: fromScan,
      readErrors,
      imported: report?.imported ?? 0,
      alreadyImported: report?.alreadyImported ?? 0,
      skipped: report?.skipped ?? [],
      storeCount,
      error,
    };
    if (!options.silent) {
      const imported = report?.imported ?? 0;
      if (imported > 0) {
        new Notice(`Obsidian Chat: recovered ${imported} old conversation${imported === 1 ? "" : "s"} from the vault.`);
      } else if (notes.length > 0) {
        new Notice(`Obsidian Chat: found ${notes.length} old conversation note(s) but imported 0 — run “Reimport legacy chats (diagnostics)” for details.`);
      }
    }
    return report;
  }

  async reimportLegacyHistory(): Promise<void> {
    await this.importLegacyHistory({ silent: true, deep: true, force: true });
    new LegacyImportInfoModal(this.app, this.lastLegacyImport).open();
  }

  get legacyImportDiagnostics(): LegacyImportDiagnostics | null {
    return this.lastLegacyImport;
  }

  // ---------- settings ----------

  /** The shared settings as this device last loaded or saved them: the base
   *  of the three-way merge in `saveSettings`. */
  private lastShared: Record<string, unknown> = {};

  async loadSettings() {
    const data = (await this.loadData()) ?? {};
    const migration = migrateSettings(data, { isMobile: Platform.isMobile });
    // This device's role lives in per-device local storage; the first run
    // seeds it from what data.json held.
    let device = parseDeviceShell(this.app.loadLocalStorage(DEVICE_SHELL_KEY));
    if (!device) {
      device = deviceShellOf(migration.settings.shell);
      console.log(`[obsidian-chat] device role seeded from data.json: ${device.mode}`);
    }
    if (device.mode === "remote" && Platform.isDesktopApp && pointsAtSelf(device.remoteUrl, ownAddresses())) {
      console.log("[obsidian-chat] remote URL points at this machine; this device is the host (Local mode)");
      device = { ...device, mode: "local" };
    }
    device.port ??= DEFAULT_PORT;
    device.deviceName ??= defaultDeviceName();
    this.app.saveLocalStorage(DEVICE_SHELL_KEY, JSON.stringify(device));
    this.settings = withDeviceShell(migration.settings, device);
    this.lastShared = sharedSettings(migration.settings);
    if (migration.changed) {
      console.log(`[obsidian-chat] settings upgraded: ${migration.notes.join("; ") || "legacy keys dropped"}`);
      // Rewrites data.json without per-device fields or retired secrets.
      await this.saveData(this.lastShared);
    }
  }

  /** Another device changed data.json (through the vault's sync): reload the
   *  shared part, keep this device's own fields. */
  async onExternalSettingsChange() {
    const data = (await this.loadData()) ?? {};
    const migration = migrateSettings(data, { isMobile: Platform.isMobile });
    this.settings = withDeviceShell(migration.settings, deviceShellOf(this.settings.shell));
    this.lastShared = sharedSettings(migration.settings);
    this.refreshViews();
  }

  /** Re-applies composer-affecting settings in open chat views. */
  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(SHELL_VIEW_TYPE)) {
      (leaf.view as { refreshComposer?: () => void }).refreshComposer?.();
    }
  }

  /** Voice input engine for this device (not synced: devices differ). */
  voiceProvider(): VoiceProvider {
    return parseVoiceProvider(this.app.loadLocalStorage(VOICE_PROVIDER_KEY));
  }

  setVoiceProvider(choice: VoiceProvider): void {
    this.app.saveLocalStorage(VOICE_PROVIDER_KEY, choice);
  }

  async saveSettings() {
    this.app.saveLocalStorage(DEVICE_SHELL_KEY, JSON.stringify(deviceShellOf(this.settings.shell)));
    const mine = sharedSettings(this.settings);
    // Merge against the file as it is now, so only keys this device changed
    // are written and a concurrent change from another device survives.
    const current = migrateSettings((await this.loadData()) ?? {}, { isMobile: Platform.isMobile });
    const merged = mergeShared(sharedSettings(current.settings), this.lastShared, mine);
    await this.saveData(merged);
    this.lastShared = merged;
    // Pick up any other device's change that the merge kept.
    const synced = migrateSettings(merged, { isMobile: Platform.isMobile }).settings;
    this.settings = withDeviceShell(synced, deviceShellOf(this.settings.shell));
  }
}

/** Per-device (not synced) storage key for this device's shell role. */
const DEVICE_SHELL_KEY = "obsidian-chat:device-shell";
const VOICE_PROVIDER_KEY = "obsidian-chat:voice-provider";

/** A readable default name for this device (shown in History, routes approvals). */
function defaultDeviceName(): string {
  if (Platform.isMobile) return Platform.isTablet ? "tablet" : "phone";
  const os = requireNodeModule<{ hostname(): string }>("os");
  const host = os?.hostname?.().split(".")[0]?.trim();
  return host || "desktop";
}

/** This machine's own IP addresses (desktop only). */
function ownAddresses(): string[] {
  const os = requireNodeModule<{ networkInterfaces(): Record<string, Array<{ address: string }> | undefined> }>("os");
  if (!os) return [];
  try {
    return Object.values(os.networkInterfaces()).flatMap((list) => (list ?? []).map((entry) => entry.address));
  } catch {
    return [];
  }
}

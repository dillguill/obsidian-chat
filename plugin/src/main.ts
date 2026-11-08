/** Obsidian Chat plugin entry point.
 *
 *  The plugin wires the ACP shell: one registered view, the host-owned session
 *  store, the shell runtime (local host or remote attach), and the one-time
 *  folder-free recovery of old Markdown conversations. The legacy chat view is
 *  gone; conversations live in JSONL and are viewed in the shell.
 */
import { Notice, Platform, Plugin, WorkspaceLeaf } from "obsidian";
import { ObsidianChatSettingTab } from "./settings";
import { DEFAULT_SETTINGS, migrateSettings, type ObsidianChatSettings } from "./settings-model.ts";
import { SessionStore, type StoreAdapter } from "./session/store";
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
  /** Paired devices at load time, so a saved removal can close live sockets. */
  private devicesSnapshot: Record<string, string> = {};

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

  /** The shell attach configuration (local spawn or remote host). */
  shellAttachConfig(): ShellAttachConfig {
    const shell = this.settings.shell;
    return {
      mode: shell.mode,
      command: shell.command,
      cwd: shell.cwd,
      remoteUrl: shell.remoteUrl,
      remoteToken: shell.remoteToken,
      port: shell.port,
      bindAddress: shell.bindAddress,
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
          pairedDevices: this.settings.pairedDevices,
        }),
        store: () => this.store(),
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
    this.app.workspace.onLayoutReady(() => void this.importLegacyHistory());

    this.registerView(SHELL_VIEW_TYPE, (leaf) => new ShellChatView(leaf, this));
    this.addRibbonIcon("terminal-square", "Open ACP Shell", () => void this.activateShellView());
    this.addCommand({
      id: "open-acp-shell",
      name: "Open ACP Shell",
      callback: () => void this.activateShellView(),
    });
    this.addCommand({
      id: "acp-shell-connection-info",
      name: "ACP Shell connection info",
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
      id: "restart-harness",
      name: "Restart harness",
      callback: () => void this.restartHarness(),
    });

    this.addSettingTab(new ObsidianChatSettingTab(this.app, this));
    this.registerDomEvent(window, "beforeunload", () => void this.runtime?.close());
  }

  onunload() {
    void this.runtime?.close();
  }

  /** Settings-tab hook: restart the host/harness after connection changes. */
  async restartHost(): Promise<void> {
    if (this.settings.shell.mode !== "local") return;
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
      storeFolder: this.settings.sessionStoreFolder || ".chat/sessions",
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

  async loadSettings() {
    const data = (await this.loadData()) ?? {};
    const migration = migrateSettings(data, { isMobile: Platform.isMobile });
    this.settings = migration.settings;
    this.devicesSnapshot = { ...this.settings.pairedDevices };
    if (migration.changed) {
      console.log(`[obsidian-chat] settings upgraded: ${migration.notes.join("; ") || "legacy keys dropped"}`);
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Revoking a paired device takes effect immediately: close its live
    // sockets (the relay cancels its parked approvals) without a restart.
    const current = this.settings.pairedDevices;
    for (const name of Object.keys(this.devicesSnapshot)) {
      if (!(name in current)) this.runtime?.revokeDevice(name);
    }
    this.devicesSnapshot = { ...current };
  }
}

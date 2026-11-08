/** Pure settings model + upgrade migration (FR-068/FR-069).
 *
 *  No note-folder or session-folder setting exists: conversations are JSONL
 *  records in the fixed hidden `.chat/sessions/` folder. Legacy blocks
 *  (`gateway`, `host`, fixed model controls, chat folder) are read once and
 *  folded into the shell settings, then dropped.
 *
 *  Obsidian-free so the migration is unit-tested without the app.
 */

export type ActivityDensity = "chronological" | "grouped";
export const DEFAULT_ACTIVITY_DENSITY: ActivityDensity = "chronological";

export interface ShellSettings {
  mode: "local" | "remote";
  /** Local mode: any ACP-speaking harness command. */
  command: string;
  /** Local mode: optional working directory override (defaults to vault root). */
  cwd?: string;
  /** Remote mode: ws:// or wss:// host endpoint. */
  remoteUrl?: string;
  /** Remote mode: per-device transport token (never logged). */
  remoteToken?: string;
  /** Local host mode: listener port. */
  port?: number;
  /** Local host mode: bind address (loopback by default). */
  bindAddress?: string;
}

export interface LegacyImportMarker {
  version: number;
  completedAt: number;
  imported: number;
}

export interface ObsidianChatSettings {
  shell: ShellSettings;
  /** Paired devices: display name → bearer token (host-owned, never rendered remotely). */
  pairedDevices: Record<string, string>;
  blacklistFolders: string[];
  injectVaultRules: boolean;
  /** Fixed internal store location; not a user-facing folder setting. */
  sessionStoreFolder: string;
  activityDensity: ActivityDensity;
  legacyImport?: LegacyImportMarker;
}

export const DEFAULT_SETTINGS: ObsidianChatSettings = {
  shell: { mode: "local", command: "opencode acp", port: 8765, bindAddress: "127.0.0.1" },
  pairedDevices: {},
  blacklistFolders: ["Journals/", "_attachments/", ".trash/"],
  injectVaultRules: true,
  sessionStoreFolder: ".chat/sessions",
  activityDensity: DEFAULT_ACTIVITY_DENSITY,
};

export interface SettingsMigration {
  settings: ObsidianChatSettings;
  changed: boolean;
  notes: string[];
}

export interface MigrationContext {
  isMobile: boolean;
}

export function migrateSettings(raw: unknown, context: MigrationContext): SettingsMigration {
  const data = isRecord(raw) ? raw : {};
  const notes: string[] = [];
  const shell: ShellSettings = { ...DEFAULT_SETTINGS.shell, pairedDevices: undefined } as unknown as ShellSettings;
  delete (shell as unknown as { pairedDevices?: unknown }).pairedDevices;
  const rawShell = isRecord(data.shell) ? data.shell : {};
  const explicitShell = Object.keys(rawShell).length > 0;
  copyString(rawShell, shell, "command", "cwd", "remoteUrl", "remoteToken", "bindAddress");
  if (rawShell.mode === "local" || rawShell.mode === "remote") shell.mode = rawShell.mode;
  copyPort(rawShell, shell);

  const legacyHost = isRecord(data.host) ? data.host : {};
  const gateway = isRecord(data.gateway) ? data.gateway : {};

  // 1) Host-mode users keep their harness command/port; host enablement mapped
  //    onto local shell mode.
  if (!explicitShell || rawShell.mode === undefined) {
    if (legacyHost.enabled === true) {
      shell.mode = "local";
      notes.push("host.enabled → shell.mode=local");
    }
    if (typeof legacyHost.command === "string" && legacyHost.command.trim()) {
      shell.command = legacyHost.command.trim();
      notes.push("host.command → shell.command");
    }
    if (validPort(legacyHost.port)) {
      shell.port = Number(legacyHost.port);
      notes.push("host.port → shell.port");
    }
  }

  // 2) Gateway users were remote clients: map their address/device code.
  if (!explicitShell || rawShell.remoteUrl === undefined) {
    if (typeof gateway.baseUrl === "string" && gateway.baseUrl.trim()) {
      shell.mode = "remote";
      shell.remoteUrl = gateway.baseUrl.trim();
      notes.push("gateway.baseUrl → shell.remoteUrl");
    }
    if (typeof gateway.token === "string" && gateway.token.trim()) {
      shell.remoteToken = gateway.token.trim();
      notes.push("gateway.token → shell.remoteToken");
    }
  }

  // 3) Paired devices move to their own top-level map.
  const pairedDevices = deviceMap(
    isRecord(data.pairedDevices) ? data.pairedDevices : isRecord(legacyHost.devices) ? legacyHost.devices : {},
  );
  if (isRecord(legacyHost.devices)) notes.push("host.devices → pairedDevices");
  if (isRecord(data.pairedDevices)) notes.push("pairedDevices preserved");

  // 4) A fresh mobile install can only be a remote shell.
  if (context.isMobile && !explicitShell && legacyHost.enabled !== true) {
    shell.mode = "remote";
    notes.push("mobile default → shell.mode=remote");
  }

  const settings: ObsidianChatSettings = {
    shell,
    pairedDevices,
    blacklistFolders: stringArray(data.blacklistFolders) ?? [...DEFAULT_SETTINGS.blacklistFolders],
    injectVaultRules: typeof data.injectVaultRules === "boolean" ? data.injectVaultRules : DEFAULT_SETTINGS.injectVaultRules,
    // Fixed internal default: never read a user folder setting.
    sessionStoreFolder: DEFAULT_SETTINGS.sessionStoreFolder,
    activityDensity: data.activityDensity === "grouped" ? "grouped" : DEFAULT_ACTIVITY_DENSITY,
    ...(isLegacyMarker(data.legacyImport) ? { legacyImport: data.legacyImport as LegacyImportMarker } : {}),
  };
  return { settings, changed: stableStringify(settings) !== stableStringify(data), notes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function copyString(from: Record<string, unknown>, to: ShellSettings, ...keys: Array<keyof ShellSettings>): void {
  for (const key of keys) {
    const value = from[key];
    if (typeof value === "string") (to as unknown as Record<string, unknown>)[key] = value;
  }
}

function copyPort(from: Record<string, unknown>, to: ShellSettings): void {
  if (validPort(from.port)) to.port = Number(from.port);
}

function validPort(value: unknown): boolean {
  return typeof value === "number" ? Number.isInteger(value) && value >= 1024 && value <= 65535 : false;
}

function deviceMap(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, token] of Object.entries(value)) {
    if (typeof token === "string" && token) out[name] = token;
  }
  return out;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isLegacyMarker(value: unknown): boolean {
  return isRecord(value) && typeof value.version === "number" && typeof value.completedAt === "number" && typeof value.imported === "number";
}

/** Key-order-independent comparison, so migrating an already-migrated object
 *  reports `changed: false`. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

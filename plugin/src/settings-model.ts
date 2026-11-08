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
export const DEFAULT_ACTIVITY_DENSITY: ActivityDensity = "grouped";

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
  /** Vault folder holding skills ("" = off). Vault-level, so it syncs. */
  skillsFolder: string;
  /** Fixed internal store location; not a user-facing folder setting. */
  sessionStoreFolder: string;
  activityDensity: ActivityDensity;
  /** Explicit confirmation for binding the host beyond loopback (FR-006). */
  allowWiderBind: boolean;
  /** One-time transcript-default upgrade marker (v2 = readable chat default). */
  transcriptVersion?: number;
  legacyImport?: LegacyImportMarker;
}

export const DEFAULT_SETTINGS: ObsidianChatSettings = {
  shell: { mode: "local", command: "opencode acp", port: 8765, bindAddress: "127.0.0.1" },
  pairedDevices: {},
  blacklistFolders: ["Journals/", "_attachments/", ".trash/"],
  injectVaultRules: true,
  skillsFolder: "",
  sessionStoreFolder: ".chat/sessions",
  activityDensity: DEFAULT_ACTIVITY_DENSITY,
  allowWiderBind: false,
  transcriptVersion: 2,
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
  const hostCommand = typeof legacyHost.command === "string" ? legacyHost.command.trim() : "";
  const hostEvidence = legacyHost.enabled === true || hostCommand.length > 0;
  const gatewayUrl = typeof gateway.baseUrl === "string" ? gateway.baseUrl.trim() : "";
  // The old plugin shipped a loopback gateway default in every data.json, so a
  // non-empty baseUrl alone is NOT evidence of a remote install.
  const gatewayLooksRemote = gatewayUrl.length > 0 && !isLoopbackUrl(gatewayUrl);

  // 1) Host-mode users keep their harness command/port; host evidence wins
  //    over the legacy gateway default.
  if (!explicitShell || rawShell.mode === undefined) {
    if (hostEvidence) {
      shell.mode = "local";
      notes.push("host mode → shell.mode=local");
    }
    if (hostCommand) {
      shell.command = hostCommand;
      notes.push("host.command → shell.command");
    }
    if (validPort(legacyHost.port)) {
      shell.port = Number(legacyHost.port);
      notes.push("host.port → shell.port");
    }
  }

  // 2) A real remote gateway maps to remote shell mode; a loopback/empty one
  //    does not (that was the legacy local default).
  if (!explicitShell || rawShell.mode === undefined) {
    if (!hostEvidence && gatewayLooksRemote) {
      shell.mode = "remote";
      notes.push("gateway.baseUrl → shell.mode=remote");
    }
  }
  if (shell.mode === "remote" && (!explicitShell || rawShell.remoteUrl === undefined)) {
    if (gatewayLooksRemote) shell.remoteUrl = gatewayUrl;
    if (typeof gateway.token === "string" && gateway.token.trim()) {
      shell.remoteToken = gateway.token.trim();
      notes.push("gateway.token → shell.remoteToken");
    }
  }

  // 3) Repair a previously mis-migrated install: remote mode pointing at this
  //    machine with no device code can only be the local host.
  if (shell.mode === "remote" && shell.remoteUrl && isLoopbackUrl(shell.remoteUrl) && !shell.remoteToken) {
    shell.mode = "local";
    notes.push("repaired loopback remote → local host");
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
    skillsFolder: typeof data.skillsFolder === "string" ? data.skillsFolder.trim().replace(/^\/+|\/+$/g, "") : "",
    // Fixed internal default: never read a user folder setting.
    sessionStoreFolder: DEFAULT_SETTINGS.sessionStoreFolder,
    // v2 default is a readable chat; an install that has never recorded the
    // marker is upgraded once (it can opt back into the expanded stream).
    activityDensity:
      typeof data.transcriptVersion === "number" && data.transcriptVersion >= 2
        ? data.activityDensity === "chronological"
          ? "chronological"
          : "grouped"
        : DEFAULT_ACTIVITY_DENSITY,
    transcriptVersion: 2,
    allowWiderBind: data.allowWiderBind === true,
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

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    const host = url.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "::1" || host === "localhost";
  } catch {
    return false;
  }
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

// ---------- per-device shell fields ----------

/** Fields that describe THIS device's role. The vault (and its data.json) is
 *  synced between devices, so these must not live in data.json: a phone or
 *  second desktop in Remote mode would otherwise flip the host into Remote
 *  mode attaching to itself. They are kept in per-device local storage. */
export interface DeviceShell {
  mode?: ShellSettings["mode"];
  remoteUrl?: string;
  remoteToken?: string;
}

export function deviceShellOf(shell: ShellSettings): DeviceShell {
  const out: DeviceShell = { mode: shell.mode };
  if (shell.remoteUrl !== undefined) out.remoteUrl = shell.remoteUrl;
  if (shell.remoteToken !== undefined) out.remoteToken = shell.remoteToken;
  return out;
}

export function parseDeviceShell(raw: unknown): DeviceShell | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const out: DeviceShell = {};
  if (value.mode === "local" || value.mode === "remote") out.mode = value.mode;
  if (typeof value.remoteUrl === "string") out.remoteUrl = value.remoteUrl;
  if (typeof value.remoteToken === "string") out.remoteToken = value.remoteToken;
  return out.mode ? out : null;
}

/** Overlays this device's role onto the synced settings. */
export function withDeviceShell(settings: ObsidianChatSettings, device: DeviceShell | null): ObsidianChatSettings {
  if (!device) return settings;
  const shell: ShellSettings = { ...settings.shell };
  if (device.mode) shell.mode = device.mode;
  if ("remoteUrl" in device) shell.remoteUrl = device.remoteUrl;
  if ("remoteToken" in device) shell.remoteToken = device.remoteToken;
  return { ...settings, shell };
}

/** What gets written to the synced data.json: this device's role fields are
 *  replaced by whatever the file already held, so saving here never
 *  overwrites another device's role. */
export function syncedSettings(settings: ObsidianChatSettings, fileShell: DeviceShell): ObsidianChatSettings {
  const shell: ShellSettings = { ...settings.shell };
  delete shell.remoteUrl;
  delete shell.remoteToken;
  shell.mode = fileShell.mode ?? shell.mode;
  if (fileShell.remoteUrl !== undefined) shell.remoteUrl = fileShell.remoteUrl;
  if (fileShell.remoteToken !== undefined) shell.remoteToken = fileShell.remoteToken;
  return { ...settings, shell };
}

/** A Remote URL that points at this machine itself is never a real remote:
 *  this device must be the host. `ownAddresses` are this machine's IPs. */
export function pointsAtSelf(remoteUrl: string | undefined, ownAddresses: string[]): boolean {
  if (!remoteUrl) return false;
  if (isLoopbackUrl(remoteUrl)) return true;
  let host: string;
  try {
    host = new URL(remoteUrl.includes("://") ? remoteUrl : `http://${remoteUrl}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return ownAddresses.includes(host);
}

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

/** In-memory shell settings. `command`/`cwd` are shared (synced in data.json);
 *  `mode`, `remoteUrl`, `port` and `deviceName` belong to this device and live
 *  in per-device local storage (see `DeviceShell`). */
export interface ShellSettings {
  /** This device's role. */
  mode: "local" | "remote";
  /** Host: any ACP-speaking harness command. Shared. */
  command: string;
  /** Host: optional working directory override (defaults to vault root). Shared. */
  cwd?: string;
  /** Remote: the host's address, e.g. its tailnet name (https:// or wss://). */
  remoteUrl?: string;
  /** Host: loopback listener port that Tailscale Serve publishes. */
  port?: number;
  /** This device's display name (routes approvals, shown in History). */
  deviceName?: string;
}

export interface LegacyImportMarker {
  version: number;
  completedAt: number;
  imported: number;
}

export interface ObsidianChatSettings {
  shell: ShellSettings;
  /** Tailscale logins allowed to attach through Tailscale Serve ([] = any
   *  user on the tailnet). Not secret, so it is synced. */
  allowedTailscaleUsers: string[];
  blacklistFolders: string[];
  injectVaultRules: boolean;
  /** Vault folder holding skills ("" = off). Vault-level, so it syncs. */
  skillsFolder: string;
  /** Speech-to-text server (whisper.cpp-style); "" = no mic. */
  sttUrl: string;
  /** Fixed internal store location; not a user-facing folder setting. */
  sessionStoreFolder: string;
  activityDensity: ActivityDensity;
  /** One-time transcript-default upgrade marker (v2 = readable chat default). */
  transcriptVersion?: number;
  legacyImport?: LegacyImportMarker;
}

export const DEFAULT_PORT = 8765;

export const DEFAULT_SETTINGS: ObsidianChatSettings = {
  shell: { mode: "local", command: "opencode acp", port: DEFAULT_PORT },
  allowedTailscaleUsers: [],
  blacklistFolders: ["Journals/", "_attachments/", ".trash/"],
  injectVaultRules: true,
  skillsFolder: "",
  sttUrl: "",
  sessionStoreFolder: ".chat/sessions",
  activityDensity: DEFAULT_ACTIVITY_DENSITY,
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
  copyString(rawShell, shell, "command", "cwd", "remoteUrl");
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
  }

  // 3) Repair a previously mis-migrated install: remote mode pointing at this
  //    machine with no device code can only be the local host.
  if (shell.mode === "remote" && shell.remoteUrl && isLoopbackUrl(shell.remoteUrl)) {
    shell.mode = "local";
    notes.push("repaired loopback remote → local host");
  }

  // Paired-device codes, device tokens and bind settings are retired: remote
  // devices authenticate through Tailscale Serve identity and the listener is
  // loopback-only. Dropping them also removes secrets from the synced file.
  for (const key of ["pairedDevices", "allowWiderBind"]) if (key in data) notes.push(`${key} retired`);
  if ("remoteToken" in rawShell || "bindAddress" in rawShell) notes.push("device code / bind address retired");

  // 4) A fresh mobile install can only be a remote shell.
  if (context.isMobile && !explicitShell && legacyHost.enabled !== true) {
    shell.mode = "remote";
    notes.push("mobile default → shell.mode=remote");
  }

  const settings: ObsidianChatSettings = {
    shell,
    allowedTailscaleUsers: (stringArray(data.allowedTailscaleUsers) ?? []).map((v) => v.trim()).filter(Boolean),
    blacklistFolders: stringArray(data.blacklistFolders) ?? [...DEFAULT_SETTINGS.blacklistFolders],
    injectVaultRules: typeof data.injectVaultRules === "boolean" ? data.injectVaultRules : DEFAULT_SETTINGS.injectVaultRules,
    skillsFolder: typeof data.skillsFolder === "string" ? data.skillsFolder.trim().replace(/^\/+|\/+$/g, "") : "",
    sttUrl: typeof data.sttUrl === "string" ? data.sttUrl.trim() : "",
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
    ...(isLegacyMarker(data.legacyImport) ? { legacyImport: data.legacyImport as LegacyImportMarker } : {}),
  };
  return { settings, changed: stableStringify(sharedSettings(settings)) !== stableStringify(data), notes };
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

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isLegacyMarker(value: unknown): boolean {
  return isRecord(value) && typeof value.version === "number" && typeof value.completedAt === "number" && typeof value.imported === "number";
}

/** Key-order-independent comparison, so migrating an already-migrated object
 *  reports `changed: false`. */
export function stableStringify(value: unknown): string {
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

// ---------- shared vs per-device ----------

/** Fields that describe THIS device. The vault (and its data.json) is synced
 *  between devices, so these never go into data.json: they live in per-device
 *  local storage. Nothing secret is stored anywhere: remote devices
 *  authenticate with their Tailscale identity. */
export interface DeviceShell {
  mode?: ShellSettings["mode"];
  remoteUrl?: string;
  port?: number;
  deviceName?: string;
}

export function deviceShellOf(shell: ShellSettings): DeviceShell {
  const out: DeviceShell = { mode: shell.mode };
  if (shell.remoteUrl !== undefined) out.remoteUrl = shell.remoteUrl;
  if (shell.port !== undefined) out.port = shell.port;
  if (shell.deviceName !== undefined) out.deviceName = shell.deviceName;
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
  if (validPort(value.port)) out.port = Number(value.port);
  if (typeof value.deviceName === "string" && value.deviceName.trim()) out.deviceName = value.deviceName.trim();
  return out.mode ? out : null;
}

/** Overlays this device's fields onto the shared settings. */
export function withDeviceShell(settings: ObsidianChatSettings, device: DeviceShell | null): ObsidianChatSettings {
  if (!device) return settings;
  const shell: ShellSettings = { ...settings.shell };
  if (device.mode) shell.mode = device.mode;
  if ("remoteUrl" in device) shell.remoteUrl = device.remoteUrl;
  if (device.port !== undefined) shell.port = device.port;
  if (device.deviceName !== undefined) shell.deviceName = device.deviceName;
  return { ...settings, shell };
}

/** The shared (synced) part of the settings: what data.json holds. */
export function sharedSettings(settings: ObsidianChatSettings): Record<string, unknown> {
  const shell: Record<string, unknown> = { command: settings.shell.command };
  if (settings.shell.cwd) shell.cwd = settings.shell.cwd;
  const out: Record<string, unknown> = { ...settings, shell };
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}

/** Three-way merge for saving: only top-level keys this device changed since
 *  it last loaded (`base` → `mine`) are written; every other key keeps what the
 *  file holds now, so a device never reverts another device's change. */
export function mergeShared(
  file: Record<string, unknown>,
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...file };
  for (const key of Object.keys(mine)) {
    if (stableStringify(mine[key]) !== stableStringify(base[key])) out[key] = mine[key];
    else if (!(key in file)) out[key] = mine[key];
  }
  for (const key of Object.keys(base)) {
    if (!(key in mine)) delete out[key];
  }
  return out;
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

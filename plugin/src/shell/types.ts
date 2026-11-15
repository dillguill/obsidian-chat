/** Shell attach configuration and environment seams (transport-agnostic). */

export type ShellMode = "local" | "remote";

export interface ShellAttachConfig {
  mode: ShellMode;
  /** Local mode: the harness command line, e.g. `opencode acp`. */
  command: string;
  /** Local mode: optional working directory override (defaults to vault root). */
  cwd?: string;
  /** Remote mode: the host's address (its tailnet name through Tailscale
   *  Serve), https:// or wss://. */
  remoteUrl?: string;
  /** Local host mode: loopback listener port (default 8765). The listener
   *  never binds beyond loopback; Tailscale Serve publishes it. */
  port?: number;
  /** This device's display name, sent to the host on attach. */
  deviceName?: string;
}

export interface ShellPaths {
  /** Absolute vault root on this machine. */
  vaultRoot: string;
  /** Absolute root the harness uses for the same vault (usually vaultRoot). */
  harnessRoot: string;
}

/** The native environment the ACP filesystem capabilities run against. */
export interface ShellEnvironment {
  readTextFile(path: string, line?: number, limit?: number): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  /** Best-effort pre-write snapshot; failure must not block the write. */
  snapshotBeforeWrite?(path: string): Promise<void>;
  afterWrite?(path: string): Promise<void>;
  /** True when ACP fs capabilities should be advertised. */
  canServeVault(): boolean;
}

export interface AttachStatus {
  mode: ShellMode | "relay";
  label: string;
  state: "idle" | "connecting" | "connected" | "reconnecting" | "unreachable" | "closed";
  sessionId: string | null;
  retries: number;
  lastError: string | null;
}

/** True for addresses that stay on this machine. */
export function isLoopbackBind(address: string): boolean {
  const value = address.trim().toLowerCase();
  return value === "127.0.0.1" || value === "::1" || value === "localhost" || value === "::ffff:127.0.0.1";
}

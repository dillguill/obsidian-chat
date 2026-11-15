/** Attach credentials.
 *
 *  - The host's own chat view uses a per-run token that is never persisted.
 *  - Remote devices authenticate with their Tailscale identity: Tailscale
 *    Serve proxies the tailnet name to the loopback listener and sets
 *    `Tailscale-User-Login` (it strips any client-supplied value). The device
 *    name is a self-declared label for routing/UX, not a credential.
 *  - `devices` (name → token) remains for tests and embedders; the plugin
 *    passes none. Comparison is constant-time and no token is ever logged.
 */

export interface DeviceRegistryOptions {
  /** Optional static token table (name → token); the plugin passes none. */
  devices?: () => Record<string, string>;
  /** Per-host-run token for the host's own chat view; never persisted. */
  localToken: string;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function mintToken(bytes = 24): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const a = new Uint8Array(bytes);
  c.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class DeviceRegistry {
  private opts: DeviceRegistryOptions;
  constructor(options: DeviceRegistryOptions) {
    this.opts = options;
  }

  /** Returns the device id for a token, or null. `__local__` is the host UI. */
  deviceForToken(token: string | null): string | null {
    if (!token) return null;
    if (constantTimeEqual(token, this.opts.localToken)) return "__local__";
    for (const [name, value] of Object.entries(this.opts.devices?.() ?? {})) {
      if (constantTimeEqual(token, value)) return name;
    }
    return null;
  }

  /** Revocation is reflected on the next lookup; callers close live sockets. */
  isRevoked(deviceId: string): boolean {
    if (deviceId === "__local__") return false;
    return !(deviceId in (this.opts.devices?.() ?? {}));
  }
}

/** Extracts a bearer token from a `?token=` query parameter (WebSocket
 *  constructors in browsers/WebViews cannot set request headers). */
export function tokenFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get("token");
  } catch {
    return null;
  }
}

/** Tailscale Serve's identity header (lower-case, as Node exposes headers). */
export const TAILSCALE_LOGIN_HEADER = "tailscale-user-login";

/** True when a Tailscale login may attach: an empty allow-list means any
 *  user Tailscale Serve vouches for. Comparison is case-insensitive. */
export function loginAllowed(login: string | null | undefined, allowed: readonly string[]): boolean {
  const value = login?.trim().toLowerCase();
  if (!value) return false;
  const list = allowed.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(value);
}

/** The self-declared device label from `?device=` (sanitized). */
export function deviceNameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  let raw: string | null;
  try {
    raw = new URL(url, "http://localhost").searchParams.get("device");
  } catch {
    return null;
  }
  const name = raw?.trim().replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 40).trim();
  if (!name || name.startsWith("__")) return null;
  return name;
}

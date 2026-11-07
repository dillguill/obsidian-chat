/** Paired-device credentials (FR-009/FR-010/FR-016/FR-017).
 *
 *  Tokens live in host settings (`devices: name → token`); the local UI uses a
 *  per-run token that is never persisted. Comparison is constant-time and no
 *  token is ever logged, rendered, or stored in a session record.
 */

export interface DeviceRegistryOptions {
  /** Read the current pairing table (name → token). */
  devices: () => Record<string, string>;
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
    for (const [name, value] of Object.entries(this.opts.devices())) {
      if (constantTimeEqual(token, value)) return name;
    }
    return null;
  }

  /** Revocation is reflected on the next lookup; callers close live sockets. */
  isRevoked(deviceId: string): boolean {
    if (deviceId === "__local__") return false;
    return !(deviceId in this.opts.devices());
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

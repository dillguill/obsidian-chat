/** Where `web_fetch` may go (redesign §6). Pure, so it is unit-tested.
 *
 *  The agent reads the user's notes and untrusted pages in the same
 *  conversation, so a fetch must never reach this machine, the LAN or the
 *  tailnet (the vault tools, the NAS, admin pages): only public http(s)
 *  addresses. Checked on the URL's host name before DNS and on every
 *  resolved address (and again on each redirect), so DNS can't smuggle a
 *  private address in. */

const BLOCKED_SUFFIXES = [".internal", ".local", ".localhost", ".lan", ".home", ".arpa", ".ts.net", ".test", ".invalid"];

/** Reason a URL is refused before any network access, or null when allowed. */
export function urlRefusal(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return `only http(s) URLs can be fetched (got ${url.protocol})`;
  if (url.username || url.password) return "URLs with credentials are not fetched";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return "the URL has no host";
  if (host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return `${host} is a local or private name`;
  }
  if (isIpLiteral(host) && !isPublicAddress(host)) return `${host} is not a public address`;
  return null;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.replace(/^::ffff:/, ""));
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT / Tailscale
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false; // 192.0.0.0/24, 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false; // multicast, reserved, broadcast
    return true;
  }
  if (!ip.includes(":")) return false;
  if (ip === "::" || ip === "::1") return false;
  if (/^f[cd]/.test(ip)) return false; // ULA fc00::/7
  if (/^fe[89ab]/.test(ip)) return false; // link-local fe80::/10
  if (/^ff/.test(ip)) return false; // multicast
  if (/^fd7a:115c:a1e0/.test(ip)) return false; // Tailscale
  if (/^(64:ff9b|2001:db8|2001:0db8)/.test(ip)) return false;
  return true;
}

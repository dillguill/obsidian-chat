/** Pure lexical path policy shared by ACP filesystem capabilities, the MCP
 *  vault tools, and the shell's mention index (FR-021/FR-022/FR-023).
 *
 *  No Obsidian import: this module runs under plain Node in tests and is the
 *  single implementation of "what may the harness touch".
 */

export type PathDenyReason = "malformed" | "outside-vault" | "blacklisted" | "config-protected";

export interface PathPolicyConfig {
  /** Absolute vault root as the host filesystem sees it (posix-normalized). */
  vaultRoot: string;
  /** Absolute root the harness uses for the same vault (local: vaultRoot;
   *  remote-with-mapping: the configured prefix). */
  harnessRoot: string;
  /** Vault-relative folders the agent must never read or write. */
  blacklist: readonly string[];
  /** Extra protected prefixes (vault-relative). Defaults include the session
   *  store and `.trash`; `.obsidian` is always protected. */
  protectedPrefixes?: readonly string[];
}

export type PathVerdict =
  | { allowed: true; absolutePath: string; relPath: string }
  | { allowed: false; reason: PathDenyReason; detail: string };

const DEFAULT_PROTECTED = [".obsidian", ".trash", ".chat/sessions"];

function posix(p: string): string {
  let s = (p ?? "").replace(/\\/g, "/");
  s = s.replace(/\/{2,}/g, "/");
  return s;
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** Normalizes a vault-relative path or returns null for malformed input. */
export function normalizeRelative(p: string): string | null {
  if (typeof p !== "string") return null;
  const raw = posix(p.trim());
  if (!raw || raw.startsWith("/")) return null;
  if (raw.includes("\0")) return null;
  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.join("/");
}

/** Case-insensitive folder/descendant match for the blacklist. */
export function isBlacklisted(relPath: string, blacklist: readonly string[]): boolean {
  const rel = `/${relPath.toLowerCase()}`;
  for (const raw of blacklist) {
    const folder = normalizeRelative(String(raw ?? "").trim());
    if (!folder) continue;
    const f = `/${folder.toLowerCase()}`;
    if (rel === f || rel.startsWith(`${f}/`)) return true;
  }
  return false;
}

function protectedReason(relPath: string, protectedPrefixes: readonly string[]): PathDenyReason | null {
  const rel = `/${relPath.toLowerCase()}`;
  for (const raw of [...DEFAULT_PROTECTED, ...protectedPrefixes]) {
    const norm = normalizeRelative(raw.replace(/\/+$/, "").toLowerCase());
    if (!norm) continue;
    const p = `/${norm}`;
    if (rel === p || rel.startsWith(`${p}/`)) return "config-protected";
  }
  return null;
}

/** Evaluates an ACP capability path. ACP requires absolute paths; the path is
 *  mapped from `harnessRoot` to a vault-relative path and never clamped. */
export function evaluateAcpPath(requestPath: string, config: PathPolicyConfig): PathVerdict {
  if (typeof requestPath !== "string" || !requestPath.trim()) {
    return { allowed: false, reason: "malformed", detail: "empty path" };
  }
  if (requestPath.includes("\0")) {
    return { allowed: false, reason: "malformed", detail: "NUL byte" };
  }
  if (/[\u0000-\u001f]/.test(requestPath)) {
    return { allowed: false, reason: "malformed", detail: "control character" };
  }
  const req = posix(requestPath.trim());
  const isAbsolute = req.startsWith("/") || /^[A-Za-z]:\//.test(req);
  if (!isAbsolute) {
    return { allowed: false, reason: "outside-vault", detail: "path must be absolute" };
  }
  const harness = stripTrailingSlash(posix(config.harnessRoot.trim())).toLowerCase();
  const lower = req.toLowerCase();
  if (lower !== harness && !lower.startsWith(`${harness}/`)) {
    return { allowed: false, reason: "outside-vault", detail: "path is outside the harness root" };
  }
  const rest = req.slice(stripTrailingSlash(posix(config.harnessRoot.trim())).length);
  const rel = normalizeRelative(rest.replace(/^\/+/, ""));
  if (rel === null) return { allowed: false, reason: "malformed", detail: "path escapes the vault" };
  if (!rel) return { allowed: false, reason: "malformed", detail: "path is the vault root" };
  const protectedBy = protectedReason(rel, config.protectedPrefixes ?? []);
  if (protectedBy === "config-protected") {
    return { allowed: false, reason: "config-protected", detail: "path is Obsidian configuration/state" };
  }
  if (isBlacklisted(rel, config.blacklist)) {
    return { allowed: false, reason: "blacklisted", detail: "path is in a blacklisted folder" };
  }
  const absoluteBase = stripTrailingSlash(posix(config.vaultRoot.trim()));
  return { allowed: true, absolutePath: `${absoluteBase}/${rel}`, relPath: rel };
}

/** Evaluates a vault-relative path supplied by an MCP tool. */
export function evaluateRelativePath(relPath: string, config: PathPolicyConfig): PathVerdict {
  const rel = normalizeRelative(relPath);
  if (rel === null) return { allowed: false, reason: "malformed", detail: "invalid relative path" };
  if (!rel) return { allowed: false, reason: "malformed", detail: "path is the vault root" };
  const protectedBy = protectedReason(rel, config.protectedPrefixes ?? []);
  if (protectedBy === "config-protected") {
    return { allowed: false, reason: "config-protected", detail: "path is Obsidian configuration/state" };
  }
  if (isBlacklisted(rel, config.blacklist)) {
    return { allowed: false, reason: "blacklisted", detail: "path is in a blacklisted folder" };
  }
  const base = stripTrailingSlash(posix(config.vaultRoot.trim()));
  return { allowed: true, absolutePath: `${base}/${rel}`, relPath: rel };
}

/** Maps a harness-absolute path to a vault-relative path when it is allowed;
 *  returns null for any refusal (callers turn that into an error result). */
export function mapHarnessPath(requestPath: string, config: PathPolicyConfig): string | null {
  const v = evaluateAcpPath(requestPath, config);
  return v.allowed ? v.relPath : null;
}

/** Shared tool-input helpers (obsidian-free).
 *
 *  Used by `acp/client.ts` — which sanitises and bounds the raw ACP tool input
 *  before it reaches the UI — and by `ui/activity.ts`, which derives a row's
 *  target from it. Keeping the key lists here avoids two drifting copies.
 *
 *  The vault MCP tools (`host/vault-mcp.ts`) all take `path`, and `move` adds
 *  `destination`; the other keys cover common harness-native tools.
 */

/** Input keys carrying a vault/filesystem path, highest priority first. */
export const PATH_INPUT_KEYS = [
  "path",
  "file_path",
  "filePath",
  "file",
  "targetPath",
  "destination",
  "newPath",
] as const;

/** Input keys carrying a non-path target (rendered raw, truncated). */
export const TEXT_INPUT_KEYS = ["query", "pattern", "command", "description", "url"] as const;

/** Max characters kept per string value in a sanitised tool input. */
export const MAX_TOOL_INPUT_STRING = 300;

/** Max keys kept in a sanitised tool input. */
export const MAX_TOOL_INPUT_KEYS = 20;

function firstString(input: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!input) return undefined;
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** First path-shaped value in the input, if any. */
export function pathFromInput(input?: Record<string, unknown>): string | undefined {
  return firstString(input, PATH_INPUT_KEYS);
}

/** First non-path target (query/pattern/command/…) in the input, if any. */
export function textFromInput(input?: Record<string, unknown>): string | undefined {
  return firstString(input, TEXT_INPUT_KEYS);
}

/** True when the input carried a path-shaped target. */
export function inputHasPath(input?: Record<string, unknown>): boolean {
  return pathFromInput(input) !== undefined;
}

/** Path first, then a text target, then the first ACP location.
 *  (`locations` is empty on opencode today — kept for other harnesses.) */
export function pickTarget(
  input?: Record<string, unknown>,
  locations?: { path?: string }[] | null,
): string | undefined {
  const fromInput = pathFromInput(input) ?? textFromInput(input);
  if (fromInput) return fromInput;
  const loc = locations?.find((l) => typeof l?.path === "string" && l.path.trim());
  return loc?.path?.trim() || undefined;
}

/** Shallow, bounded copy of a tool's `rawInput`.
 *
 *  ACP sends the full arguments (a write carries the whole note body), so the
 *  UI must never hold the raw object: strings are capped at
 *  {@link MAX_TOOL_INPUT_STRING}, other values are JSON-stringified under the
 *  same cap, and at most {@link MAX_TOOL_INPUT_KEYS} keys are kept. Returns
 *  `undefined` when there is nothing usable. */
export function sanitizeToolInput(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_TOOL_INPUT_KEYS) break;
    if (typeof v === "string") {
      out[k] = v.length > MAX_TOOL_INPUT_STRING ? v.slice(0, MAX_TOOL_INPUT_STRING) + "…" : v;
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    } else {
      try {
        const s = JSON.stringify(v);
        out[k] = s.length > MAX_TOOL_INPUT_STRING ? s.slice(0, MAX_TOOL_INPUT_STRING) + "…" : s;
      } catch {
        // Circular / unserialisable — skip rather than fail the whole event.
      }
    }
    n++;
  }
  return Object.keys(out).length ? out : undefined;
}

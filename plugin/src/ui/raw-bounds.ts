/** Bounded raw payload display (FR-050): local-only, lazily rendered, never
 *  written into the transcript as content. The full payload remains in the
 *  host's session record; the UI shows at most 16 KiB with an explicit
 *  truncation marker. */

export const RAW_DISPLAY_LIMIT = 16 * 1024;

export interface BoundedJson {
  text: string;
  truncated: boolean;
  originalBytes: number;
}

/** JSON-stringifies a value and bounds the display string. Arrays/strings are
 *  handled by JSON; circular values fall back to String() rather than throwing
 *  inside the renderer. */
export function boundedJson(value: unknown, limit = RAW_DISPLAY_LIMIT): BoundedJson {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  const originalBytes = byteLength(text);
  if (originalBytes <= limit) return { text, truncated: false, originalBytes };
  return {
    text: `${truncateBytes(text, limit)}\n…(truncated: ${originalBytes} bytes total)`,
    truncated: true,
    originalBytes,
  };
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Byte-safe truncation (never splits a multi-byte character). */
function truncateBytes(text: string, limit: number): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let out = "";
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) break;
    bytes += size;
    out += char;
  }
  return out;
}

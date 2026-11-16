/** A conversation's display title, derived from its record (pure, no
 *  Obsidian import). Precedence: a name the user set, then the harness's
 *  latest `session_info_update` title, then a real header title, then the
 *  first typed prompt. Computed on read, so every device sees the same name. */
import type { RecordEntry, SessionHeader } from "./record.ts";
import { titleFromText } from "../chat/session-title.ts";
import { promptDisplay } from "../ui/renderer.ts";

/** Header titles written as placeholders, never shown as a name. */
const PLACEHOLDERS = new Set(["", "acp session", "new chat", "untitled conversation"]);

export const RENAME_METHOD = "_obsidian-chat/session/rename";

/** Extension request a client uses to check that the host still answers
 *  (application-level ping; browser WebSockets can't send protocol pings). */
export const PING_METHOD = "_obsidian-chat/ping";

/** Extension request: turn web access on/off for one conversation (the
 *  composer's globe). Off by default; the host enforces it in the tools. */
export const WEB_METHOD = "_obsidian-chat/session/web";
export const MAX_TITLE_CHARS = 120;

export function isPlaceholderTitle(title: string | null | undefined): boolean {
  return PLACEHOLDERS.has((title ?? "").trim().toLowerCase());
}

export function effectiveTitle(header: Pick<SessionHeader, "title">, entries: readonly RecordEntry[]): string | null {
  let user: string | null = null;
  let harness: string | null = null;
  let firstPrompt: string | null = null;
  for (const entry of entries) {
    if (entry.kind === "meta") {
      const meta = entry as RecordEntry & { title?: string; source?: string };
      const title = meta.title?.trim();
      if (!title) continue;
      if (meta.source === "user") user = title;
      else harness = title;
    } else if (entry.kind === "update") {
      const update = entry as RecordEntry & { sessionUpdate?: string; payload?: { title?: unknown } };
      if (update.sessionUpdate === "session_info_update" && typeof update.payload?.title === "string" && update.payload.title.trim()) {
        harness = update.payload.title.trim();
      }
    } else if (entry.kind === "prompt" && firstPrompt === null) {
      const text = promptDisplay((entry as RecordEntry & { blocks?: unknown }).blocks).text;
      if (text) firstPrompt = titleFromText(text);
    }
  }
  if (user) return user;
  if (harness) return harness;
  if (!isPlaceholderTitle(header.title)) return header.title!.trim();
  return firstPrompt;
}

/** Latest activity time: the header's `updatedAt` is written once at create. */
export function lastActivity(header: Pick<SessionHeader, "updatedAt">, entries: readonly RecordEntry[]): number {
  let latest = header.updatedAt;
  for (const entry of entries) {
    const ts = (entry as { ts?: number }).ts;
    if (typeof ts === "number" && ts > latest) latest = ts;
  }
  return latest;
}

/** Normalizes a user-entered name; null when it is empty. */
export function cleanTitle(raw: string): string | null {
  const flat = raw.replace(/\s+/g, " ").replace(/[\u0000-\u001f]/g, "").trim();
  if (!flat) return null;
  return flat.length > MAX_TITLE_CHARS ? flat.slice(0, MAX_TITLE_CHARS) : flat;
}

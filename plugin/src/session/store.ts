/** Sessions as notes (PLAN §2.8 storage). One note per chat session with YAML
 *  frontmatter (model, provider, tokens, timestamps) and a readable body that
 *  shows the conversation. Everything is Markdown so Obsidian Sync, Graph View,
 *  and Dataview work for free. */
import type { ChatMessage } from "../chat/types";

export interface SessionMeta {
  model: string;
  provider: string;
  created: number;
  updated: number;
  tokens: number;
}

const FRONTMATTER_KEYS = ["model", "provider", "created", "updated", "tokens"] as const;

export function frontmatterToMeta(fm: Record<string, unknown>): Partial<SessionMeta> {
  const out: Partial<SessionMeta> = {};
  for (const k of FRONTMATTER_KEYS) if (fm[k] !== undefined) (out as any)[k] = fm[k];
  return out;
}

function fmt(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function metaToFrontmatter(meta: SessionMeta): string {
  return [
    "---",
    `type: chat-session`,
    `model: ${json(meta.model)}`,
    `provider: ${json(meta.provider)}`,
    `created: ${fmt(meta.created)}`,
    `updated: ${fmt(meta.updated)}`,
    `tokens: ${meta.tokens}`,
    "---",
    "",
  ].join("\n");
}

function json(s: string) {
  return /^[\w./:-]+$/.test(s) ? s : JSON.stringify(s);
}

/** Render the conversation into a readable note body. */
export function renderBody(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const m of messages) {
    const label = m.role === "user" ? "👤 User" : m.role === "assistant" ? "🤖 Assistant" : m.role === "system" ? "🔑 System" : "🔧 Tool";
    lines.push(`## ${label} (${fmt(Date.now())})`, "", m.content.trim());
    // Don't persist base64 — record a display placeholder so the note stays readable.
    if (m.images?.length) {
      for (const img of m.images) lines.push(`![image: ${img.name ?? "attached"}]`, "");
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Compute an approximate token count (chars/4) for the meter. */
export function approxTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length + 8;
  return Math.ceil(chars / 4);
}

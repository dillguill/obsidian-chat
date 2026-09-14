/** Sessions as notes (PLAN §2.8 storage). One note per chat session with YAML
 *  frontmatter (tokens, timestamps) and a readable body that shows the
 *  conversation. Everything is Markdown so Obsidian Sync, Graph View, and
 *  Dataview work for free. No `model`/`provider` field — the plugin is an
 *  ACP client and doesn't know this (Constitution Principle II). */
import type { ActivityItem, ChatMessage } from "../chat/types";

export interface SessionMeta {
  created: number;
  updated: number;
  tokens: number;
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
    `created: ${fmt(meta.created)}`,
    `updated: ${fmt(meta.updated)}`,
    `tokens: ${meta.tokens}`,
    "---",
    "",
  ].join("\n");
}

/** Render the conversation into a readable note body. Reasoning bursts
 *  (specs/002-acp-only-chat-ux US4) are recorded as `### 🧠 Thought (Ns)`
 *  sub-sections before the message's final content, so `ChatView.loadSession`
 *  can render them back as collapsed thought blocks (FR-010). */
export function renderBody(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const m of messages) {
    const label = m.role === "user" ? "👤 User" : m.role === "assistant" ? "🤖 Assistant" : m.role === "system" ? "🔑 System" : "🔧 Tool";
    lines.push(`## ${label} (${fmt(Date.now())})`, "");
    if (m.reasoning?.length) {
      for (const r of m.reasoning) {
        const dur = r.durationSeconds !== undefined ? ` (${r.durationSeconds}s)` : "";
        lines.push(`### 🧠 Thought${dur}`, "", r.text.trim(), "");
      }
      // Thought text can itself contain blank lines, so a blank line alone
      // can't mark where a thought section ends and the final content
      // resumes — an explicit marker is needed (loadSession in chat-view.ts).
      lines.push("<!-- end-thoughts -->", "");
    }
    if (m.activity?.length) {
      // Tool activity is machine-shaped, so it is stored base64'd inside an
      // HTML comment: invisible in Reading view, byte-exact on reload (W7.4),
      // and harmless to any other Markdown tool. Capped at the last 50 rows.
      lines.push(`<!-- oc-activity-b64: ${base64Encode(JSON.stringify({ v: 1, items: m.activity.slice(-50) }))} -->`, "");
    }
    lines.push(m.content.trim());
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

/** UTF-8-safe base64 (btoa alone throws on non-Latin1 input). */
function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64Decode(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Decodes one stored activity payload; null when absent or malformed. */
function decodeActivity(b64: string): ActivityItem[] | null {
  try {
    const parsed = JSON.parse(base64Decode(b64)) as { items?: ActivityItem[] };
    return Array.isArray(parsed.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

/** Every stored activity trail in a session body, in note order (W7.4). */
export function extractActivityTrails(body: string): ActivityItem[][] {
  const out: ActivityItem[][] = [];
  const re = /<!-- oc-activity-b64: ([A-Za-z0-9+/=]+) -->/g;
  for (const match of body.matchAll(re)) {
    const items = decodeActivity(match[1]);
    if (items?.length) out.push(items);
  }
  return out;
}

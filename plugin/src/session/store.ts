/** Sessions as notes (PLAN §2.8 storage). One note per chat session with YAML
 *  frontmatter (tokens, timestamps) and a readable body that shows the
 *  conversation. Everything is Markdown so Obsidian Sync, Graph View, and
 *  Dataview work for free. No `model`/`provider` field — the plugin is an
 *  ACP client and doesn't know this (Constitution Principle II). */
import type { ActivityItem, ChatMessage, Role } from "../chat/types";

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
  // The prose above is for humans. The canonical record is this one block:
  // `parseSessionNote` reads it back byte-exact, so reopening a session never
  // depends on re-parsing rendered Markdown (which a heading inside an
  // assistant reply would otherwise break).
  lines.push(`<!-- ${TRANSCRIPT_MARKER}: ${base64Encode(JSON.stringify({ v: 1, messages: messages.map(withoutImageData) }))} -->`, "");
  return lines.join("\n");
}

/** Reads the transcript back out of a session note — the canonical block when
 *  the note has one, otherwise a best-effort parse of the rendered prose so
 *  notes written before the canonical block still reopen (and so a
 *  hand-edited note is not silently read as empty). */
export function parseSessionNote(body: string): ChatMessage[] {
  const match = body.match(new RegExp(`<!-- ${TRANSCRIPT_MARKER}: ([A-Za-z0-9+/=]+) -->`));
  if (match) {
    try {
      const parsed = JSON.parse(base64Decode(match[1])) as { messages?: ChatMessage[] };
      if (Array.isArray(parsed.messages)) return parsed.messages;
    } catch {
      // Malformed canonical block — fall through to the prose parser rather
      // than reporting the conversation as empty.
    }
  }
  return parseLegacyNote(body);
}

/** Role headings exactly as `renderBody` writes them. Matching the emoji+word
 *  pair (not a bare `\bAssistant\b` anywhere in an `##` line) is what keeps a
 *  reply that happens to contain `## Assistant behaviour` from being read as
 *  the start of a new message. */
const LEGACY_ROLES: Record<string, Role> = {
  "👤 User": "user",
  "🤖 Assistant": "assistant",
  "🔑 System": "system",
  "🔧 Tool": "tool",
};
const LEGACY_ROLE_RE = /^##\s+(👤 User|🤖 Assistant|🔑 System|🔧 Tool)\s*\(/;
const LEGACY_THOUGHT_RE = /^###\s+🧠\s+Thought(?:\s*\((\d+)s\))?\s*$/;
const LEGACY_ACTIVITY_RE = /^<!-- oc-activity-b64: ([A-Za-z0-9+/=]+) -->$/;

/** Parses the human-readable body. Only a real role heading ends a message —
 *  ordinary `#`/`##`/`###` headings are content, which is what a Markdown
 *  answer is full of. */
function parseLegacyNote(body: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  let role: Role | null = null;
  let buf: string[] = [];
  let reasoning: { text: string; durationSeconds?: number }[] = [];
  let activity: ActivityItem[] | null = null;
  let inThought = false;
  let thoughtDuration: number | undefined;
  let thoughtBuf: string[] = [];

  const flushThought = () => {
    if (!inThought) return;
    const text = thoughtBuf.join("\n").trim();
    if (text) reasoning.push(thoughtDuration !== undefined ? { text, durationSeconds: thoughtDuration } : { text });
    thoughtBuf = [];
    thoughtDuration = undefined;
    inThought = false;
  };

  const flush = () => {
    flushThought();
    const content = buf.join("\n").trim();
    if (role && (content || reasoning.length || activity?.length)) {
      const message: ChatMessage = { role, content };
      if (reasoning.length) message.reasoning = reasoning;
      if (activity?.length) message.activity = activity;
      out.push(message);
    }
    buf = [];
    reasoning = [];
    activity = null;
  };

  for (const line of body.split("\n")) {
    const roleMatch = line.match(LEGACY_ROLE_RE);
    if (roleMatch) {
      flush();
      role = LEGACY_ROLES[roleMatch[1]];
      continue;
    }
    if (role === null) continue; // preamble before the first role heading (the `# Title`)
    const thoughtMatch = line.match(LEGACY_THOUGHT_RE);
    if (thoughtMatch) {
      flushThought();
      inThought = true;
      thoughtDuration = thoughtMatch[1] !== undefined ? Number(thoughtMatch[1]) : undefined;
      continue;
    }
    if (line.trim() === "<!-- end-thoughts -->") {
      flushThought(); // explicit marker — a blank line alone can't end a thought
      continue;
    }
    const activityMatch = line.match(LEGACY_ACTIVITY_RE);
    if (activityMatch) {
      // Decoded where it appears, so a turn that made no tool calls can't be
      // handed the next turn's trail.
      activity = decodeActivity(activityMatch[1]);
      continue;
    }
    if (inThought) thoughtBuf.push(line);
    else buf.push(line);
  }
  flush();
  return out;
}

/** Image bytes never go into the note — they would bloat it by megabytes and
 *  put user content in the vault in a form nothing can read. The attachment's
 *  name and type are kept so a reopened session can still show a placeholder. */
function withoutImageData(message: ChatMessage): ChatMessage {
  if (!message.images?.length) return message;
  return { ...message, images: message.images.map((img) => ({ ...img, dataUrl: "" })) };
}

/** Reads back what `metaToFrontmatter` wrote. `null` when the note has no
 *  frontmatter, so callers can tell "new note" from "created at epoch".
 *  Second precision only — `fmt` does not record milliseconds. */
export function parseSessionMeta(body: string): SessionMeta | null {
  const match = body.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const field = (name: string) => match[1].match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
  const created = parseStamp(field("created"));
  const updated = parseStamp(field("updated"));
  const tokens = Number(field("tokens"));
  if (created === null || updated === null || !Number.isFinite(tokens)) return null;
  return { created, updated, tokens };
}

/** Inverse of `fmt` — local time, matching how it was written. */
function parseStamp(value: string | undefined): number | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m.map(Number) as unknown as number[];
  return new Date(y, mo - 1, d, hh, mm, ss).getTime();
}

const TRANSCRIPT_MARKER = "oc-transcript-b64";

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

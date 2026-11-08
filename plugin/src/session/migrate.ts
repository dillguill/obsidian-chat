/** One-time import of legacy Markdown session notes into the JSONL store
 *  (FR-059 / SC-007, T108).
 *
 *  Read-only toward the vault: the original notes are never modified, moved,
 *  or deleted. The import is idempotent — a note already imported (by
 *  provenance path or the deterministic legacy session id) is skipped, so
 *  running it on every load is safe. Malformed/non-session Markdown files are
 *  skipped and reported, never turned into fabricated conversations.
 */
import { titleFromText } from "../chat/session-title.ts";
import type { NewEntry, SessionStore } from "./store.ts";


export interface LegacyNote {
  /** Vault-relative path, used as provenance and for idempotency. */
  path: string;
  /** Full note text as read from the vault. */
  text: string;
  /** File mtime at import time (ms). */
  mtime: number;
}

export interface SkippedNote {
  path: string;
  reason: string;
}

export interface MigrationReport {
  total: number;
  imported: number;
  alreadyImported: number;
  skipped: SkippedNote[];
  importedSessions: Array<{ path: string; sessionId: string; title: string; messages: number }>;
}

export interface MigrationOptions {
  store: SessionStore;
  notes: LegacyNote[];
  now?: () => number;
  log?: (message: string) => void;
}

export async function importLegacySessions(options: MigrationOptions): Promise<MigrationReport> {
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? (() => undefined);
  const report: MigrationReport = {
    total: options.notes.length,
    imported: 0,
    alreadyImported: 0,
    skipped: [],
    importedSessions: [],
  };

  const existing = await options.store.list().catch((): never[] => []);
  const importedPaths = new Set<string>();
  const existingIds = new Set<string>();
  for (const summary of existing) {
    existingIds.add(summary.header.sessionId);
    const origin = summary.header.provenance?.originPath;
    if (summary.header.origin === "legacy_import" && origin) importedPaths.add(origin);
  }

  for (const note of options.notes) {
    if (importedPaths.has(note.path)) {
      report.alreadyImported += 1;
      continue;
    }
    try {
      const text = note.text;
      const meta = parseSessionMeta(text);
      const messages = parseSessionNote(text);
      if (!messages.length) {
        report.skipped.push({
          path: note.path,
          reason: meta ? "no conversation content" : "not a session note",
        });
        continue;
      }
      const sessionId = `s_legacy_${fnv(note.path)}`;
      if (existingIds.has(sessionId)) {
        report.alreadyImported += 1;
        continue;
      }
      const firstQuestion = messages.find((message) => message.role === "user")?.content ?? "";
      const title = meta?.title?.trim() || titleFromText(firstQuestion || basename(note.path));
      const importedAt = now();
      const createdAt = meta?.created && Number.isFinite(meta.created) ? meta.created : note.mtime || importedAt;
      await options.store.createSession({
        sessionId,
        deviceId: "__local__",
        commandLabel: "legacy note import",
        commandFingerprint: "legacy-note-import",
        cwd: "",
        protocolVersion: 1,
        capabilities: { loadSession: false, resume: false, mcpHttp: false },
        harnessSessionId: null,
        title,
        now: createdAt,
        origin: "legacy_import",
        provenance: {
          originPath: note.path,
          originMtime: note.mtime,
          originHash: fnv(text),
          importedAt,
        },
      });
      const entries = messagesToEntries(messages);
      for (const entry of entries) {
        await options.store.append(sessionId, { ...entry, origin: "legacy_import" } as NewEntry);
      }
      importedPaths.add(note.path);
      existingIds.add(sessionId);
      report.imported += 1;
      report.importedSessions.push({ path: note.path, sessionId, title, messages: messages.length });
      log(`imported legacy conversation ${note.path} (${messages.length} messages)`);
    } catch (err) {
      report.skipped.push({ path: note.path, reason: errorText(err) });
    }
  }
  return report;
}

/** Content signature for folder-free vault discovery: a legacy note either has
 *  the canonical transcript block or the rendered role headings. */
export function looksLikeLegacyConversation(text: string): boolean {
  return /oc-transcript-b64|^##\s+(👤 User|🤖 Assistant|🔑 System|🔧 Tool)\s*\(/m.test(text);
}

/** Rebuilds a legacy conversation for callers that need the original model
 *  (used by the legacy chat view after import and by tests). */
export function legacyMessages(text: string): LegacyMessage[] {
  return parseSessionNote(text);
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1]?.replace(/\.md$/i, "") || path;
}

/** FNV-1a 32-bit hex: stable id/hash without a crypto dependency. */
function fnv(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


/** Legacy message/activity shape (import-only; no writer exists anymore). */
type LegacyRole = "user" | "assistant" | "system" | "tool";

interface SessionMeta {
  created: number;
  updated: number;
  tokens: number;
  title?: string;
}
interface LegacyReasoning {
  text: string;
  durationSeconds?: number;
}
export interface LegacyMessage {
  role: LegacyRole;
  content: string;
  reasoning?: LegacyReasoning[];
  activity?: unknown[];
  images?: unknown[];
}
/** Reads the transcript back out of a session note — the canonical block when
 *  the note has one, otherwise a best-effort parse of the rendered prose so
 *  notes written before the canonical block still reopen (and so a
 *  hand-edited note is not silently read as empty). */
export function parseSessionNote(body: string): LegacyMessage[] {
  const match = body.match(new RegExp(`<!-- ${TRANSCRIPT_MARKER}: ([A-Za-z0-9+/=]+) -->`));
  if (match) {
    try {
      const parsed = JSON.parse(base64Decode(match[1])) as { messages?: LegacyMessage[] };
      if (Array.isArray(parsed.messages)) return parsed.messages;
    } catch {
      // Malformed canonical block — fall through to the prose parser rather
      // than reporting the conversation as empty.
    }
  }
  return parseLegacyNote(body);
}

/** LegacyRole headings exactly as `renderBody` writes them. Matching the emoji+word
 *  pair (not a bare `\bAssistant\b` anywhere in an `##` line) is what keeps a
 *  reply that happens to contain `## Assistant behaviour` from being read as
 *  the start of a new message. */
const LEGACY_ROLES: Record<string, LegacyRole> = {
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
function parseLegacyNote(body: string): LegacyMessage[] {
  const out: LegacyMessage[] = [];
  let role: LegacyRole | null = null;
  let buf: string[] = [];
  let reasoning: { text: string; durationSeconds?: number }[] = [];
  let activity: unknown[] | null = null;
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
      const message: LegacyMessage = { role, content };
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
  const rawTitle = field("title");
  const title = rawTitle ? unquoteYaml(rawTitle) : undefined;
  return title ? { created, updated, tokens, title } : { created, updated, tokens };
}

/** Strips the JSON-style quoting `metaToFrontmatter` writes, and tolerates a
 *  hand-edited plain value. */
function unquoteYaml(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      /* fall through to the raw value */
    }
  }
  return value.replace(/^['"]|['"]$/g, "");
}

/** Inverse of `fmt` — local time, matching how it was written. */
function parseStamp(value: string | undefined): number | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m.map(Number) as unknown as number[];
  return new Date(y, mo - 1, d, hh, mm, ss).getTime();
}

const TRANSCRIPT_MARKER = "oc-transcript-b64";



function base64Decode(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Decodes one stored activity payload; null when absent or malformed. */
function decodeActivity(b64: string): unknown[] | null {
  try {
    const parsed = JSON.parse(base64Decode(b64)) as { items?: unknown[] };
    return Array.isArray(parsed.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

/** Converts imported legacy messages into record entries (prompt/update only;
 *  the legacy presentation layer is gone). */
function messagesToEntries(messages: LegacyMessage[], startTurn = 0): NewEntry[] {
  const out: NewEntry[] = [];
  let turn = startTurn;
  for (const message of messages) {
    if (message.role === "user") {
      turn += 1;
      out.push({ kind: "prompt", turn, blocks: [{ type: "text", text: message.content }], textChars: message.content.length });
      continue;
    }
    if (message.role === "assistant") {
      if (message.reasoning?.length) {
        out.push({
          kind: "update",
          turn: Math.max(turn, 1),
          sessionUpdate: "legacy_thought",
          payload: { type: "thought", text: message.reasoning.map((r) => r.text).join("\n\n") },
        });
      }
      if (message.activity?.length) {
        out.push({
          kind: "update",
          turn: Math.max(turn, 1),
          sessionUpdate: "legacy_activity",
          payload: { type: "raw", sessionUpdate: "legacy_activity", payload: message.activity },
        });
      }
      if (message.content) {
        out.push({
          kind: "update",
          turn: Math.max(turn, 1),
          sessionUpdate: "agent_message_chunk",
          payload: { type: "message", role: "agent", text: message.content },
        });
      }
      continue;
    }
    out.push({
      kind: "update",
      turn: Math.max(turn, 1),
      sessionUpdate: `legacy_${message.role}_message`,
      payload: { type: "raw", sessionUpdate: `legacy_${message.role}_message`, payload: message.content },
    });
  }
  return out;
}

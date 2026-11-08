/** Append-only JSONL conversation store (FR-053…FR-059).
 *
 *  Obsidian-free: the caller injects a `StoreAdapter` (Obsidian's `DataAdapter`
 *  satisfies it). The host is the only writer; the chat UI is the only viewer.
 *  No Markdown notes are written.
 */
import {
  type RecordEntry,
  type RecordLine,
  type SessionHeader,
  isEntry,
  isHeader,
  parseLine,
  serializeEntry,
} from "./record.ts";

export interface StoreAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove?(path: string): Promise<void>;
}

export interface SessionSummary {
  sessionId: string;
  header: SessionHeader;
  path: string;
  degraded: boolean;
  /** Record size in bytes (for the 50 MiB warning). */
  bytes: number;
}

export interface SessionRead {
  header: SessionHeader;
  entries: RecordEntry[];
  /** True when the file ended in a partial (no newline) line. */
  degradedTail: boolean;
  malformedLines: number;
  /** Serialized record size in bytes. */
  bytes: number;
}

export interface CreateSessionInput {
  deviceId: string;
  commandLabel: string;
  commandFingerprint: string;
  cwd: string;
  protocolVersion: number;
  capabilities: SessionHeader["harness"]["capabilities"];
  harnessSessionId?: string | null;
  title?: string;
  agentName?: string;
  agentVersion?: string;
  origin?: "live" | "legacy_import";
  provenance?: SessionHeader["provenance"];
  now?: number;
  sessionId?: string;
}

export const DEFAULT_SESSION_STORE = ".chat/sessions";

/** An entry as supplied by a caller: the store assigns seq/ts/format version. */
export type NewEntry = {
  [K in RecordEntry["kind"]]: Omit<Extract<RecordEntry, { kind: K }>, "seq" | "ts" | "v">;
}[RecordEntry["kind"]];

function join(root: string, name: string): string {
  return `${root.replace(/\/+$/, "")}/${name}`;
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint8Array(12);
    c.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export class SessionStore {
  private seq = new Map<string, number>();
  private chains = new Map<string, Promise<unknown>>();
  private needsSeparator = new Set<string>();

  private adapter: StoreAdapter;
  private root: string;
  private now: () => number;

  constructor(adapter: StoreAdapter, root = DEFAULT_SESSION_STORE, now: () => number = () => Date.now()) {
    this.adapter = adapter;
    this.root = root;
    this.now = now;
  }

  private recordPath(sessionId: string): string {
    return join(this.root, `${sessionId}.jsonl`);
  }

  private async ensureRoot(): Promise<void> {
    if (await this.adapter.exists(this.root)) return;
    const parts = this.root.split("/").filter(Boolean);
    let built = "";
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      if (!(await this.adapter.exists(built))) await this.adapter.mkdir(built);
    }
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    await this.ensureRoot();
    const sessionId = input.sessionId ?? `s_${randomId()}`;
    const now = input.now ?? this.now();
    const header: SessionHeader = {
      kind: "header",
      v: 1,
      sessionId,
      deviceId: input.deviceId,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      lastSeq: 0,
      harness: {
        commandLabel: input.commandLabel,
        commandFingerprint: input.commandFingerprint,
        cwd: input.cwd,
        protocolVersion: input.protocolVersion,
        agentName: input.agentName,
        agentVersion: input.agentVersion,
        capabilities: input.capabilities,
      },
      harnessSessionId: input.harnessSessionId ?? null,
      resume: { state: "fresh-only" },
      origin: input.origin ?? "live",
      provenance: input.provenance,
    };
    await this.adapter.write(this.recordPath(sessionId), `${JSON.stringify(header)}\n`);
    this.seq.set(sessionId, 0);
    return sessionId;
  }

  /** Appends one entry, assigning its sequence and timestamp. Serialized per
   *  session so two appends can never interleave. */
  async append(sessionId: string, entry: NewEntry): Promise<RecordEntry> {
    const run = async (): Promise<RecordEntry> => {
      const next = (this.seq.get(sessionId) ?? 0) + 1;
      const full = {
        ...entry,
        seq: next,
        ts: this.now(),
        v: 1,
      } as RecordEntry;
      const { line, entry: stored } = serializeEntry(full);
      if (this.needsSeparator.has(sessionId)) {
        await this.adapter.append(this.recordPath(sessionId), "\n");
        this.needsSeparator.delete(sessionId);
      }
      await this.adapter.append(this.recordPath(sessionId), `${line}\n`);
      this.seq.set(sessionId, next);
      return stored;
    };
    const prev = this.chains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.chains.set(sessionId, next.catch(() => undefined));
    return next;
  }

  async read(sessionId: string): Promise<SessionRead> {
    const path = this.recordPath(sessionId);
    if (!(await this.adapter.exists(path))) throw new Error(`unknown session: ${sessionId}`);
    const text = await this.adapter.read(path);
    return this.parseRecord(sessionId, text);
  }

  private parseRecord(sessionId: string, text: string): SessionRead {
    const lines = text.split("\n");
    const trailingPartial = lines.length > 0 && lines[lines.length - 1].length > 0 && !text.endsWith("\n");
    let header: SessionHeader | null = null;
    const entries: RecordEntry[] = [];
    let malformedLines = 0;
    let lastSeq = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const parsed: RecordLine | null = parseLine(line);
      if (!parsed) {
        if (i === lines.length - 1 && trailingPartial) continue;
        malformedLines += 1;
        continue;
      }
      if (isHeader(parsed)) {
        if (i === 0) header = parsed;
        continue;
      }
      if (!isEntry(parsed)) {
        malformedLines += 1;
        continue;
      }
      entries.push(parsed);
      lastSeq = Math.max(lastSeq, parsed.seq);
    }
    if (!header) throw new Error(`session record has no valid header: ${sessionId}`);
    if (entries.length) this.seq.set(sessionId, lastSeq);
    if (trailingPartial) this.needsSeparator.add(sessionId);
    return { header, entries, degradedTail: trailingPartial, malformedLines, bytes: new TextEncoder().encode(text).length };
  }

  async list(): Promise<SessionSummary[]> {
    if (!(await this.adapter.exists(this.root))) return [];
    const listing = await this.adapter.list(this.root);
    const out: SessionSummary[] = [];
    for (const raw of listing.files) {
      // Obsidian's DataAdapter.list returns full vault-relative paths (while
      // simple adapters/tests may return bare names). Normalize so a real
      // vault never loses every record to a prefix.
      const name = raw.replace(/\\/g, "/").split("/").pop() ?? "";
      if (!name.endsWith(".jsonl")) continue;
      const sessionId = name.slice(0, -".jsonl".length);
      try {
        const read = await this.read(sessionId);
        out.push({
          sessionId,
          header: read.header,
          path: join(this.root, name),
          degraded: read.degradedTail || read.malformedLines > 0,
          bytes: read.bytes,
        });
      } catch {
        // Unreadable record: skip it rather than fabricating a session.
      }
    }
    return out.sort((a, b) => b.header.updatedAt - a.header.updatedAt);
  }

  async delete(sessionId: string): Promise<void> {
    if (!this.adapter.remove) throw new Error("adapter does not support remove");
    await this.adapter.remove(this.recordPath(sessionId));
    this.seq.delete(sessionId);
    this.needsSeparator.delete(sessionId);
  }

  async lastSeq(sessionId: string): Promise<number> {
    if (this.seq.has(sessionId)) return this.seq.get(sessionId)!;
    const read = await this.read(sessionId);
    return read.entries.reduce((max, e) => Math.max(max, e.seq), read.header.lastSeq);
  }

  /** Appends a `meta` entry when the harness (or user) changes the title. */
  async setTitle(sessionId: string, title: string): Promise<void> {
    await this.append(sessionId, { kind: "meta", title });
  }
}

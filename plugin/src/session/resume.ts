/** Continuity ladder + host registry (FR-060…FR-065).
 *
 *  The ladder is mandatory: resume → load → explicit digest/fresh. A stored
 *  session is never silently replaced by a new one. Resume is refused (and the
 *  user offered digest/fresh) when the harness command/cwd/protocol identity
 *  changed; an agent name/version change is only a warning.
 */
import type { StoreAdapter, SessionSummary } from "./store.ts";
import type { ResumeStateName } from "./record.ts";
import { fingerprint, normalizeCwd } from "../shell/identity.ts";

export type ContinuityAction = "resume" | "load" | "digest" | "fresh";

export interface StoredContinuity {
  harnessSessionId: string | null;
  cwd: string;
  commandFingerprint: string;
  protocolVersion: number;
  agentName?: string;
  agentVersion?: string;
}

export interface CurrentHarness {
  command: string;
  cwd: string;
  protocolVersion: number;
  agentName?: string;
  agentVersion?: string;
  resume: boolean;
  loadSession: boolean;
}

export interface RecordContinuity {
  readable: boolean;
  hasContent: boolean;
  imported: boolean;
}

export interface ResumeDecision {
  state: ResumeStateName;
  action: ContinuityAction;
  reason?: string;
  warning?: string;
  digestAvailable: boolean;
}

export function decideContinuity(
  stored: StoredContinuity,
  current: CurrentHarness | null,
  record: RecordContinuity,
): ResumeDecision {
  if (!record.readable) return { state: "fresh-only", action: "fresh", reason: "record_unreadable", digestAvailable: false };
  const digestAvailable = record.hasContent;
  if (!record.hasContent) return { state: "fresh-only", action: "fresh", reason: "no_content", digestAvailable: false };
  if (record.imported || !stored.harnessSessionId) {
    return { state: "digest-only", action: "digest", reason: "no_harness_session", digestAvailable };
  }
  if (!current) return { state: "digest-only", action: "digest", reason: "harness_unreachable", digestAvailable };
  if (normalizeCwd(stored.cwd) !== normalizeCwd(current.cwd)) {
    return { state: "digest-only", action: "digest", reason: "cwd_mismatch", digestAvailable };
  }
  if (stored.protocolVersion !== current.protocolVersion) {
    return { state: "digest-only", action: "digest", reason: "protocol_mismatch", digestAvailable };
  }
  // A changed command line (a moved binary, a wrapper script) no longer blocks
  // reattaching: the host tries resume/load and falls back to the digest if
  // the harness doesn't know the session. Only cwd/protocol changes are hard.
  const commandChanged = stored.commandFingerprint !== fingerprint(current.command, current.cwd);
  const warning = commandChanged ? "harness_changed" : agentChanged(stored, current) ? "harness_updated" : undefined;
  if (current.resume) return { state: "resume-capable", action: "resume", warning, digestAvailable };
  if (current.loadSession) return { state: "load-only", action: "load", warning, digestAvailable };
  return { state: "digest-only", action: "digest", reason: "no_capability", warning, digestAvailable };
}

function agentChanged(stored: StoredContinuity, current: CurrentHarness): boolean {
  if (stored.agentName && current.agentName && stored.agentName !== current.agentName) return true;
  if (stored.agentVersion && current.agentVersion && stored.agentVersion !== current.agentVersion) return true;
  return false;
}

export function isResumableState(state: ResumeStateName): boolean {
  return state === "resume-capable" || state === "load-only";
}

/** ACP `_meta` keys used on load/prompt (standard extensibility, no new method). */
export function continuityMeta(decision: ResumeDecision): Record<string, unknown> {
  return {
    "obsidian-chat/resume": decision.state,
    ...(decision.reason ? { "obsidian-chat/reason": decision.reason } : {}),
    ...(decision.warning ? { "obsidian-chat/warning": decision.warning } : {}),
    "obsidian-chat/digest": decision.digestAvailable,
  };
}

// ---------- host registry ----------

export type RegistryState = "live" | "detached" | "dead";

export interface RegistryRow {
  sessionId: string;
  harnessSessionId: string | null;
  deviceId: string;
  cwd: string;
  commandFingerprint: string;
  protocolVersion: number;
  lastSeq: number;
  state: RegistryState;
  lastSeen: number;
}

export interface ReconciledRegistry {
  dropped: string[];
  adopted: string[];
}

/** Host-only `registry.json` used to reattach after an Obsidian reload or a
 *  harness respawn. No tokens, no file content. Writes are debounced (≤1 s). */
export class ResumeRegistry {
  private adapter: StoreAdapter;
  private path: string;
  private now: () => number;
  private rows = new Map<string, RegistryRow>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private loaded = false;

  constructor(adapter: StoreAdapter, storeFolder = ".chat/sessions", now: () => number = () => Date.now()) {
    this.adapter = adapter;
    this.path = `${storeFolder.replace(/\/+$/, "")}/registry.json`;
    this.now = now;
  }

  get filePath(): string {
    return this.path;
  }

  async load(): Promise<Map<string, RegistryRow>> {
    if (this.loaded) return this.rows;
    this.loaded = true;
    try {
      if (await this.adapter.exists(this.path)) {
        const parsed = JSON.parse(await this.adapter.read(this.path)) as { sessions?: Record<string, RegistryRow> };
        for (const [sessionId, row] of Object.entries(parsed.sessions ?? {})) {
          if (row && typeof row.sessionId === "string") this.rows.set(sessionId, row);
        }
      }
    } catch {
      // A corrupt registry is ignored: the record headers are authoritative.
    }
    return this.rows;
  }

  all(): RegistryRow[] {
    return [...this.rows.values()];
  }

  get(sessionId: string): RegistryRow | undefined {
    return this.rows.get(sessionId);
  }

  upsert(row: RegistryRow): void {
    this.rows.set(row.sessionId, row);
    this.scheduleSave();
  }

  mark(sessionId: string, state: RegistryState): void {
    const row = this.rows.get(sessionId);
    if (!row) return;
    row.state = state;
    row.lastSeen = this.now();
    this.scheduleSave();
  }

  touch(sessionId: string, lastSeq?: number): void {
    const row = this.rows.get(sessionId);
    if (!row) return;
    if (lastSeq !== undefined) row.lastSeq = lastSeq;
    row.lastSeen = this.now();
    this.scheduleSave();
  }

  remove(sessionId: string): void {
    this.rows.delete(sessionId);
    this.scheduleSave();
  }

  /** Records win: drop rows with no record, adopt records without a row as
   *  `dead` (they existed before the registry did). */
  reconcile(records: SessionSummary[]): ReconciledRegistry {
    const dropped: string[] = [];
    const adopted: string[] = [];
    const byId = new Map(records.map((record) => [record.header.sessionId, record]));
    for (const sessionId of [...this.rows.keys()]) {
      if (!byId.has(sessionId)) {
        this.rows.delete(sessionId);
        dropped.push(sessionId);
      }
    }
    for (const record of records) {
      const header = record.header;
      if (this.rows.has(header.sessionId)) continue;
      this.rows.set(header.sessionId, {
        sessionId: header.sessionId,
        harnessSessionId: header.harnessSessionId,
        deviceId: header.deviceId,
        cwd: header.harness.cwd,
        commandFingerprint: header.harness.commandFingerprint,
        protocolVersion: header.harness.protocolVersion,
        lastSeq: header.lastSeq,
        state: "dead",
        lastSeen: header.updatedAt,
      });
      adopted.push(header.sessionId);
    }
    this.scheduleSave();
    return { dropped, adopted };
  }

  scheduleSave(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 500);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const sessions: Record<string, RegistryRow> = {};
    for (const sessionId of [...this.rows.keys()].sort()) sessions[sessionId] = this.rows.get(sessionId)!;
    try {
      await this.adapter.write(this.path, JSON.stringify({ v: 1, sessions }, null, 2));
    } catch {
      // Registry writes are best-effort; the records remain authoritative.
    }
  }
}

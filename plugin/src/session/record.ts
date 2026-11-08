/** Host-owned conversation record types (FR-053…FR-059).
 *
 *  The record is append-only JSONL: one header line, then one entry line per
 *  prompt / ACP update / permission / turn boundary / resume event / error /
 *  meta. The internal turn-boundary kind is `turn` — never `turn_end` (the
 *  deleted SSE envelope name).
 */
import type { StopReason } from "@agentclientprotocol/sdk";

import { MAX_ENTRY_BYTES } from "./limits.ts";

export const RECORD_VERSION = 1;
export { MAX_ENTRY_BYTES };

/** Strips secret-bearing binary payloads before an entry is stored (FR-058):
 *  image/audio bytes are recorded by type/name only, never by content. */
export function sanitizeForRecord<T>(value: T): T {
  return sanitize(value) as T;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const type = record.type;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if ((type === "image" || type === "audio") && key === "data") {
      out.data = "";
      continue;
    }
    if (key === "headers" && Array.isArray(entry)) {
      // MCP/ACP auth headers never belong in a conversation record.
      out.headers = entry.map((header) => {
        const item = header as { name?: unknown; value?: unknown };
        return item && typeof item.name === "string" && /authorization|token/i.test(item.name)
          ? { ...item, value: "***" }
          : sanitize(header);
      });
      continue;
    }
    out[key] = sanitize(entry);
  }
  return out;
}

export type RecordKind =
  | "header"
  | "prompt"
  | "update"
  | "permission_request"
  | "permission_response"
  | "turn"
  | "resume"
  | "meta"
  | "error";

export interface HarnessCapabilitiesSnapshot {
  loadSession: boolean;
  resume: boolean;
  mcpHttp: boolean;
}

export interface SessionHeader {
  kind: "header";
  v: 1;
  sessionId: string;
  deviceId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  lastSeq: number;
  harness: {
    /** Redacted display form only; the full command lives in settings. */
    commandLabel: string;
    commandFingerprint: string;
    cwd: string;
    protocolVersion: number;
    agentName?: string;
    agentVersion?: string;
    capabilities: HarnessCapabilitiesSnapshot;
  };
  harnessSessionId: string | null;
  resume: { state: ResumeStateName; reason?: string };
  modes?: unknown;
  config?: Record<string, unknown>;
  origin?: "live" | "legacy_import";
  provenance?: { originPath: string; originMtime: number; originHash: string; importedAt: number };
}

export type ResumeStateName = "resume-capable" | "load-only" | "digest-only" | "fresh-only";

export interface BaseEntry {
  seq: number;
  ts: number;
  v: 1;
  kind: RecordKind;
  turn?: number;
  origin?: "live" | "legacy_import";
  truncated?: { flag: true; originalBytes: number };
}

export interface PromptEntry extends BaseEntry {
  kind: "prompt";
  turn: number;
  blocks: unknown[];
  textChars?: number;
}

export interface UpdateEntry extends BaseEntry {
  kind: "update";
  turn: number;
  sessionUpdate: string;
  payload: unknown;
  late?: boolean;
  truncated?: { flag: true; originalBytes: number };
}

export interface PermissionRequestEntry extends BaseEntry {
  kind: "permission_request";
  turn: number;
  requestId: string;
  toolCall: unknown;
  options: unknown[];
}

export interface PermissionResponseEntry extends BaseEntry {
  kind: "permission_response";
  requestId: string;
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
  reason?: string;
}

export interface TurnEntry extends BaseEntry {
  kind: "turn";
  turn: number;
  stopReason?: StopReason | string;
  interrupted?: boolean;
  errorCategory?: string;
}

export interface ResumeEntry extends BaseEntry {
  kind: "resume";
  method: "resume" | "load" | "digest" | "fresh" | "full_replay";
  result: "success" | "failed" | "chosen" | "skipped";
  reason?: string;
  harnessSessionId?: string | null;
  fingerprint?: string;
  cwd?: string;
  replay?: { replayed: number; deduped: number; ephemeral: number; gaps: number };
  digest?: { turnsIncluded: number; turnsOmitted: number; chars: number; hash: string };
}

export interface MetaEntry extends BaseEntry {
  kind: "meta";
  title?: string;
  /** "user" for an explicit rename; a user name beats harness titles. */
  source?: "user" | "harness";
  updatedAt?: string | null;
}

export interface ErrorEntry extends BaseEntry {
  kind: "error";
  scope: "harness" | "transport" | "store" | "mcp" | "device" | "policy" | "config";
  message: string;
  code?: string;
  retryable?: boolean;
}

export type RecordEntry =
  | PromptEntry
  | UpdateEntry
  | PermissionRequestEntry
  | PermissionResponseEntry
  | TurnEntry
  | ResumeEntry
  | MetaEntry
  | ErrorEntry;

export type RecordLine = SessionHeader | RecordEntry;

export function isHeader(value: unknown): value is SessionHeader {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SessionHeader>;
  return v.kind === "header" && v.v === 1 && typeof v.sessionId === "string" && typeof v.deviceId === "string";
}

export function isEntry(value: unknown): value is RecordEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<RecordEntry>;
  return typeof v.seq === "number" && typeof v.kind === "string" && typeof v.ts === "number";
}

/** Serializes one entry, bounding oversized payloads instead of dropping them.
 *  Truncation is explicit and reported (FR-050; store contract §8). */
export function serializeEntry(entry: RecordEntry): { line: string; entry: RecordEntry } {
  const enc = new TextEncoder();
  let line = JSON.stringify({ ...entry, v: 1 });
  const bytes = (s: string) => enc.encode(s).length;
  if (bytes(line) <= MAX_ENTRY_BYTES) return { line, entry };
  const originalBytes = bytes(line);
  const trimmed: RecordEntry = { ...entry, truncated: { flag: true, originalBytes } };
  const payload = (trimmed as unknown as { payload?: unknown }).payload;
  if (payload !== undefined) {
    (trimmed as unknown as { payload: unknown }).payload = {
      truncated: true,
      originalBytes,
      note: "payload exceeded the record bound; see the raw view for the truncation marker",
    };
  }
  const toolCall = (trimmed as unknown as { toolCall?: unknown }).toolCall;
  if (toolCall !== undefined) {
    (trimmed as unknown as { toolCall: unknown }).toolCall = { truncated: true, originalBytes };
  }
  line = JSON.stringify(trimmed);
  return { line, entry: trimmed };
}

/** Parses one JSONL line; returns null for malformed/partial lines. */
export function parseLine(line: string): RecordLine | null {
  const text = line.trim();
  if (!text) return null;
  try {
    const value = JSON.parse(text) as RecordLine;
    return isHeader(value) || isEntry(value) ? value : null;
  } catch {
    return null;
  }
}

export function harnessCapabilities(input: {
  loadSession?: boolean;
  resume?: boolean;
  mcpHttp?: boolean;
}): HarnessCapabilitiesSnapshot {
  return { loadSession: !!input.loadSession, resume: !!input.resume, mcpHttp: !!input.mcpHttp };
}

/** Shared chat-core types. This module must stay `obsidian`-free so it can be
 *  used by both `chat/` and `ui/` without a layering violation. */

export type Role = "system" | "user" | "assistant" | "tool";

/** ACP `ToolCallStatus` (specs/003-workspace-parity W1). */
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

/** One ACP `PlanEntry` (W4.1). */
export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/** ACP `UsageUpdate` payload (W4.2). */
export interface UsageInfo {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

/** One tool call, live in the transcript and persisted into the session note
 *  (W1.2/W7.4). Plain data — `chat/` stays obsidian-free so `session/store.ts`
 *  can serialise it. */
export interface ActivityItem {
  /** ACP toolCallId — the stable key while streaming. */
  id: string;
  /** Raw harness tool name, e.g. `vault_vault_read` (ACP `title`). */
  rawName: string;
  /** Cleaned name, e.g. `read` (activity.ts `cleanToolName`). */
  name: string;
  /** Display verb for the row, e.g. "Read" (already tense-adjusted). */
  verb: string;
  /** Display target: basename for file targets, truncated query/command otherwise. */
  label: string;
  /** Raw target string from the tool input (path/query/command) — used for
   *  tooltips and vault resolution. */
  target?: string;
  /** True when `target` looks like a file path (drives basename + clickability). */
  isPath: boolean;
  kind?: string;
  status: ToolStatus;
  /** Bounded copy of the tool's `rawInput` (strings ≤300 chars, ≤20 keys) —
   *  merged across updates since ACP sends only changed fields. */
  input?: Record<string, unknown>;
  diff?: { add: number; del: number };
  startedAt: number;
  durationSeconds?: number;
}

/** An attached image for multimodal providers (vision). `dataUrl` is a full
 *  `data:` URI ("data:image/png;base64,…"). Added verbatim to the wire format. */
export interface ImageAttachment {
  dataUrl: string;
  mediaType: string; // e.g. "image/png"
  name?: string; // display name / alt text
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Multimodal attachments on a user message (vision). Empty/undefined = text-only. */
  images?: ImageAttachment[];
  /** Reasoning bursts that preceded this assistant message's final content
   *  (specs/002-acp-only-chat-ux User Story 4 / data-model.md Reasoning
   *  Block) — persisted so a reopened session still shows them, collapsed
   *  (FR-010). Each entry is one contiguous burst, in order. */
  reasoning?: { text: string; durationSeconds?: number }[];
  /** Tool calls this assistant turn made, in order — persisted so a reopened
   *  session reproduces the collapsed activity trail (W7.4). */
  activity?: ActivityItem[];
}

/** Streaming events the UI subscribes to, sourced from ACP `session/update`
 *  (see acp/client.ts's mapSessionUpdate). */
export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool_call";
      toolCallId: string;
      /** Raw harness tool name (ACP `title`), e.g. `vault_vault_read`.
       *  Undefined on updates that don't carry it (ACP sends only changed
       *  fields) — the UI keeps the previously-seen name. */
      name?: string;
      /** ACP `ToolKind`. opencode reports `other` for MCP tools (P0 probe),
       *  so this is a fallback only — never the primary icon/verb source. */
      kind?: string;
      status: ToolStatus;
      /** Diff lines — attached only for edit-shaped payloads (a `Diff` content
       *  variant); reads carry a ~20 KB JSON blob that must not be retained. */
      contentLines?: string[];
      /** Bounded, sanitised copy of the tool's `rawInput` (strings ≤300 chars,
       *  ≤20 keys) so the UI can derive path/query/command. */
      rawInput?: Record<string, unknown>;
      /** Raw target string parsed from `rawInput` (path/query/command), when known. */
      target?: string;
    }
  | { type: "plan"; entries: PlanEntry[] }
  | ({ type: "usage" } & UsageInfo)
  | { type: "session_info"; title?: string | null; updatedAt?: string | null }
  | { type: "done"; finishReason?: string }
  | { type: "error"; message: string };

/** For grounding, the plugin assembles `@mention` context by reading notes. */
export interface RetrievedNote {
  /** vault-relative path, e.g. `Inbox/foo.md` */
  rel: string;
  score: number;
  snippet: string;
}

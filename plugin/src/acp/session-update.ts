/** Pure ACP `session/update` → render-model mapping.
 *
 *  Total over the SDK's `SessionUpdate` union: every kind either has a
 *  dedicated render update or is surfaced as a `raw` update with its kind and
 *  payload. Nothing is dropped (FR-043), and nothing is translated through a
 *  tool-name vocabulary (FR-044/FR-049).
 *
 *  Mode/config/command/session-info notifications are also state changes; the
 *  client applies them to its declared-control state and emits the dedicated
 *  render updates below (they are not transcript prose).
 */
import type { SessionUpdate, ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { PlanEntryView, RenderUpdate, ToolCallLocationView, ToolContentView } from "./types.ts";
import { toolContentView } from "./types.ts";

function textOfContent(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as { type?: string; text?: unknown };
  return c.type === "text" && typeof c.text === "string" ? c.text : "";
}

function locationsOf(tc: ToolCall | ToolCallUpdate): ToolCallLocationView[] | undefined {
  const locs = (tc as { locations?: Array<{ path?: unknown; line?: unknown } | null> | null }).locations;
  if (!Array.isArray(locs) || !locs.length) return undefined;
  return locs
    .filter((l): l is { path: string; line?: number } => !!l && typeof l.path === "string")
    .map((l) => (typeof l.line === "number" ? { path: l.path, line: l.line } : { path: l.path }));
}

function contentOf(tc: ToolCall | ToolCallUpdate): ToolContentView[] | undefined {
  const raw = (tc as { content?: unknown[] | null }).content;
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out: ToolContentView[] = [];
  for (const item of raw) {
    const view = toolContentView(item as never);
    if (view) out.push(view);
  }
  return out.length ? out : undefined;
}

function toolCallOf(tc: ToolCall | ToolCallUpdate): RenderUpdate {
  const t = tc as ToolCall;
  return {
    type: "tool_call",
    toolCall: {
      toolCallId: t.toolCallId,
      title: typeof t.title === "string" ? t.title : undefined,
      name: typeof (t as { name?: unknown }).name === "string" ? (t as { name: string }).name : undefined,
      kind: t.kind ?? undefined,
      status: t.status ?? undefined,
      content: contentOf(tc),
      locations: locationsOf(tc),
      rawInput: (t as { rawInput?: unknown }).rawInput,
      rawOutput: (t as { rawOutput?: unknown }).rawOutput,
    },
  };
}

function planEntriesOf(update: { entries?: unknown }): PlanEntryView[] {
  const entries = (update as { entries?: Array<Record<string, unknown>> }).entries;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && typeof e.content === "string")
    .map((e) => ({
      content: String(e.content),
      priority: e.priority === "high" || e.priority === "medium" || e.priority === "low" ? e.priority : "medium",
      status: e.status === "completed" || e.status === "in_progress" ? e.status : "pending",
    }));
}

/**
 * Maps one `SessionUpdate`. Returns `null` only for the three state-only kinds
 * whose data has no transcript representation (`current_mode_update`,
 * `config_option_update`, `available_commands_update`); the client applies
 * those to its declared-control state and emits state changes instead.
 */
export function mapSessionUpdate(update: SessionUpdate): RenderUpdate | null {
  const kind = (update as { sessionUpdate?: string }).sessionUpdate ?? "unknown";
  switch (kind) {
    case "user_message_chunk":
      return { type: "message", role: "user", text: textOfContent((update as { content?: unknown }).content) };
    case "agent_message_chunk":
      return { type: "message", role: "agent", text: textOfContent((update as { content?: unknown }).content) };
    case "agent_thought_chunk":
      return { type: "thought", text: textOfContent((update as { content?: unknown }).content) };
    case "tool_call":
    case "tool_call_update":
      return toolCallOf(update as unknown as ToolCall | ToolCallUpdate);
    case "plan":
    case "plan_update":
      return { type: "plan", entries: planEntriesOf(update as { entries?: unknown }) };
    case "plan_removed":
      return { type: "plan_removed" };
    case "usage_update": {
      const u = update as { used?: unknown; size?: unknown; cost?: { amount: number; currency: string } };
      return {
        type: "usage",
        usage: {
          used: typeof u.used === "number" ? u.used : 0,
          size: typeof u.size === "number" ? u.size : 0,
          cost: u.cost,
        },
      };
    }
    case "session_info_update": {
      const s = update as { title?: string | null; updatedAt?: string | null };
      return { type: "session_info", title: s.title ?? null, updatedAt: s.updatedAt ?? null };
    }
    case "current_mode_update":
    case "config_option_update":
    case "available_commands_update":
      // Applied to declared-control state by the client; no transcript body.
      return null;
    default: {
      // Some harnesses use newer/renamed chunk kinds. If the update still
      // carries ACP text content, render it as the corresponding text chunk
      // instead of flooding the transcript with raw rows (the raw record keeps
      // the exact payload either way).
      const text = textOfContent((update as { content?: unknown }).content);
      if (text) {
        if (/thought|reason/i.test(kind)) return { type: "thought", text };
        if (/user/i.test(kind)) return { type: "message", role: "user", text };
        if (/message|chunk|assistant|agent|output/i.test(kind)) return { type: "message", role: "agent", text };
      }
      // plan_removed is handled above; compaction_*, future/unstable kinds and
      // anything newer than this SDK are surfaced raw, never dropped.
      return { type: "raw", sessionUpdate: kind, payload: update };
    }
  }
}

/** Applies a partial tool-call update to an existing view (ACP sends only
 *  changed fields). Returns a new object; never mutates the input. */
export function mergeToolCall(prev: import("./types").ToolCallView | undefined, next: import("./types").ToolCallView): import("./types").ToolCallView {
  if (!prev) return next;
  const merged: import("./types").ToolCallView = { ...prev };
  if (next.title !== undefined) merged.title = next.title;
  if (next.name !== undefined) merged.name = next.name;
  if (next.kind !== undefined) merged.kind = next.kind;
  if (next.status !== undefined) merged.status = next.status;
  if (next.content !== undefined) merged.content = next.content;
  if (next.locations !== undefined) merged.locations = next.locations;
  if (next.rawInput !== undefined) merged.rawInput = next.rawInput;
  if (next.rawOutput !== undefined) merged.rawOutput = next.rawOutput;
  merged.late = next.late ?? prev.late;
  return merged;
}

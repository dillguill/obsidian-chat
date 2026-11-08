/** Transport-agnostic ACP client seam and the render model the UI consumes.
 *
 *  This module is deliberately Obsidian-free and transport-free: both the
 *  in-process shell client and (during migration) any legacy client implement
 *  `AcpChatClient`, and the UI depends only on these types (FR-027).
 *
 *  The render model carries ACP's own data. It contains no tool-name
 *  dictionary, no verb mapping, and no invented labels (FR-043…FR-049).
 */
import type {
  AvailableCommand,
  ContentBlock,
  SessionConfigOption,
  SessionModeState,
  StopReason,
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
} from "@agentclientprotocol/sdk";

export type AcpConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "unreachable" | "closed";

export type AttachMode = "local" | "remote" | "relay";

/** One ACP tool-call content variant, kept as data (never flattened away). */
export type ToolContentView =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText?: string; newText: string }
  | { type: "terminal"; terminalId: string }
  | { type: "image"; mimeType: string; data?: string; uri?: string }
  | { type: "audio"; mimeType: string; data?: string; uri?: string }
  | { type: "resource_link"; uri: string; name?: string; title?: string; mimeType?: string }
  | { type: "resource"; uri: string; name?: string; text?: string }
  | { type: "unknown"; raw: unknown };

export interface ToolCallLocationView {
  /** Absolute path as the harness reported it; the UI resolves it to a note. */
  path: string;
  line?: number;
}

/** One tool call, merged from `tool_call` + `tool_call_update` notifications. */
export interface ToolCallView {
  toolCallId: string;
  /** ACP requires a title; keep it verbatim (FR-044). Optional only because
   *  `tool_call_update` carries partial updates that are merged by the UI. */
  title?: string;
  /** Programmatic name when the harness supplies it (fallback label only). */
  name?: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolContentView[];
  locations?: ToolCallLocationView[];
  rawInput?: unknown;
  rawOutput?: unknown;
  /** True when this update arrived after the turn's prompt resolved. */
  late?: boolean;
}

export interface PlanEntryView {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export interface UsageView {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

/** One rendered ACP protocol update. `raw` carries unknown/unstable kinds. */
export type RenderUpdate =
  | { type: "message"; role: "user" | "agent"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool_call"; toolCall: ToolCallView }
  | { type: "plan"; entries: PlanEntryView[] }
  | { type: "plan_removed" }
  | { type: "usage"; usage: UsageView }
  | { type: "session_info"; title?: string | null; updatedAt?: string | null }
  | { type: "mode"; modes: SessionModeState }
  | { type: "config"; options: SessionConfigOption[] }
  | { type: "commands"; commands: AvailableCommand[] }
  | { type: "raw"; sessionUpdate: string; payload: unknown };

export interface ChatEvent {
  /** The ACP session id this event belongs to. */
  sessionId: string;
  /** Monotonic per-session sequence assigned by the store when known. */
  seq?: number;
  /** Turn number this update belongs to (when known). */
  turnNumber?: number;
  /** True for an update that arrived after its turn's prompt resolved. */
  late?: boolean;
  update?: RenderUpdate;
  /** Raw ACP notification for the raw views (unmapped, never dropped). */
  raw?: { sessionUpdate: string; payload: unknown; seq?: number; late?: boolean; replay?: boolean };
  /** A turn boundary; the prompt's resolution is the only terminator. */
  turn?: { number: number; stopReason?: StopReason | string; interrupted?: boolean };
  /** A visible error (transport, store, MCP unavailable, …). */
  error?: { message: string; scope?: string };
}

export interface PermissionOptionView {
  optionId: string;
  name: string;
  /** ACP's `allow_once | allow_always | reject_once | reject_always`. */
  kind: string;
}

export interface PendingPermission {
  requestId: string;
  sessionId: string;
  toolCall: ToolCallView;
  options: PermissionOptionView[];
}

export interface AcpDebugInfo {
  state: AcpConnectionState;
  mode: AttachMode;
  label: string;
  sessionId: string | null;
  retries: number;
  lastError: string | null;
}

export interface PromptHandle {
  /** Resolves with the harness's stop reason when `session/prompt` resolves. */
  done: Promise<StopReason | string>;
}

/** The interface every shell client implements and the UI consumes. */
export interface AcpChatClient {
  connect(): Promise<void>;
  prompt(blocks: ContentBlock[]): Promise<StopReason | string>;
  cancel(): Promise<void>;
  respondPermission(requestId: string, optionId: string | null): Promise<void>;
  setMode(modeId: string): Promise<void>;
  setConfigOption(configId: string, value: string | boolean): Promise<void>;
  close(): Promise<void>;

  onEvent(cb: (event: ChatEvent) => void): () => void;
  onPermissionRequest(cb: (request: PendingPermission) => void): () => void;
  onStateChange(cb: () => void): () => void;

  getSessionId(): string | null;
  getModes(): SessionModeState | null;
  getConfigOptions(): SessionConfigOption[] | null;
  getCommands(): AvailableCommand[] | null;
  getState(): AcpConnectionState;
  getDebugInfo(): AcpDebugInfo;
}

/** Normalizes ACP's tool content variants into the render model. */
export function toolContentView(raw: ToolCallContent | undefined): ToolContentView | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { type?: string }).type;
  if (kind === "diff") {
    const d = raw as { path: string; oldText?: string | null; newText: string };
    return { type: "diff", path: d.path, oldText: d.oldText ?? undefined, newText: d.newText };
  }
  if (kind === "terminal") {
    return { type: "terminal", terminalId: String((raw as { terminalId?: unknown }).terminalId ?? "") };
  }
  if (kind === "content") {
    const content = (raw as { content?: unknown }).content as Record<string, unknown> | undefined;
    const ct = content?.type;
    if (ct === "text") return { type: "text", text: String(content?.text ?? "") };
    if (ct === "image") {
      return { type: "image", mimeType: String(content?.mimeType ?? "image/png"), data: content?.data as string | undefined, uri: content?.uri as string | undefined };
    }
    if (ct === "audio") {
      return { type: "audio", mimeType: String(content?.mimeType ?? "audio/wav"), data: content?.data as string | undefined, uri: content?.uri as string | undefined };
    }
    if (ct === "resource_link") {
      return {
        type: "resource_link",
        uri: String(content?.uri ?? ""),
        name: content?.name as string | undefined,
        title: content?.title as string | undefined,
        mimeType: content?.mimeType as string | undefined,
      };
    }
    if (ct === "resource") {
      const resource = content?.resource as Record<string, unknown> | undefined;
      return {
        type: "resource",
        uri: String(resource?.uri ?? ""),
        name: resource?.name as string | undefined,
        text: typeof resource?.text === "string" ? resource.text : undefined,
      };
    }
    return { type: "unknown", raw: content };
  }
  return { type: "unknown", raw };
}

/** `_meta` key marking a prompt text block as attached context (note,
 *  selection, vault rules) rather than what the user typed. */
export const CONTEXT_META_KEY = "obsidian-chat/context";

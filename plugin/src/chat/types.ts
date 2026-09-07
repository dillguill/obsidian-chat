/** Shared chat-core types. This module must stay `obsidian`-free so the engine
 *  logic is pure and testable (PLAN §2.8). */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  args: string;
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
  name?: string;
  tool_call_id?: string;
  /** For assistant messages: the tool calls the model requested. */
  tool_calls?: ToolCall[];
  /** Multimodal attachments on a user message (vision). Empty/undefined = text-only. */
  images?: ImageAttachment[];
}

/** Streaming events the UI subscribes to. `reasoning` is first-class because
 *  G7 showed reasoning models emit `delta.reasoning` while `content` is empty. */
export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "done"; finishReason?: string }
  | { type: "error"; message: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, JsonSchema>;
    required?: string[];
  };
}

/** A permissive JSON-schema property descriptor (subset of JSON Schema). */
export interface JsonSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onEvent: (e: StreamEvent) => void;
}

/** A provider is anything that can stream a chat completion. Implementations:
 *  OpenAI-compatible (DeepSeek/OpenRouter/OpenAI/Ollama), Anthropic, and the
 *  harness gateway (auth + relay + ephemeral worker). */
export interface ChatRuntime {
  id: string;
  displayName: string;
  stream(req: ChatRequest): Promise<void>;
}

/** For grounding, the plugin assembles a context by retrieving notes. */
export interface RetrievedNote {
  /** vault-relative path, e.g. `Inbox/foo.md` */
  rel: string;
  score: number;
  snippet: string;
}

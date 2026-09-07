/** Anthropic Messages streaming adapter (`/v1/messages`, stream: true).
 *  Handles `content_block_delta` (text + `thinking` deltas) and stop_reason. */
import type { ChatMessage, ChatRequest, ChatRuntime, ToolCall, ToolDefinition } from "./types";

export interface AnthropicConfig {
  baseUrl?: string; // default https://api.anthropic.com
  apiKey: string;
}

export class AnthropicRuntime implements ChatRuntime {
  id = "anthropic";
  displayName = "Anthropic";
  constructor(private cfg: AnthropicConfig) {}

  async stream(req: ChatRequest): Promise<void> {
    try {
      const base = (this.cfg.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
      const url = `${base}/v1/messages`;
      const system = req.messages.filter((m) => m.role === "system");
      const rest = req.messages.filter((m) => m.role !== "system");

      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: 4096,
        stream: true,
        messages: rest.map((m) => {
          const msg: Record<string, unknown> = { role: m.role };
          // Vision: emit a content array of text + image blocks (Anthropic uses a
          // base64 `source` rather than OpenAI's `image_url`).
          if (m.images?.length) {
            msg.content = [
              { type: "text", text: m.content },
              ...m.images.map((img) => ({
                type: "image",
                source: { type: "base64", media_type: img.mediaType, data: img.dataUrl.split(",")[1] ?? img.dataUrl },
              })),
            ];
          } else {
            msg.content = m.content;
          }
          return msg;
        }),
      };
      if (system.length) body.system = system.map((m) => m.content).join("\n\n");
      if (req.tools?.length) {
        body.tools = req.tools.map((t: ToolDefinition) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      }

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });

      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "");
        req.onEvent({ type: "error", message: `HTTP ${resp.status}: ${detail.slice(0, 200)}` });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finish: string | undefined;
      const toolCalls = new Map<number, ToolCall>(); // block index -> call

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) > -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          this.parseBlock(block, req, (f) => (finish = f), toolCalls);
        }
      }
      if (finish === "tool_use" && toolCalls.size) {
        req.onEvent({ type: "tool_calls", calls: [...toolCalls.values()] });
      }
      req.onEvent({ type: "done", finishReason: finish });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      req.onEvent({ type: "error", message: String((err as Error).message ?? err) });
    }
  }

  private parseBlock(block: string, req: ChatRequest, setFinish: (f: string) => void, toolCalls: Map<number, ToolCall>) {
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.type === "content_block_start") {
      const cb = json.content_block;
      if (cb?.type === "tool_use") {
        const i = json.index ?? toolCalls.size;
        toolCalls.set(i, { id: cb.id, name: cb.name, args: cb.input ? JSON.stringify(cb.input) : "" });
      }
    } else if (json.type === "content_block_delta") {
      const d = json.delta;
      if (d?.type === "text_delta" && d.text) req.onEvent({ type: "token", text: d.text });
      if (d?.type === "thinking_delta" && d.thinking) req.onEvent({ type: "reasoning", text: d.thinking });
      if (d?.type === "input_json_delta" && d.partial_json) {
        const i = json.index ?? 0;
        const cur = toolCalls.get(i);
        if (cur) {
          cur.args += d.partial_json;
          req.onEvent({ type: "tool_call", name: cur.name, args: cur.args });
        }
      }
    } else if (json.type === "message_delta" && json.delta?.stop_reason) {
      setFinish(json.delta.stop_reason);
    }
  }
}

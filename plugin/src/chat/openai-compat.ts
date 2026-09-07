/** OpenAI-compatible streaming adapter.
 *  Covers DeepSeek, OpenRouter, OpenAI, and Ollama's /v1/chat/completions.
 *  Parses `text/event-stream` and surfaces `delta.reasoning` as a first-class
 *  event (G7 finding) in addition to `delta.content`.
 *  Fallback: when a provider doesn't allow browser CORS (raw `fetch` is blocked),
 *  we retry non-streaming via Obsidian's `requestUrl`, which bypasses CORS. */
import { requestUrl } from "obsidian";
import type { ChatMessage, ChatRequest, ChatRuntime, StreamEvent, ToolCall, ToolDefinition } from "./types";

// Some providers (e.g. OpenCode) sit behind Cloudflare, which blocks requests
// based on the client User-Agent (non-browser UAs get 400/403 "error code: 1010").
// A browser-like UA bypasses that block; Obsidian's `requestUrl` otherwise sends
// a library UA that Cloudflare rejects. Also used as a fallback for CORS.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface OpenAiCompatConfig {
  baseUrl: string; // e.g. "https://api.deepseek.com/v1" or "http://127.0.0.1:11434/v1"
  apiKey: string;
  /** Cap on completion tokens so reasoning + answer fit in budget. */
  maxTokens?: number;
}

function buildBody(req: ChatRequest, tools?: ToolDefinition[], maxTokens = 4096, stream = true) {
  // Map our neutral ChatMessage/role to OpenAI wire format.
  const messages = req.messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role };
    // Vision: emit a content array of text + image_url blocks when images present.
    if (m.images?.length) {
      out.content = [
        { type: "text", text: m.content },
        ...m.images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
      ];
    } else {
      out.content = m.content;
    }
    if (m.name) out.name = m.name;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.tool_calls?.length) {
      out.tool_calls = m.tool_calls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args } }));
    }
    return out;
  });
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream,
    max_tokens: maxTokens,
  };
  if (req.tools && req.tools.length) {
    // OpenAI wire format: each tool must be wrapped in { type: "function", function: {...} }.
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  return body;
}

export class OpenAiCompatRuntime implements ChatRuntime {
  id = "openai-compat";
  displayName = "OpenAI-compatible";
  constructor(private cfg: OpenAiCompatConfig) {}

  async stream(req: ChatRequest): Promise<void> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.cfg.apiKey ? `Bearer ${this.cfg.apiKey}` : "",
        },
        body: JSON.stringify(buildBody(req, req.tools, this.cfg.maxTokens)),
        signal: req.signal,
      });

      if (!resp.ok || !resp.body) {
        let detail = await resp.text().catch(() => "");
        let msg = `HTTP ${resp.status}`;
        try {
          const j = JSON.parse(detail);
          msg += `: ${j.error?.message ?? j.message ?? detail}`;
        } catch {
          if (detail) msg += `: ${detail.slice(0, 200)}`;
        }
        req.onEvent({ type: "error", message: msg });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finish: string | undefined;
      const toolCalls = new Map<number, ToolCall>(); // index -> call (args accumulate)

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
      if (buf.trim()) this.parseBlock(buf, req, (f) => (finish = f), toolCalls);
      if (finish === "tool_calls" && toolCalls.size) {
        req.onEvent({ type: "tool_calls", calls: [...toolCalls.values()] });
      }
      req.onEvent({ type: "done", finishReason: finish });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // CORS / network fetch failed — retry non-streaming via requestUrl (no CORS).
      await this.streamViaRequestUrl(req, url);
    }
  }

  /** Non-streaming fallback via Obsidian's `requestUrl` (bypasses CORS). Emits the
   *  whole reasoning + content at once. Used when `fetch` is blocked by the browser. */
  private async streamViaRequestUrl(req: ChatRequest, url: string): Promise<void> {
    try {
      const resp = await requestUrl({
        url,
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.cfg.apiKey ? `Bearer ${this.cfg.apiKey}` : "",
          "user-agent": BROWSER_UA,
        },
        body: JSON.stringify(buildBody(req, req.tools, this.cfg.maxTokens, false)),
        throw: false,
      });
      let text = "";
      try {
        text = resp.text ?? "";
      } catch {
        /* ignore */
      }
      const j: any = resp.json as any;
      if (resp.status < 200 || resp.status >= 300) {
        req.onEvent({ type: "error", message: `HTTP ${resp.status}: ${text.slice(0, 200)}` });
        return;
      }
      const choice = j?.choices?.[0];
      const msg = choice?.message ?? {};
      const reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
      const content = msg.content ?? "";
      if (content) {
        if (reasoning) req.onEvent({ type: "reasoning", text: reasoning });
        req.onEvent({ type: "token", text: content });
      } else if (reasoning) {
        // No content — this model put its whole answer in reasoning_content; surface it.
        req.onEvent({ type: "token", text: reasoning });
      }
      req.onEvent({ type: "done", finishReason: choice?.finish_reason ?? "stop" });
    } catch (err) {
      req.onEvent({ type: "error", message: String((err as Error).message ?? err) });
    }
  }

  private parseBlock(block: string, req: ChatRequest, setFinish: (f: string) => void, toolCalls: Map<number, ToolCall>) {
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data || data === "[DONE]") return;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      return; // keepalive or non-JSON frame
    }
    const delta = json?.choices?.[0]?.delta;
    if (!delta) return;
    // G7 + opencode/DeepSeek: reasoning streams as `delta.reasoning` OR
    // `delta.reasoning_content` before `delta.content` appears.
    if (typeof delta.reasoning === "string" && delta.reasoning) {
      req.onEvent({ type: "reasoning", text: delta.reasoning });
    } else if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      req.onEvent({ type: "reasoning", text: delta.reasoning_content });
    }
    if (typeof delta.content === "string" && delta.content) {
      req.onEvent({ type: "token", text: delta.content });
    }
    if (delta.tool_calls?.length) {
      for (const tc of delta.tool_calls) {
        const i = tc.index ?? 0;
        const cur = toolCalls.get(i) ?? { id: tc.id ?? `call_${i}`, name: tc.function?.name ?? "tool", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolCalls.set(i, cur);
        req.onEvent({ type: "tool_call", name: cur.name, args: cur.args });
      }
    }
    const fr = json?.choices?.[0]?.finish_reason;
    if (fr) setFinish(fr);
  }
}

/** Chat engine — orchestrates a grounded turn against a provider runtime.
 *  Phase 1: read-only tools in a bounded loop (default off — grounding is the
 *  primary path; tool loop only engages if the model requests a tool). */
import type { ChatMessage, ChatRequest, ChatRuntime, StreamEvent, ToolCall, ToolDefinition, ImageAttachment } from "./types";
import { buildGrounding, type GroundContext } from "./ground";

export interface EngineDeps {
  runtime: ChatRuntime;
  model: string;
  tools: ToolDefinition[];
  maxToolRounds: number;
  tokenBudget: number;
  ground(query: string): Promise<GroundContext>;
  executeTool(name: string, args: any): Promise<{ ok: boolean; output: string }>;
  onEvent(e: StreamEvent): void;
}

export class ChatEngine {
  messages: ChatMessage[] = [];

  constructor(private deps: EngineDeps) {}

  setHistory(msgs: ChatMessage[]) {
    this.messages = msgs;
  }

  getHistory(): ChatMessage[] {
    return this.messages;
  }

  /** Run one grounded turn. Emits streamed events via deps.onEvent. */
  async ask(userText: string, systemContext?: string, images?: ImageAttachment[]): Promise<{ tokens: number; toolRounds: number }> {
    this.messages.push({ role: "user", content: userText, images });

    const ground = systemContext
      ? { systemPrompt: systemContext, citations: [] as string[] }
      : await this.deps.ground(userText);

    const history: ChatMessage[] = [
      { role: "system", content: ground.systemPrompt },
      ...this.messages.filter((m) => m.role !== "system"),
    ];

    let finalText = "";
    let rounds = 0;
    let tokens = 0;
    let assembled: ToolCall[] = [];

    const flushToolCalls = async (calls: ToolCall[]) => {
      // Append the assistant message with the tool calls (as the API expects),
      // then execute each and append tool result messages with matching ids.
      history.push({ role: "assistant", content: finalText, tool_calls: calls });
      for (const c of calls) {
        this.deps.onEvent({ type: "tool_call", name: c.name, args: c.args });
        const res = await this.deps.executeTool(c.name, safeParse(c.args));
        history.push({ role: "tool", content: res.output, tool_call_id: c.id });
        tokens += res.output.length / 4;
      }
    };

    for (;;) {
      assembled = [];
      const req: ChatRequest = {
        model: this.deps.model,
        messages: history,
        tools: this.deps.tools,
        onEvent: (e) => {
          if (e.type === "token") {
            finalText += e.text;
            tokens += e.text.length / 4;
            this.deps.onEvent(e);
          } else if (e.type === "reasoning") {
            this.deps.onEvent(e);
          } else if (e.type === "tool_calls") {
            assembled = e.calls;
          } else if (e.type === "tool_call") {
            // streaming partial — surfaced to UI, execution uses `tool_calls`
            this.deps.onEvent(e);
          } else if (e.type === "error") {
            this.deps.onEvent(e);
          }
        },
      };
      await this.deps.runtime.stream(req);

      const budgetExceeded = tokens > this.deps.tokenBudget;
      const capped = rounds >= this.deps.maxToolRounds;
      if (assembled.length && !budgetExceeded && !capped) {
        rounds++;
        await flushToolCalls(assembled);
        continue;
      }
      if (budgetExceeded) this.deps.onEvent({ type: "error", message: `token budget (${this.deps.tokenBudget}) exceeded — stopping` });
      if (capped && assembled.length) this.deps.onEvent({ type: "error", message: `tool round cap (${this.deps.maxToolRounds}) reached` });
      break;
    }

    this.messages.push({ role: "assistant", content: finalText });
    return { tokens: Math.round(tokens), toolRounds: rounds };
  }

  /** Reset the conversation. */
  clear() {
    this.messages = [];
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return { query: s };
  }
}

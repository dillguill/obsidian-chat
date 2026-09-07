/** Build a provider runtime from a ProviderConfig. Shared by the chat view and
 *  the inline-edit command so provider selection stays in one place. */
import { OpenAiCompatRuntime } from "./openai-compat";
import { AnthropicRuntime } from "./anthropic";
import type { ChatRuntime } from "./types";
import { isAnthropicType, type ProviderConfig } from "../settings";

export function buildRuntime(p: ProviderConfig): ChatRuntime {
  if (isAnthropicType(p.type)) return new AnthropicRuntime({ apiKey: p.apiKey, baseUrl: p.baseUrl || undefined });
  return new OpenAiCompatRuntime({ baseUrl: p.baseUrl, apiKey: p.apiKey });
}

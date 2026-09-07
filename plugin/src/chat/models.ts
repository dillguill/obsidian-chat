/** Shared model-listing utilities for the provider settings and the chat picker. */
import { requestUrl } from "obsidian";
import { getActiveProvider, isAnthropicType, type ObsidianChatSettings, type ProviderConfig } from "../settings";

export interface ModelItem {
  providerId: string;
  providerName: string;
  model: string;
  pinned: boolean;
}

/** Fetch the model list for a provider. OpenAI-compatible: `{baseUrl}/models`;
 *  Anthropic: `{baseUrl}/v1/models`. Returns model ids, or [] if it can't. */
export async function fetchProviderModels(p: ProviderConfig): Promise<string[]> {
  const base = p.baseUrl.trim().replace(/\/$/, "");
  if (!base) return [];
  const anthropic = isAnthropicType(p.type);
  const url = anthropic ? `${base}/v1/models` : `${base}/models`;
  const headers: Record<string, string> = {};
  if (anthropic) {
    headers["x-api-key"] = p.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (p.apiKey) {
    headers.authorization = `Bearer ${p.apiKey}`;
  }
  const res = await requestUrl({ url, method: "GET", headers });
  const json = res.json as any;
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const ids = data.map((m: any) => (typeof m === "string" ? m : m?.id)).filter((x: any) => typeof x === "string" && x);
  return ids;
}

/** Build the list of selectable models for the chat picker. Pinned/active models
 *  go first; everything else is unpinned by default. */
export async function buildModelItems(s: ObsidianChatSettings): Promise<ModelItem[]> {
  const active = getActiveProvider(s);
  const items: ModelItem[] = [];
  const seen = new Set<string>();

  const addItem = (providerId: string, providerName: string, model: string, pinned: boolean) => {
    const key = `${providerId}\u0000${model}`;
    if (seen.has(key) || !model) return;
    seen.add(key);
    items.push({ providerId, providerName, model, pinned });
  };

  // A model is "pinned" (shown at top) if the user pinned it OR it's the
  // currently active/default model.
  const isActive = (providerId: string, model: string) => providerId === active.id && model === active.model;

  // User-pinned models first (may reference providers no longer in the list).
  for (const pm of s.pinnedModels) {
    const prov = s.providers.find((p) => p.id === pm.providerId);
    addItem(pm.providerId, prov?.name ?? "pinned", pm.model, true);
  }

  // Always include each provider's configured default model.
  for (const p of s.providers) {
    addItem(p.id, p.name || p.type, p.model, isActive(p.id, p.model));
  }

  // Fetch available models for every provider that has a base URL (in parallel;
  // failure just falls back to the configured default).
  await Promise.all(
    s.providers
      .filter((p) => p.baseUrl.trim())
      .map(async (p) => {
        try {
          const ids = await fetchProviderModels(p);
          for (const id of ids) addItem(p.id, p.name || p.type, id, isActive(p.id, id));
        } catch {
          /* ignore — default model already added */
        }
      })
  );

  // Pinned (user + active) first, then the rest.
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/** Pin or unpin a model in settings. Returns the new pinned state. */
export function togglePinnedModel(s: ObsidianChatSettings, item: ModelItem): boolean {
  const i = s.pinnedModels.findIndex((x) => x.providerId === item.providerId && x.model === item.model);
  if (i > -1) {
    s.pinnedModels.splice(i, 1);
    return false;
  }
  s.pinnedModels.push({ providerId: item.providerId, model: item.model });
  return true;
}

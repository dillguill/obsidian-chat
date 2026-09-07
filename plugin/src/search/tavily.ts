/** Tavily web-search provider (Phase 2b).
 *  Uses Obsidian's `requestUrl` (privileged, no CORS) so it works from the
 *  plugin on both desktop and mobile/webview. Returns cited results as a tool
 *  message the agent can incorporate. */
import { requestUrl } from "obsidian";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

export function createTavilyProvider(apiKey: string): SearchProvider {
  return {
    async search(query) {
      const resp = await requestUrl({
        url: "https://api.tavily.com/search",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 5, include_answer: false }),
      });
      const j = resp.json as any;
      const results: SearchResult[] = (j.results ?? []).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        content: r.content ?? "",
        score: r.score,
      }));
      return results;
    },
  };
}

/** Render web results as a compact tool output string. */
export function formatSearchResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.content ?? "").slice(0, 400)}`)
    .join("\n\n");
}

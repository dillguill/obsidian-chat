/** Plugin-side executor for the tool contract (read + write, Phase 2a).
 *  Wraps `contract.ts` with the Obsidian VaultAdapter so tools run locally,
 *  with approval + diff handling provided by the approval layer. */
import type { ToolResult, WritePreview, VaultAdapter } from "../tools/contract";
import type { ToolDefinition as ChatToolDefinition } from "../chat/types";
import { executeTool, previewWrite, TOOLS, WRITE_TOOL_NAMES, EXTERNAL_TOOL_NAMES } from "../tools/contract";
import type { VaultIndex } from "../retrieval/index";
import type { SearchProvider } from "../search/tavily";
import { formatSearchResults } from "../search/tavily";

export interface ApprovalDecision {
  allowed: boolean;
  remember?: boolean; // "always allow this tool"
}

export interface ApprovalRequester {
  /** Ask the user to approve a write action, showing the diff/preview. */
  request(preview: WritePreview): Promise<ApprovalDecision>;
}

export type ToolRunner = {
  exec(name: string, args: any, index: VaultIndex): Promise<ToolResult>;
  /** Execute with approval gating for write tools. */
  execWithApproval(name: string, args: any, index: VaultIndex, approver: ApprovalRequester): Promise<ToolResult>;
  definitions(): ChatToolDefinition[];
  isWrite(name: string): boolean;
};

/** Build a runner. `search` is an optional Tavily-backed web search provider. */
export function createToolRunner(opts: { searchProvider?: () => SearchProvider | null } = {}): ToolRunner {
  const adapter = (index: VaultIndex): VaultAdapter => ({
    read: (p) => index.read(p),
    exists: (p) => index.exists(p),
    listFolder: (p, r) => index.listFolder(p, r),
    search: (q) => Promise.resolve(index.search(q)),
    createNote: (p, c) => index.createNote(p, c),
    editNote: (p, c) => index.editNote(p, c),
    renameMove: (o, n) => index.renameMove(o, n),
    createFolder: (p) => index.createFolder(p),
    setProperty: (p, k, v) => index.setProperty(p, k, v),
    manageTags: (p, t) => index.manageTags(p, t),
    deleteFile: (p) => index.deleteFile(p),
  });

  async function run(name: string, args: any, index: VaultIndex): Promise<ToolResult> {
    if (EXTERNAL_TOOL_NAMES.has(name)) {
      const provider = opts.searchProvider?.();
      if (!provider) return { ok: false, output: "web_search: no provider configured (add a Tavily key)" };
      if (name === "web_search") {
        const results = await provider.search(String(args?.query ?? ""));
        return { ok: true, output: formatSearchResults(results) };
      }
    }
    return executeTool(name, args, adapter(index));
  }

  return {
    exec(name, args, index) {
      return run(name, args, index);
    },
    async execWithApproval(name, args, index, approver) {
      if (WRITE_TOOL_NAMES.has(name)) {
        const preview = await previewWrite(name, args, adapter(index));
        const decision = await approver.request(preview);
        if (!decision.allowed) return { ok: false, output: `⚠ Denied: ${preview.summary}` };
      }
      return run(name, args, index);
    },
    definitions() {
      return TOOLS as ChatToolDefinition[];
    },
    isWrite(name) {
      return WRITE_TOOL_NAMES.has(name);
    },
  };
}

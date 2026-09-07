/** Tool contract v1 + v2 — read-only and write tools. PLAN §2.4 / Phase 2a.
 *  Same JSON-schema contract, executed in two places:
 *    - locally by the plugin (with approval + diff UI)
 *    - harness-side by the worker via the Local REST API (Phase 3)
 *  Write tools are designed to be *previewable*: `previewWrite` returns a human
 *  diff/description WITHOUT applying, so an approval card can show it first. */
import type { ToolDefinition } from "../chat/types";

export interface ToolResult {
  ok: boolean;
  output: string;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const READ_ONLY_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the full text of a note by its vault-relative path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Vault-relative path incl .md, e.g. Inbox/foo.md" } },
      required: ["path"],
    },
  },
  {
    name: "search_vault",
    description: "Full-text search across the vault. Returns the top matching notes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms" },
        tags: { type: "string", description: "Optional tag filter, e.g. #idea" },
      },
    },
  },
  {
    name: "list_folder",
    description: "List note paths under a vault folder.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Vault-relative folder (empty = root)" },
        recursive: { type: "boolean", description: "Recurse subfolders (default false)" },
      },
    },
  },
];

export const WRITE_TOOLS: ToolDefinition[] = [
  {
    name: "create_note",
    description: "Create a new note at a vault-relative path with the given markdown content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Vault-relative path incl .md, e.g. Inbox/idea.md" },
        content: { type: "string", description: "Markdown body (frontmatter allowed)" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_note",
    description: "Edit an existing note. Either replace the whole content (`content`) or do a targeted `old_string` → `new_string` replace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Vault-relative path incl .md" },
        content: { type: "string", description: "If present, replaces the entire note body" },
        old_string: { type: "string", description: "For targeted replace: text to find" },
        new_string: { type: "string", description: "For targeted replace: replacement text" },
      },
      required: ["path"],
    },
  },
  {
    name: "rename_move_file",
    description: "Rename or move a note to a new vault-relative path. Obsidian updates incoming wikilinks.",
    parameters: {
      type: "object",
      properties: {
        old_path: { type: "string", description: "Current vault-relative path incl .md" },
        new_path: { type: "string", description: "Target vault-relative path incl .md" },
      },
      required: ["old_path", "new_path"],
    },
  },
  {
    name: "create_folder",
    description: "Create a vault folder (recursively).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Vault-relative folder path, e.g. Projects/Research" } },
      required: ["path"],
    },
  },
  {
    name: "set_property",
    description: "Set a frontmatter property (key: value) on a note. Creates or replaces the key.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Vault-relative path incl .md" },
        key: { type: "string", description: "Frontmatter key" },
        value: { type: "string", description: "Frontmatter value (string or JSON)" },
      },
      required: ["path", "key", "value"],
    },
  },
  {
    name: "manage_tags",
    description: "Set the tags for a note (replaces existing tags in frontmatter).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Vault-relative path incl .md" },
        tags: { type: "array", description: "Tag names without #, e.g. [\"idea\",\"research\"]", items: { type: "string" } },
      },
      required: ["path", "tags"],
    },
  },
  {
    name: "delete_file",
    description: "Move a note to trash (soft delete). Use sparingly; prefer edit/rename.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Vault-relative path incl .md" } },
      required: ["path"],
    },
  },
  {
    name: "web_search",
    description: "Search the web (Tavily) and return cited results. Use when the answer isn't in the vault.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
];

export const TOOLS: ToolDefinition[] = [...READ_ONLY_TOOLS, ...WRITE_TOOLS];

export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
export const EXTERNAL_TOOL_NAMES = new Set(["web_search"]);

// ---------------------------------------------------------------------------
// Vault adapter (local executor)
// ---------------------------------------------------------------------------

export interface VaultAdapter {
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  listFolder(path: string, recursive: boolean): Promise<string[]>;
  search(query: string): Promise<string>;
  // write ops (Phase 2a)
  createNote(path: string, content: string): Promise<void>;
  editNote(path: string, content: string): Promise<void>;
  renameMove(oldPath: string, newPath: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  setProperty(path: string, key: string, value: string): Promise<void>;
  manageTags(path: string, tags: string[]): Promise<void>;
  deleteFile(path: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function executeTool(name: string, args: any, vault: VaultAdapter): Promise<ToolResult> {
  try {
    switch (name) {
      // ---- read ----
      case "read_file": {
        const p = String(args?.path ?? "");
        if (!p) return { ok: false, output: "read_file: missing path" };
        const text = await vault.read(p);
        return { ok: true, output: text.length > 8000 ? text.slice(0, 8000) + "\n… (truncated)" : text };
      }
      case "search_vault": {
        const q = String(args?.query ?? "");
        if (!q) return { ok: false, output: "search_vault: missing query" };
        return { ok: true, output: await vault.search(q) };
      }
      case "list_folder": {
        const p = String(args?.path ?? "");
        const rec = Boolean(args?.recursive);
        const files = await vault.listFolder(p, rec);
        return { ok: true, output: files.join("\n") || "(empty)" };
      }
      // ---- write ----
      case "create_note": {
        const p = String(args?.path ?? "");
        if (!p) return { ok: false, output: "create_note: missing path" };
        if (await vault.exists(p)) return { ok: false, output: `already exists: ${p}` };
        await vault.createNote(p, String(args?.content ?? ""));
        return { ok: true, output: `created ${p}` };
      }
      case "edit_note": {
        const p = String(args?.path ?? "");
        if (!p) return { ok: false, output: "edit_note: missing path" };
        if (args?.content !== undefined) {
          await vault.editNote(p, String(args.content));
        } else if (args?.old_string !== undefined) {
          const cur = await vault.read(p);
          if (!cur.includes(String(args.old_string))) return { ok: false, output: `old_string not found in ${p}` };
          await vault.editNote(p, cur.replace(String(args.old_string), String(args?.new_string ?? "")));
        } else {
          return { ok: false, output: "edit_note: need content or old_string/new_string" };
        }
        return { ok: true, output: `edited ${p}` };
      }
      case "rename_move_file": {
        await vault.renameMove(String(args?.old_path ?? ""), String(args?.new_path ?? ""));
        return { ok: true, output: `moved ${args.old_path} → ${args.new_path}` };
      }
      case "create_folder": {
        const p = String(args?.path ?? "");
        if (!p) return { ok: false, output: "create_folder: missing path" };
        await vault.createFolder(p);
        return { ok: true, output: `created folder ${p}` };
      }
      case "set_property": {
        await vault.setProperty(String(args?.path ?? ""), String(args?.key ?? ""), String(args?.value ?? ""));
        return { ok: true, output: `set ${args.path} ${args.key} = ${args.value}` };
      }
      case "manage_tags": {
        const tags = (args?.tags ?? []).map(String);
        await vault.manageTags(String(args?.path ?? ""), tags);
        return { ok: true, output: `tags ${tags.join(", ")} on ${args.path}` };
      }
      case "delete_file": {
        await vault.deleteFile(String(args?.path ?? ""));
        return { ok: true, output: `${args.path} moved to trash` };
      }
      default:
        return { ok: false, output: `unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, output: `${name} failed: ${String((err as Error).message ?? err)}` };
  }
}

// ---------------------------------------------------------------------------
// Preview / diff (for approval cards) — computes WITHOUT mutating
// ---------------------------------------------------------------------------

export interface WritePreview {
  action: string;
  path: string;
  /** For content-diff tools: unified-ish diff lines (added: +, removed: -). */
  diff?: string[];
  summary: string;
}

export async function previewWrite(name: string, args: any, vault: VaultAdapter): Promise<WritePreview> {
  const p = String(args?.path ?? "");
  switch (name) {
    case "create_note":
      return {
        action: "Create note",
        path: p,
        summary: `Create \`${p}\` (${String(args?.content ?? "").length} chars)`,
        diff: String(args?.content ?? "").split("\n").map((l) => "+ " + l),
      };
    case "edit_note": {
      const cur = await vault.read(p);
      if (args?.content !== undefined) {
        return { action: "Edit note", path: p, summary: `Replace content of \`${p}\``, diff: textDiff(cur, String(args.content)) };
      }
      if (args?.old_string !== undefined) {
        const next = cur.replace(String(args.old_string), String(args?.new_string ?? ""));
        return { action: "Edit note", path: p, summary: `Targeted replace in \`${p}\``, diff: textDiff(cur, next) };
      }
      return { action: "Edit note", path: p, summary: `Edit \`${p}\``, diff: [] };
    }
    case "rename_move_file":
      return { action: "Move/rename", path: p, summary: `Move \`${args.old_path}\` → \`${args.new_path}\`` };
    case "create_folder":
      return { action: "Create folder", path: p, summary: `Create folder \`${p}\`` };
    case "set_property":
      return { action: "Set property", path: p, summary: `Set \`${p}\` \`${args.key}\` = \`${args.value}\`` };
    case "manage_tags":
      return { action: "Set tags", path: p, summary: `Set tags on \`${p}\`: ${(args.tags ?? []).join(", ")}` };
    case "delete_file":
      return { action: "Delete (trash)", path: p, summary: `Move \`${p}\` to trash` };
    default:
      return { action: name, path: p, summary: `Run ${name}` };
  }
}

/** Minimal line diff (added/removed) — enough for an approval card. */
function textDiff(oldText: string, newText: string): string[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push("  " + a[i]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push("- " + a[i]); i++;
    } else {
      out.push("+ " + b[j]); j++;
    }
  }
  while (i < n) out.push("- " + a[i++]);
  while (j < m) out.push("+ " + b[j++]);
  return out.length > 60 ? [...out.slice(0, 30), `… ${out.length - 60} more lines`, ...out.slice(out.length - 30)] : out;
}

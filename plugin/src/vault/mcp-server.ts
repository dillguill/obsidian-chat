/** Vault MCP server (FR-026…FR-033, contract `vault-mcp.md`; redesign item 6).
 *
 *  Read tools always; write tools when a `writer` is supplied. Every write is
 *  shown to the user as an approval card with the real diff (routed to the
 *  device that owns the chat session) and goes through VaultService, so the
 *  blacklist, `.obsidian/` protection, editor refresh and host-side undo
 *  apply. This is the only vault path a harness needs: a harness's own file
 *  tools should be turned off so these rules can't be bypassed.
 *
 *  Obsidian-free on purpose: every tool calls the shared `VaultQuerySurface`
 *  (implemented by `VaultService` at runtime and by the fake in tests), and all
 *  path decisions go through the same `path-policy.ts` the ACP fs handlers use.
 *  This module owns dispatch and tool behaviour only; the HTTP transport lives
 *  in `shell/host-server.ts` so the mobile bundle never evaluates Node APIs.
 */
import { constantTimeEqual } from "../shell/device-auth.ts";
import { evaluateAcpPath, evaluateRelativePath, normalizeRelative, type PathPolicyConfig } from "./path-policy.ts";
import type { VaultQuerySurface } from "./service.ts";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Hard caps from the contract; a caller may ask for less, never more. */
const LIMITS = {
  search: { default: 10, max: 50 },
  backlinks: { default: 20, max: 50 },
  tags: { default: 100, max: 200 },
} as const;
const SNIPPET_CHARS = 400;
const RESPONSE_CHARS = 256 * 1024;
const TOOL_TIMEOUT_MS = 5_000;
/** Matches the operational approval timeout (10 min) plus the write itself. */
const WRITE_TIMEOUT_MS = 11 * 60 * 1000;
const READ_CHARS = 200_000;
const LIST_MAX = 500;
const SEARCH_TIMEOUT_MS = 2_000;

/** One proposed change, as the approval card shows it. */
export interface WriteApproval {
  tool: string;
  path: string;
  /** null when the note does not exist yet. */
  oldText: string | null;
  newText: string;
}

/** Per-request context from the transport (which chat session is calling). */
export interface McpCallContext {
  /** Opaque per-session key the host gave the harness with the MCP entry. */
  session?: string | null;
}

/** Host side of the write tools. */
export interface VaultWriter {
  exists(relPath: string): boolean;
  /** Snapshot (for undo) and write through VaultService. */
  write(relPath: string, content: string): Promise<void>;
  /** Asks the user on the owning device; true only for an explicit allow. */
  approve(change: WriteApproval, context: McpCallContext): Promise<boolean>;
}

export interface VaultMcpOptions {
  vault: VaultQuerySurface;
  /** Enables the write tools. */
  writer?: VaultWriter;
  /** Evaluated per call so settings changes apply without a restart. */
  policy: () => PathPolicyConfig;
  /** Current per-session bearer token; null/absent means “no session”. */
  token?: () => string | null;
  /** Plugin version for `serverInfo`. */
  version?: string;
}

export interface McpContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

interface ToolOutcome {
  value: unknown;
  truncated?: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Write tools wait for the user, so they get the approval timeout. */
  writes?: boolean;
  run(args: Record<string, unknown>, context: McpCallContext): Promise<ToolOutcome>;
}

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

/** A tool-level failure: shown to the harness as `isError`, never thrown to
 *  the JSON-RPC layer. */
class ToolError extends Error {}

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description, minimum: 1 });

export class VaultMcpServer {
  private opts: VaultMcpOptions;
  private tools: ToolDef[];

  constructor(options: VaultMcpOptions) {
    this.opts = options;
    this.tools = this.buildTools();
  }

  /** Constant-time bearer check. Absent/empty session tokens never authorize. */
  authorize(header: string | null | undefined): boolean {
    const expected = this.opts.token?.() ?? null;
    if (!expected) return false;
    if (typeof header !== "string") return false;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return false;
    return constantTimeEqual(match[1].trim(), expected);
  }

  /** Handles one JSON body (single message or batch); `null` means “nothing to
   *  reply to” (notifications/responses only). */
  async handle(body: unknown, context: McpCallContext = {}): Promise<unknown | null> {
    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((message) => this.handleMessage(message, context)))).filter(
        (reply) => reply !== null,
      );
      return replies.length ? replies : null;
    }
    return this.handleMessage(body, context);
  }

  private async handleMessage(raw: unknown, context: McpCallContext): Promise<unknown | null> {
    if (!raw || typeof raw !== "object") return null;
    const msg = raw as JsonRpcMessage;
    if (typeof msg.method !== "string") return null; // a response or junk
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (!isRequest) return null; // notifications/initialized, cancelled, …
    const id = msg.id;
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

    switch (msg.method) {
      case "initialize":
        return ok({
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "obsidian-vault", version: this.opts.version ?? "1.0.0" },
          instructions:
            "Tools for the user's Obsidian vault. Paths are vault-relative (e.g. `Inbox/idea.md`). " +
            (this.opts.writer
              ? "Use read_note/list_folder to read and write_note/edit_note to change notes; every change is shown " +
                "to the user for approval and may be declined. Blacklisted folders and `.obsidian/` are refused."
              : "These tools are read-only; there is no write path here."),
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: !tool.writes, destructiveHint: false },
          })),
        });
      case "tools/call": {
        const name = msg.params?.name;
        const tool = this.tools.find((t) => t.name === name);
        if (!tool) return fail(-32602, `unknown tool: ${String(name)}`);
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        if (!args || typeof args !== "object" || Array.isArray(args)) {
          return ok(toolError("`arguments` must be an object"));
        }
        try {
          return ok(await this.runTool(tool, args, context));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Tool failures are results the model can read, not protocol errors.
          return ok(toolError(message));
        }
      }
      default:
        return fail(-32601, `method not found: ${msg.method}`);
    }
  }

  private async runTool(tool: ToolDef, args: Record<string, unknown>, context: McpCallContext): Promise<McpToolResult> {
    const timeout = tool.writes ? WRITE_TIMEOUT_MS : tool.name === "search_notes" ? SEARCH_TIMEOUT_MS : TOOL_TIMEOUT_MS;
    const outcome = await withTimeout(tool.run(args, context), timeout, `${tool.name} timed out`);
    const contents: McpContent[] = [{ type: "text", text: bound(JSON.stringify(outcome.value ?? null)) }];
    if (outcome.truncated) {
      contents.push({ type: "text", text: "truncated: true — more results exist; narrow the query or lower the limit." });
    }
    return { content: contents };
  }

  // ---------- path + argument helpers ----------

  /** Resolves a model-supplied path with the shared policy: absolute paths are
   *  mapped through the harness root, relative ones checked as vault-relative. */
  private resolvePath(raw: unknown, field = "path"): string {
    if (typeof raw !== "string" || !raw.trim()) throw new ToolError(`\`${field}\` is required`);
    const value = raw.trim().replace(/\\/g, "/");
    const absolute = value.startsWith("/") || /^[A-Za-z]:\//.test(value);
    const config = this.opts.policy();
    const verdict = absolute ? evaluateAcpPath(value, config) : evaluateRelativePath(value, config);
    if (!verdict.allowed) {
      throw new ToolError(`path refused (${verdict.reason}): ${verdict.detail}`);
    }
    return verdict.relPath;
  }

  /** Folder filters are allowed to be the vault root ("" → no filter). */
  private resolveFolder(raw: unknown): string | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw !== "string") throw new ToolError("`folder` must be a string");
    const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed || trimmed === ".") return undefined;
    const rel = normalizeRelative(trimmed);
    if (rel === null) throw new ToolError("`folder` leaves the vault");
    const verdict = evaluateRelativePath(rel, this.opts.policy());
    if (!verdict.allowed) throw new ToolError(`folder refused (${verdict.reason}): ${verdict.detail}`);
    return verdict.relPath;
  }

  /** Existence probe: these tools address one note, so a missing/refused path
   *  must be an error rather than an empty success (contract §3). */
  private requireNote(relPath: string): void {
    if (!this.opts.vault.metadata(relPath)) throw new ToolError(`not found: ${relPath}`);
  }

  private stringArg(args: Record<string, unknown>, field: string, required = true): string | undefined {
    const value = args[field];
    if (value === undefined || value === null) {
      if (required) throw new ToolError(`\`${field}\` is required`);
      return undefined;
    }
    if (typeof value !== "string") throw new ToolError(`\`${field}\` must be a string`);
    return value;
  }

  private limitArg(
    args: Record<string, unknown>,
    field: string,
    cap: { default: number; max: number },
  ): number {
    const value = args[field];
    if (value === undefined || value === null) return cap.default;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolError(`\`${field}\` must be a number`);
    const rounded = Math.floor(value);
    if (rounded < 1) throw new ToolError(`\`${field}\` must be at least 1`);
    return Math.min(rounded, cap.max);
  }

  private tagsArg(args: Record<string, unknown>): string[] | undefined {
    const value = args.tags;
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.some((t) => typeof t !== "string")) {
      throw new ToolError("`tags` must be an array of strings");
    }
    const tags = value.map((t) => String(t).trim()).filter(Boolean);
    return tags.length ? tags : undefined;
  }

  // ---------- tools ----------

  private buildTools(): ToolDef[] {
    const vault = this.opts.vault;
    // Tool bodies run detached from the class; bind the argument/path helpers.
    const self = this;

    const readTools: ToolDef[] = [
      {
        name: "read_note",
        description: "Text of a note (or any text file) in the vault, optionally a line range. Includes unsaved editor changes.",
        inputSchema: {
          type: "object",
          properties: {
            path: str("Vault-relative path"),
            line: int("First line to return (1-based)"),
            limit: int("Number of lines to return"),
          },
          required: ["path"],
        },
        async run(args) {
          const path = self.resolvePath(args.path);
          const line = optionalInt(args.line, "line");
          const limit = optionalInt(args.limit, "limit");
          const text = await vault.readText(path, line === undefined ? {} : { line, limit });
          return { value: { path, text: bound(text, READ_CHARS) }, truncated: text.length > READ_CHARS };
        },
      },
      {
        name: "list_folder",
        description: "Files and folders directly inside a vault folder (omit `path` for the vault root).",
        inputSchema: { type: "object", properties: { path: str("Vault-relative folder") } },
        async run(args) {
          const folder = self.resolveFolder(args.path) ?? "";
          const entries = vault.listFolder(folder);
          return { value: entries.slice(0, LIST_MAX), truncated: entries.length > LIST_MAX };
        },
      },
    ];
    const writer = this.opts.writer;
    const writeTools: ToolDef[] = !writer
      ? []
      : [
          {
            name: "write_note",
            description:
              "Create a note or replace its whole content. Parent folders are created. The user approves the change first.",
            writes: true,
            inputSchema: {
              type: "object",
              properties: { path: str("Vault-relative path, e.g. `Inbox/idea.md`"), content: str("Full new content") },
              required: ["path", "content"],
            },
            async run(args, context) {
              const path = self.resolvePath(args.path);
              const content = self.stringArg(args, "content") ?? "";
              const oldText = writer.exists(path) ? await vault.readText(path) : null;
              return self.applyChange("write_note", path, oldText, content, context);
            },
          },
          {
            name: "edit_note",
            description:
              "Replace exact text in an existing note. `old_text` must match exactly once unless `replace_all` is true. " +
              "The user approves the change first.",
            writes: true,
            inputSchema: {
              type: "object",
              properties: {
                path: str("Vault-relative note path"),
                old_text: str("Exact text to replace (include enough context to be unique)"),
                new_text: str("Replacement text"),
                replace_all: { type: "boolean", description: "Replace every occurrence" },
              },
              required: ["path", "old_text", "new_text"],
            },
            async run(args, context) {
              const path = self.resolvePath(args.path);
              if (!writer.exists(path)) throw new ToolError(`not found: ${path}`);
              const oldStr = self.stringArg(args, "old_text") ?? "";
              const newStr = self.stringArg(args, "new_text") ?? "";
              if (!oldStr) throw new ToolError("`old_text` must not be empty");
              const current = await vault.readText(path);
              const count = current.split(oldStr).length - 1;
              if (count === 0) throw new ToolError("`old_text` was not found in the note");
              if (count > 1 && args.replace_all !== true) {
                throw new ToolError(`\`old_text\` matches ${count} times; add context or set replace_all`);
              }
              const next = args.replace_all === true ? current.split(oldStr).join(newStr) : current.replace(oldStr, () => newStr);
              return self.applyChange("edit_note", path, current, next, context);
            },
          },
        ];

    return [
      ...readTools,
      {
        name: "search_notes",
        description:
          "Scored full-text search across the vault's Markdown notes (BM25 over the shared vault index). " +
          "Blacklisted and configuration folders are excluded.",
        inputSchema: {
          type: "object",
          properties: {
            query: str("Words to look for"),
            limit: int("Maximum hits (1–50, default 10)"),
            folder: str("Vault-relative folder to restrict the search to"),
            tags: { type: "array", items: { type: "string" }, description: "Only notes carrying all of these tags" },
          },
          required: ["query"],
        },
        async run(args) {
          const query = self.stringArg(args, "query")?.trim() ?? "";
          if (!query) throw new ToolError("`query` must not be empty");
          const limit = self.limitArg(args, "limit", LIMITS.search);
          const folder = self.resolveFolder(args.folder);
          const tags = self.tagsArg(args);
          const hits = await vault.searchNotes(query, limit + 1, folder, tags);
          const results = hits.slice(0, limit).map((hit) => ({
            path: hit.path,
            title: hit.title,
            snippet: bound(hit.snippet ?? "", SNIPPET_CHARS),
            score: hit.score,
          }));
          return { value: results, truncated: hits.length > limit };
        },
      },
      {
        name: "get_backlinks",
        description: "Notes that link to the given note, with link counts.",
        inputSchema: {
          type: "object",
          properties: { path: str("Vault-relative note path"), limit: int("Maximum hits (1–50, default 20)") },
          required: ["path"],
        },
        async run(args) {
          const path = self.resolvePath(args.path);
          self.requireNote(path);
          const limit = self.limitArg(args, "limit", LIMITS.backlinks);
          const hits = vault.backlinks(path, limit + 1);
          return { value: hits.slice(0, limit), truncated: hits.length > limit };
        },
      },
      {
        name: "get_links",
        description: "Outgoing links from the given note; unresolved links are marked as unresolved.",
        inputSchema: {
          type: "object",
          properties: { path: str("Vault-relative note path") },
          required: ["path"],
        },
        async run(args) {
          const path = self.resolvePath(args.path);
          self.requireNote(path);
          return { value: vault.links(path) };
        },
      },
      {
        name: "list_tags",
        description: "Tags used across the vault, most frequent first.",
        inputSchema: {
          type: "object",
          properties: {
            prefix: str("Only tags starting with this prefix (e.g. `#project`)"),
            limit: int("Maximum tags (1–200, default 100)"),
          },
        },
        async run(args) {
          const prefix = self.stringArg(args, "prefix", false)?.trim();
          const limit = self.limitArg(args, "limit", LIMITS.tags);
          const tags = vault.tags(limit + 1, prefix || undefined);
          return { value: tags.slice(0, limit), truncated: tags.length > limit };
        },
      },
      {
        name: "get_outline",
        description: "Headings of the given note in document order, with their line numbers.",
        inputSchema: {
          type: "object",
          properties: { path: str("Vault-relative note path") },
          required: ["path"],
        },
        async run(args) {
          const path = self.resolvePath(args.path);
          self.requireNote(path);
          return { value: vault.outline(path) };
        },
      },
      {
        name: "get_note_metadata",
        description: "Size, timestamps, tags, frontmatter, link counts and backlink count for the given note.",
        inputSchema: {
          type: "object",
          properties: { path: str("Vault-relative note path") },
          required: ["path"],
        },
        async run(args) {
          const path = self.resolvePath(args.path);
          const meta = vault.metadata(path);
          if (!meta) throw new ToolError(`not found: ${path}`);
          // Frontmatter is model-authored; keep it serializable and bounded.
          const frontmatter = safeFrontmatter(meta.frontmatter);
          return {
            value: {
              path: meta.path,
              title: meta.title,
              size: meta.size,
              mtime: meta.mtime,
              tags: meta.tags,
              frontmatter,
              links: meta.links,
              backlinkCount: meta.backlinks,
            },
          };
        },
      },
      ...writeTools,
    ];
  }

  /** Approval, then write. A decline is a tool result the model can read. */
  private async applyChange(
    tool: string,
    path: string,
    oldText: string | null,
    newText: string,
    context: McpCallContext,
  ): Promise<ToolOutcome> {
    const writer = this.opts.writer;
    if (!writer) throw new ToolError("this vault server is read-only");
    if (oldText === newText) return { value: { path, changed: false } };
    const approved = await writer.approve({ tool, path, oldText, newText }, context);
    if (!approved) throw new ToolError(`the user declined this change to ${path}; do not retry it unchanged`);
    await writer.write(path, newText);
    return { value: { path, changed: true, created: oldText === null } };
  }
}

function optionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new ToolError(`\`${field}\` must be a positive integer`);
  return value;
}

function toolError(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function bound(text: string, max = RESPONSE_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

function safeFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
  try {
    const text = JSON.stringify(frontmatter ?? {});
    return JSON.parse(bound(text, 32 * 1024).replace(/\n…\(truncated\)$/, "") || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolError(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The vault's own MCP server, served by the plugin on the host device.
 *
 *  Replaces the Local REST API plugin + `mcp-rules-proxy` pair: the harness
 *  attaches to `/mcp` on the host server (see `host/server.ts`), and every
 *  tool runs in-process against Obsidian's live vault API. The folder
 *  blacklist is enforced here, with the same rule the mention index uses, so
 *  there is one list and no proxy to keep in sync.
 *
 *  Transport: MCP Streamable HTTP in its stateless JSON-response form — every
 *  POST carries one JSON-RPC message (or a batch) and gets a plain
 *  `application/json` reply. The spec allows a server to answer with JSON
 *  instead of an SSE stream and to decline the optional GET stream (405), so
 *  no session state or SDK is needed for a request/response tool server. */
import { App, TFile, TFolder, normalizePath } from "obsidian";

const PROTOCOL_VERSION = "2025-06-18";
const MAX_READ_CHARS = 200_000;
const MAX_SEARCH_RESULTS = 50;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  run(args: Record<string, unknown>): Promise<string>;
}

type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any };

const str = (description: string) => ({ type: "string", description });

export class VaultMcpServer {
  private tools: ToolDef[];

  constructor(
    private app: App,
    private getBlacklist: () => string[],
  ) {
    this.tools = this.buildTools();
  }

  /** Handles one HTTP request body; returns the JSON reply, or `null` when the
   *  body held only notifications/responses (answered with 202, no body). */
  async handle(body: unknown): Promise<unknown | null> {
    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((m) => this.handleMessage(m)))).filter((r) => r !== null);
      return replies.length ? replies : null;
    }
    return this.handleMessage(body as JsonRpcMessage);
  }

  private async handleMessage(msg: JsonRpcMessage): Promise<unknown | null> {
    if (!msg || typeof msg !== "object" || !msg.method) return null; // a response or junk
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (!isRequest) return null; // notifications/initialized, cancelled, …
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
    switch (msg.method) {
      case "initialize":
        return ok({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "obsidian-vault", version: "1.0.0" },
          instructions:
            "Tools for the user's Obsidian vault. Paths are vault-relative (e.g. `Inbox/idea.md`). " +
            "Prefer `edit` over `write` for changes to existing notes.",
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: this.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: t.readOnly, destructiveHint: !t.readOnly },
          })),
        });
      case "tools/call": {
        const tool = this.tools.find((t) => t.name === msg.params?.name);
        if (!tool) return fail(-32602, `unknown tool: ${msg.params?.name}`);
        try {
          const text = await tool.run(msg.params?.arguments ?? {});
          return ok({ content: [{ type: "text", text }] });
        } catch (err) {
          // Tool failures are results the model can read, not protocol errors.
          return ok({ content: [{ type: "text", text: String((err as Error).message ?? err) }], isError: true });
        }
      }
      default:
        return fail(-32601, `method not found: ${msg.method}`);
    }
  }

  // ---------- path handling ----------

  private isExcluded(path: string): boolean {
    const normPath = path.replace(/\/+$/, "");
    return this.getBlacklist().some((p) => {
      const norm = p.replace(/\/+$/, "");
      return norm && (normPath === norm || normPath.startsWith(norm + "/"));
    });
  }

  /** Normalises a model-supplied path and refuses blacklisted or escaping ones. */
  private safePath(raw: unknown, field = "path"): string {
    if (typeof raw !== "string") throw new Error(`\`${field}\` is required`);
    const trimmed = raw.trim().replace(/^\/+/, "");
    const path = trimmed === "" || trimmed === "." ? "/" : normalizePath(trimmed);
    if (path.split("/").includes("..")) throw new Error(`"${raw}" leaves the vault`);
    if (path !== "/" && this.isExcluded(path)) throw new Error(`"${path}" is excluded from tool access by the vault's folder blacklist`);
    return path;
  }

  private file(raw: unknown): TFile {
    const path = this.safePath(raw);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`not a file: ${path}`);
    return f;
  }

  private async ensureParent(path: string): Promise<void> {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
  }

  // ---------- tools ----------

  private buildTools(): ToolDef[] {
    const vault = this.app.vault;
    return [
      {
        name: "list",
        description: "List the notes and folders directly inside a vault folder. Omit `path` for the vault root.",
        inputSchema: { type: "object", properties: { path: str("Vault-relative folder path") } },
        readOnly: true,
        run: async (args) => {
          const path = this.safePath(args.path ?? "/");
          const folder = path === "/" ? vault.getRoot() : vault.getAbstractFileByPath(path);
          if (!(folder instanceof TFolder)) throw new Error(`not a folder: ${path}`);
          const lines = folder.children
            .filter((c) => !this.isExcluded(c.path))
            .map((c) => (c instanceof TFolder ? `${c.path}/` : c.path))
            .sort();
          return lines.length ? lines.join("\n") : "(empty folder)";
        },
      },
      {
        name: "read",
        description: "Read a note's full Markdown content.",
        inputSchema: { type: "object", properties: { path: str("Vault-relative note path") }, required: ["path"] },
        readOnly: true,
        run: async (args) => {
          const text = await vault.cachedRead(this.file(args.path));
          return text.length > MAX_READ_CHARS ? text.slice(0, MAX_READ_CHARS) + "\n…[truncated]" : text;
        },
      },
      {
        name: "search",
        description: "Case-insensitive text search across all notes. Returns matching paths with the matching lines.",
        inputSchema: { type: "object", properties: { query: str("Text to find") }, required: ["query"] },
        readOnly: true,
        run: async (args) => {
          const query = String(args.query ?? "").trim().toLowerCase();
          if (!query) throw new Error("`query` is required");
          const out: string[] = [];
          for (const f of vault.getMarkdownFiles()) {
            if (out.length >= MAX_SEARCH_RESULTS) break;
            if (this.isExcluded(f.path)) continue;
            const nameHit = f.path.toLowerCase().includes(query);
            const text = await vault.cachedRead(f);
            const hits = text.split("\n").filter((l) => l.toLowerCase().includes(query)).slice(0, 3);
            if (!nameHit && !hits.length) continue;
            out.push([f.path, ...hits.map((l) => `  ${l.trim().slice(0, 200)}`)].join("\n"));
          }
          return out.length ? out.join("\n") : "No matches.";
        },
      },
      {
        name: "write",
        description: "Create a note, or overwrite an existing note's entire content.",
        inputSchema: {
          type: "object",
          properties: { path: str("Vault-relative note path"), content: str("Full Markdown content") },
          required: ["path", "content"],
        },
        readOnly: false,
        run: async (args) => {
          const path = this.safePath(args.path);
          const content = String(args.content ?? "");
          const existing = vault.getAbstractFileByPath(path);
          if (existing instanceof TFile) {
            await vault.modify(existing, content);
            return `Overwrote ${path}`;
          }
          await this.ensureParent(path);
          await vault.create(path, content);
          return `Created ${path}`;
        },
      },
      {
        name: "append",
        description: "Append text to the end of a note, creating it if missing.",
        inputSchema: {
          type: "object",
          properties: { path: str("Vault-relative note path"), content: str("Markdown to append") },
          required: ["path", "content"],
        },
        readOnly: false,
        run: async (args) => {
          const path = this.safePath(args.path);
          const content = String(args.content ?? "");
          const existing = vault.getAbstractFileByPath(path);
          if (existing instanceof TFile) {
            await vault.process(existing, (old) => (old.endsWith("\n") || !old ? old : old + "\n") + content);
            return `Appended to ${path}`;
          }
          await this.ensureParent(path);
          await vault.create(path, content);
          return `Created ${path}`;
        },
      },
      {
        name: "edit",
        description: "Replace one exact occurrence of `old_text` with `new_text` in a note. Fails if `old_text` is missing or ambiguous.",
        inputSchema: {
          type: "object",
          properties: {
            path: str("Vault-relative note path"),
            old_text: str("Exact text to replace (must occur once)"),
            new_text: str("Replacement text"),
          },
          required: ["path", "old_text", "new_text"],
        },
        readOnly: false,
        run: async (args) => {
          const f = this.file(args.path);
          const oldText = String(args.old_text ?? "");
          const newText = String(args.new_text ?? "");
          if (!oldText) throw new Error("`old_text` is required");
          await vault.process(f, (text) => {
            const first = text.indexOf(oldText);
            if (first < 0) throw new Error(`old_text not found in ${f.path}`);
            if (text.indexOf(oldText, first + 1) >= 0) throw new Error(`old_text occurs more than once in ${f.path}; include more context`);
            return text.slice(0, first) + newText + text.slice(first + oldText.length);
          });
          return `Edited ${f.path}`;
        },
      },
      {
        name: "move",
        description: "Move or rename a note or folder. Links to it are updated.",
        inputSchema: {
          type: "object",
          properties: { path: str("Current vault-relative path"), destination: str("New vault-relative path") },
          required: ["path", "destination"],
        },
        readOnly: false,
        run: async (args) => {
          const from = this.safePath(args.path);
          const to = this.safePath(args.destination, "destination");
          const f = vault.getAbstractFileByPath(from);
          if (!f) throw new Error(`not found: ${from}`);
          if (vault.getAbstractFileByPath(to)) throw new Error(`already exists: ${to}`);
          await this.ensureParent(to);
          await this.app.fileManager.renameFile(f, to);
          return `Moved ${from} → ${to}`;
        },
      },
      {
        name: "delete",
        description: "Move a note or folder to the trash (recoverable).",
        inputSchema: { type: "object", properties: { path: str("Vault-relative path") }, required: ["path"] },
        readOnly: false,
        run: async (args) => {
          const path = this.safePath(args.path);
          const f = vault.getAbstractFileByPath(path);
          if (!f) throw new Error(`not found: ${path}`);
          await this.app.fileManager.trashFile(f);
          return `Trashed ${path}`;
        },
      },
    ];
  }
}

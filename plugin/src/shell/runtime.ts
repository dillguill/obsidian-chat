/** Session-level shell runtime: owns the ACP client, the native environment,
 *  the session recorder, and the record identity. The chat view only renders
 *  and calls this; closing the view does not stop the turn (FR-066).
 *
 *  US1 supports local attach only; remote attach arrives with the host relay
 *  in US3 and is refused here with a clear message.
 */
import { App, FileSystemAdapter, Platform } from "obsidian";
import type { AcpDebugInfo, ChatEvent, PendingPermission } from "../acp/types.ts";
import type { NewEntry, SessionStore } from "../session/store.ts";
import type { RecordEntry, SessionHeader } from "../session/record.ts";
import { SessionRecorder } from "../session/recorder.ts";
import { AcpShellClient, type McpServerEntry } from "./acp-client.ts";
import { LocalTransportConnector } from "./local-transport.ts";
import { ObsidianShellEnvironment } from "./environment.ts";
import { VaultService } from "../vault/service.ts";
import { VaultMcpServer } from "../vault/mcp-server.ts";
import { HostServer, createVaultMcpHandler } from "./host-server.ts";
import { mintToken } from "./device-auth.ts";
import type { WriteSnapshot } from "../vault/acp-fs.ts";
import type { ShellAttachConfig } from "./types.ts";

export interface ShellRuntimeSettings {
  shell: ShellAttachConfig;
  sessionStoreFolder: string;
  blacklistFolders: string[];
}

export interface ShellRuntimeOptions {
  app: App;
  settings: () => ShellRuntimeSettings;
  store: () => SessionStore;
  /** Called before spawning, to stop the legacy host/client and avoid a second child. */
  stopLegacy?: () => Promise<void>;
  log?: (message: string) => void;
}

export interface ShellHistory {
  header: SessionHeader;
  entries: RecordEntry[];
}

export class ShellRuntime {
  private app: App;
  private getSettings: () => ShellRuntimeSettings;
  private getStore: () => SessionStore;
  private stopLegacy?: () => Promise<void>;
  private log: (message: string) => void;
  private client: AcpShellClient | null = null;
  private recorder: SessionRecorder | null = null;
  private storeSessionId: string | null = null;
  private environment: ObsidianShellEnvironment | null = null;
  private vaultService: VaultService | null = null;
  /** Loopback MCP listener serving the read-only vault tools (US2). */
  private mcpHost: HostServer | null = null;
  private mcpPort: number | null = null;
  private mcpToken: string | null = null;
  private mcpError: string | null = null;
  private eventListeners = new Set<(event: ChatEvent) => void>();
  private permissionListeners = new Set<(request: PendingPermission) => void>();
  private stateListeners = new Set<() => void>();
  private legacyStopped = false;

  constructor(options: ShellRuntimeOptions) {
    this.app = options.app;
    this.getSettings = options.settings;
    this.getStore = options.store;
    this.stopLegacy = options.stopLegacy;
    this.log = options.log ?? (() => undefined);
  }

  onEvent(cb: (event: ChatEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }
  onPermissionRequest(cb: (request: PendingPermission) => void): () => void {
    this.permissionListeners.add(cb);
    return () => this.permissionListeners.delete(cb);
  }
  onStateChange(cb: () => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  get clientDebugInfo(): AcpDebugInfo | null {
    return this.client?.getDebugInfo() ?? null;
  }

  get recordId(): string | null {
    return this.storeSessionId;
  }

  get isConnected(): boolean {
    return !!this.client && this.client.getState() === "connected";
  }

  get isBusy(): boolean {
    // The client refuses a second prompt locally; the view mirrors that.
    return false;
  }

  /** Whether the harness advertises HTTP MCP support for this attach. */
  get harnessSupportsVaultTools(): boolean {
    return this.client?.getCapabilitiesSnapshot().mcpHttp ?? false;
  }

  /** Native vault tools are unavailable when the listener failed or the
   *  harness did not advertise `mcpCapabilities.http` (contract §6). */
  get vaultToolsAvailable(): boolean {
    return this.harnessSupportsVaultTools && this.mcpPort !== null;
  }

  get vaultToolsError(): string | null {
    return this.mcpError;
  }

  /** The next host-side Undo the UI may offer, if any. */
  pendingUndo(): WriteSnapshot | null {
    return this.environment?.lastSnapshot() ?? null;
  }

  /** Restores the pre-write content of the last harness write. */
  async undoLastWrite(): Promise<WriteSnapshot | null> {
    const restored = (await this.environment?.undoLast()) ?? null;
    this.emitState();
    return restored;
  }

  private emit(event: ChatEvent): void {
    for (const cb of [...this.eventListeners]) {
      try {
        cb(event);
      } catch {
        // View errors must not break the session record.
      }
    }
  }

  private emitState(): void {
    for (const cb of [...this.stateListeners]) {
      try {
        cb();
      } catch {
        // ignored
      }
    }
  }

  private vault(): VaultService {
    if (!this.vaultService) {
      this.vaultService = new VaultService({
        app: this.app,
        blacklist: () => this.getSettings().blacklistFolders,
        storeFolder: () => this.getSettings().sessionStoreFolder,
      });
    }
    return this.vaultService;
  }

  private shellEnvironment(): ObsidianShellEnvironment {
    if (!this.environment) {
      this.environment = new ObsidianShellEnvironment(this.vault(), () => this.emitState());
    }
    return this.environment;
  }

  /** Starts the single loopback listener that serves `/mcp` (US2). The `/acp`
   *  route stays closed until the host relay arrives in US3. */
  private async startVaultTools(): Promise<void> {
    if (!Platform.isDesktopApp) {
      this.mcpError = "native vault tools need the desktop app";
      return;
    }
    if (this.mcpHost) return;
    const vault = this.vault();
    const mcp = new VaultMcpServer({
      vault,
      policy: () => vault.policy(),
      token: () => this.mcpToken,
    });
    const host = new HostServer({
      port: 0,
      devices: () => ({}),
      // The UI's own ACP attach is local in US2, so no device tokens yet.
      localToken: mintToken(),
      mcpHandler: createVaultMcpHandler({ server: mcp, token: () => this.mcpToken }),
      log: (message) => this.log(message),
    });
    try {
      await host.start();
      this.mcpHost = host;
      this.mcpPort = host.boundPort;
      this.mcpError = null;
    } catch (err) {
      this.mcpError = `vault tools unavailable: ${String((err as Error).message ?? err)}`;
      this.log(this.mcpError);
    }
  }

  /** The `mcpServers` entry for this session, or null when unavailable. */
  private mcpEndpoint(): McpServerEntry | null {
    if (!this.mcpPort || !this.mcpToken) return null;
    return {
      name: "vault",
      type: "http",
      url: `http://127.0.0.1:${this.mcpPort}/mcp`,
      headers: [{ name: "Authorization", value: `Bearer ${this.mcpToken}` }],
    };
  }

  private attachCwd(): string {
    if (!Platform.isDesktopApp) throw new Error("local attach requires the desktop app");
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("this vault has no filesystem path");
    const shell = this.getSettings().shell;
    return shell.cwd?.trim() || adapter.getBasePath();
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const shell = this.getSettings().shell;
    if (shell.mode !== "local") {
      throw new Error("remote attach arrives with the host relay (US3); set the shell mode to Local for now");
    }
    if (!shell.command.trim()) throw new Error("no harness command is configured");
    if (this.stopLegacy && !this.legacyStopped) {
      this.legacyStopped = true;
      await this.stopLegacy().catch((err) => this.log(`legacy host stop failed: ${String(err)}`));
    }
    const cwd = this.attachCwd();
    const environment = this.shellEnvironment();
    // Vault tools need the listener before session/new advertises the entry.
    await this.startVaultTools();
    this.mcpToken = this.mcpPort ? mintToken() : null;
    const client = new AcpShellClient({
      mode: "local",
      label: redactLabel(shell.command),
      cwd,
      environment,
      mcpServer: () => this.mcpEndpoint(),
      connector: new LocalTransportConnector({
        command: shell.command,
        cwd,
        onStderr: (line) => this.log(`harness stderr: ${line}`),
      }),
      onLog: this.log,
    });
    this.client = client;
    client.onEvent((event) => {
      void this.recorder?.recordEvent(event).catch((err) => this.log(`record append failed: ${String(err)}`));
      this.emit(event);
    });
    client.onPermissionRequest((request) => {
      void this.recorder
        ?.recordPermissionRequest(request.requestId, request.toolCall, request.options)
        .catch((err) => this.log(`permission record failed: ${String(err)}`));
      for (const cb of [...this.permissionListeners]) {
        try {
          cb(request);
        } catch {
          // ignored
        }
      }
    });
    client.onStateChange(() => this.emitState());
    await client.connect();
    const store = this.getStore();
    const id = await store.createSession({
      deviceId: "__local__",
      commandLabel: redactLabel(shell.command),
      commandFingerprint: fingerprint(shell.command, cwd),
      cwd,
      protocolVersion: 1,
      capabilities: client.getCapabilitiesSnapshot(),
      harnessSessionId: client.getSessionId(),
      title: "ACP session",
    });
    this.storeSessionId = id;
    this.recorder = new SessionRecorder(store, id);
    this.emitState();
  }

  async send(text: string): Promise<void> {
    if (!this.client) await this.connect();
    const client = this.client!;
    const blocks = [{ type: "text" as const, text }];
    await this.recorder?.recordPrompt(blocks);
    await client.prompt(blocks);
  }

  async cancel(): Promise<void> {
    await this.client?.cancel();
  }

  async respondPermission(requestId: string, optionId: string | null): Promise<void> {
    await this.client?.respondPermission(requestId, optionId);
    await this.recorder?.recordPermissionResponse(
      requestId,
      optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
    );
  }

  async history(): Promise<ShellHistory | null> {
    if (!this.storeSessionId) return null;
    const read = await this.getStore().read(this.storeSessionId);
    return { header: read.header, entries: read.entries };
  }

  /** Explicit New Session: end the harness session and drop the record binding. */
  async reset(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.recorder = null;
    this.storeSessionId = null;
    this.mcpToken = null;
    if (client) await client.close().catch(() => undefined);
    if (this.mcpHost) {
      await this.mcpHost.close().catch(() => undefined);
      this.mcpHost = null;
      this.mcpPort = null;
    }
    this.emitState();
  }

  async close(): Promise<void> {
    await this.reset();
    this.vaultService?.dispose();
    this.vaultService = null;
    this.environment = null;
  }
}

/** Never store a secret that a user may have embedded in the command line. */
export function redactLabel(command: string): string {
  return command.replace(/((?:token|key|secret|password|api[_-]?key)\s*[=:]\s*)\S+/gi, "$1***");
}

/** FNV-1a 64-bit (as two 32-bit halves) over argv + cwd — deterministic, sync. */
export function fingerprint(command: string, cwd: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  const input = `${command}\0${cwd}`;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16);
}

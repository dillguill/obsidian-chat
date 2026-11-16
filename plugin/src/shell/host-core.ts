/** Host core: the single owner of the harness child, the vault environment,
 *  the read-only MCP endpoint, the host-owned store, and the one network
 *  listener (FR-001/FR-005/FR-006/FR-008/FR-026/FR-053).
 *
 *  Desktop-only module: it is only instantiated by the shell runtime on a
 *  desktop install. Paired devices and the host's own UI both reach the same
 *  listener over ACP/WebSocket; this class never serves the vault to a remote
 *  device (vault access stays on the host↔harness ACP client).
 */
import { App, FileSystemAdapter, Platform } from "obsidian";
import type { SessionStore, StoreAdapter } from "../session/store.ts";
import { ResumeRegistry } from "../session/resume.ts";
import { VaultService } from "../vault/service.ts";
import { VaultMcpServer, type VaultWriter } from "../vault/mcp-server.ts";
import { AcpShellClient } from "./acp-client.ts";
import { HostBridge } from "./host-bridge.ts";
import { HostRelay } from "./host-relay.ts";
import { HostServer, createVaultMcpHandler } from "./host-server.ts";
import { mintToken } from "./device-auth.ts";
import { fingerprint, redactLabel } from "./identity.ts";
import { LocalTransportConnector } from "./local-transport.ts";
import { backoffDelay } from "./transport.ts";
import { HARNESS_RESTART_ATTEMPTS } from "../session/limits.ts";
import { ObsidianShellEnvironment } from "./environment.ts";
import type { ShellAttachConfig } from "./types.ts";

export interface HostCoreSettings {
  shell: ShellAttachConfig;
  sessionStoreFolder: string;
  blacklistFolders: string[];
  /** Tailscale logins allowed through Serve ([] = any tailnet user). */
  allowedTailscaleUsers: string[];
}

export interface HostCoreOptions {
  app: App;
  settings: () => HostCoreSettings;
  store: () => SessionStore;
  /** Where the store keeps its files (the registry lives beside the records). */
  storage?: () => { adapter: StoreAdapter; folder: string };
  /** Runs before the listener starts (moves old records out of the vault). */
  beforeStart?: () => Promise<void>;
  /** Stops the legacy host/client before the one harness child is spawned. */
  stopLegacy?: () => Promise<void>;
  log?: (message: string) => void;
}

export class HostCore {
  private opts: HostCoreOptions;
  private log: (message: string) => void;
  private vaultService: VaultService | null = null;
  private environment: ObsidianShellEnvironment | null = null;
  private harness: AcpShellClient | null = null;
  private server: HostServer | null = null;
  private relay: HostRelay | null = null;
  private bridge: HostBridge | null = null;
  private registry: ResumeRegistry | null = null;
  private mcp: VaultMcpServer | null = null;
  private localTokenValue = mintToken();
  private mcpTokenValue = mintToken();
  private legacyStopped = false;
  private stopping = false;
  private harnessRestartAttempts = 0;
  private harnessRestartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: HostCoreOptions) {
    this.opts = options;
    this.log = options.log ?? (() => undefined);
  }

  get localToken(): string {
    return this.localTokenValue;
  }

  get mcpToken(): string {
    return this.mcpTokenValue;
  }

  get boundPort(): number {
    return this.server?.boundPort ?? this.settings().shell.port ?? 8765;
  }

  /** Loopback ACP endpoint for the host's own view (per-run token). */
  wsUrl(): string {
    return `ws://127.0.0.1:${this.boundPort}/acp`;
  }

  vaultRoot(): string {
    const adapter = this.opts.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("this vault has no filesystem path");
    return adapter.getBasePath();
  }

  private settings(): HostCoreSettings {
    return this.opts.settings();
  }

  private vault(): VaultService {
    if (!this.vaultService) {
      this.vaultService = new VaultService({
        app: this.opts.app,
        blacklist: () => this.settings().blacklistFolders,
        storeFolder: () => this.settings().sessionStoreFolder,
      });
    }
    return this.vaultService;
  }

  private shellEnvironment(): ObsidianShellEnvironment {
    if (!this.environment) this.environment = new ObsidianShellEnvironment(this.vault());
    return this.environment;
  }

  /** Vault MCP entry for one chat session: the session key routes write
   *  approvals to the device that owns the conversation. */
  private mcpEntry(sessionKey?: string) {
    if (!this.server) return null;
    const headers = [{ name: "Authorization", value: `Bearer ${this.mcpTokenValue}` }];
    if (sessionKey) headers.push({ name: "X-Obsidian-Chat-Session", value: sessionKey });
    return {
      name: "vault",
      type: "http" as const,
      url: `http://127.0.0.1:${this.boundPort}/mcp`,
      headers,
    };
  }

  /** Host side of the MCP write tools: approval on the owning device, then a
   *  snapshotted write through the same environment ACP fs writes use. */
  private vaultWriter(): VaultWriter {
    return {
      exists: (relPath) => !!this.vault().fileFor(relPath),
      write: async (relPath, content) => {
        const env = this.shellEnvironment();
        const absolute = `${this.vaultRoot().replace(/\/+$/, "")}/${relPath}`;
        await env.snapshotBeforeWrite(absolute);
        await env.writeTextFile(absolute, content);
      },
      approve: async (change, context) => {
        const bridge = this.bridge;
        if (!bridge || !context.session) return false;
        return bridge.approveVaultChange(context.session, change);
      },
    };
  }

  /** Starts the single listener (ACP + loopback MCP). The harness child is
   *  spawned on the first session, not before. */
  async start(): Promise<void> {
    if (this.server) return;
    if (!Platform.isDesktopApp) throw new Error("host mode is desktop-only");
    const settings = this.settings();
    this.stopping = false;
    if (this.opts.stopLegacy && !this.legacyStopped) {
      this.legacyStopped = true;
      await this.opts.stopLegacy().catch((err) => this.log(`legacy host stop failed: ${String(err)}`));
    }
    const mcp = new VaultMcpServer({
      vault: this.vault(),
      writer: this.vaultWriter(),
      policy: () => this.vault().policy(),
      token: () => this.mcpTokenValue,
    });
    this.mcp = mcp;
    await this.opts.beforeStart?.();
    const storage = this.opts.storage?.() ?? {
      adapter: this.opts.app.vault.adapter as unknown as StoreAdapter,
      folder: settings.sessionStoreFolder || ".chat/sessions",
    };
    const registry = new ResumeRegistry(storage.adapter, storage.folder);
    await registry.load();
    this.registry = registry;
    const bridge = new HostBridge({
      store: () => this.opts.store(),
      ensureHarness: () => this.ensureHarness(),
      harness: () => this.harness,
      vaultRoot: () => this.vaultRoot(),
      command: () => ({
        label: redactLabel(settings.shell.command),
        fingerprint: fingerprint(settings.shell.command, this.vaultRoot()),
        command: settings.shell.command,
      }),
      registry,
      mcpEntry: (sessionKey) => this.mcpEntry(sessionKey),
      log: this.log,
    });
    this.bridge = bridge;
    const relay = new HostRelay({ bridge, log: this.log });
    this.relay = relay;
    const server = new HostServer({
      port: settings.shell.port ?? 8765,
      host: "127.0.0.1",
      localToken: this.localTokenValue,
      identity: { allowedUsers: () => this.settings().allowedTailscaleUsers ?? [] },
      mcpHandler: createVaultMcpHandler({ server: mcp, token: () => this.mcpTokenValue }),
      onAcpConnection: (socket, deviceId) => relay.attach(socket, deviceId),
      log: this.log,
    });
    await server.start();
    this.server = server;
    this.log(`host core listening on 127.0.0.1:${server.boundPort} (publish with: tailscale serve --bg --https=9443 ${server.boundPort})`);
  }

  /** Lazily connects the single harness child and wires the relay bridge. */
  async ensureHarness(): Promise<AcpShellClient> {
    if (this.harness) return this.harness;
    // Concurrent callers (two devices/views creating sessions at once) share
    // one spawn: there is exactly one harness child.
    if (!this.harnessStarting) {
      this.harnessStarting = this.spawnHarness().finally(() => {
        this.harnessStarting = null;
      });
    }
    return this.harnessStarting;
  }

  private harnessStarting: Promise<AcpShellClient> | null = null;

  private async spawnHarness(): Promise<AcpShellClient> {
    if (!Platform.isDesktopApp) throw new Error("the harness can only be started on desktop");
    const settings = this.settings();
    const cwd = settings.shell.cwd?.trim() || this.vaultRoot();
    const command = settings.shell.command.trim();
    if (!command) throw new Error("no harness command is configured");
    const client = new AcpShellClient({
      mode: "local",
      label: redactLabel(command),
      cwd,
      environment: this.shellEnvironment(),
      mcpServer: () => this.mcpEntry(),
      connector: new LocalTransportConnector({
        command,
        cwd,
        onStderr: (line) => this.log(`harness stderr: ${line}`),
      }),
      autoSession: false,
      onLog: this.log,
      onTransportLost: (reason) => {
        this.log(`harness transport lost: ${reason}`);
        this.harness = null;
        this.scheduleHarnessRestart(reason);
      },
    });
    await client.connect();
    this.harness = client;
    this.bridge?.attachHarness(client);
    this.log("harness attached");
    return client;
  }

  /** Restart the single harness child with bounded backoff after an unexpected
   *  exit (FR-003). A deliberate stop never respawns. */
  private scheduleHarnessRestart(reason: string): void {
    if (this.stopping) return;
    if (this.harnessRestartAttempts >= HARNESS_RESTART_ATTEMPTS) {
      this.log(`harness restart budget exhausted after ${HARNESS_RESTART_ATTEMPTS} attempts (${reason})`);
      return;
    }
    const delay = backoffDelay(this.harnessRestartAttempts);
    this.harnessRestartAttempts += 1;
    if (this.harnessRestartTimer) clearTimeout(this.harnessRestartTimer);
    this.harnessRestartTimer = setTimeout(() => {
      this.harnessRestartTimer = null;
      void this.restartHarnessChild(reason);
    }, delay);
    this.harnessRestartTimer.unref?.();
  }

  private async restartHarnessChild(reason: string): Promise<void> {
    if (this.stopping) return;
    try {
      const client = await this.ensureHarness();
      this.bridge?.attachHarness(client);
      this.harnessRestartAttempts = 0;
      this.log(`harness restarted after ${reason}`);
    } catch (err) {
      this.log(`harness restart failed: ${String(err)}`);
      this.scheduleHarnessRestart(reason);
    }
  }

  /** Host-side undo surface for harness writes (FR-021/FR-072). */
  lastSnapshot(): import("../vault/acp-fs.ts").WriteSnapshot | null {
    return this.environment?.lastSnapshot() ?? null;
  }

  async undoLast(): Promise<import("../vault/acp-fs.ts").WriteSnapshot | null> {
    return (await this.environment?.undoLast()) ?? null;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.harnessRestartTimer) {
      clearTimeout(this.harnessRestartTimer);
      this.harnessRestartTimer = null;
    }
    if (this.registry) {
      for (const row of this.registry.all()) {
        if (row.state === "live") this.registry.mark(row.sessionId, "detached");
      }
      await this.registry.flush().catch(() => undefined);
    }
    this.registry = null;
    await this.relay?.close().catch(() => undefined);
    this.relay = null;
    this.bridge = null;
    await this.server?.close().catch(() => undefined);
    this.server = null;
    await this.harness?.close().catch(() => undefined);
    this.harness = null;
    this.vaultService?.dispose();
    this.vaultService = null;
    this.environment = null;
    this.mcp = null;
  }
}

/** Per-device ACP relay: the host is an ACP server toward paired devices and an
 *  ACP client toward its harness (FR-005/FR-008/FR-011/FR-013).
 *
 *  Transport wiring follows research R3: one SDK `AcpServer`, a per-upgrade
 *  `prepareWebSocketUpgrade({ createAgent })` factory carrying the device id,
 *  then `accept(ws)`. Session/update/permission forwarding is delegated to a
 *  `RelayBridge` implemented by the host runtime (filled in US3).
 */
import {
  PROTOCOL_VERSION,
  agent,
  methods,
  type AgentCapabilities,
  type AgentContext,
  type CloseSessionRequest,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import { AcpServer } from "@agentclientprotocol/sdk/experimental/server";
import type { WebSocket } from "ws";

export interface RelayBridge {
  /** Capabilities this host can actually honour (load/list at minimum). */
  capabilities(): AgentCapabilities;
  /** Binds the device's ACP connection so the relay can send updates and
   *  permission requests to the owning device only. */
  bindDevice?(deviceId: string, context: AgentContext): void;
  unbindDevice?(deviceId: string): void;
  initialize(deviceId: string, request: InitializeRequest): Promise<InitializeResponse>;
  newSession(deviceId: string, request: NewSessionRequest): Promise<NewSessionResponse>;
  loadSession(deviceId: string, request: LoadSessionRequest): Promise<LoadSessionResponse>;
  resumeSession(deviceId: string, request: ResumeSessionRequest): Promise<ResumeSessionResponse>;
  listSessions(deviceId: string): Promise<ListSessionsResponse>;
  prompt(deviceId: string, request: PromptRequest): Promise<PromptResponse>;
  cancel(deviceId: string, request: { sessionId: string }): Promise<void>;
  closeSession(deviceId: string, request: CloseSessionRequest): Promise<void>;
  setMode(deviceId: string, request: SetSessionModeRequest): Promise<SetSessionModeResponse>;
  setConfigOption(
    deviceId: string,
    request: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse>;
}

export interface HostRelayOptions {
  bridge: RelayBridge;
  log?: (message: string) => void;
}

export class HostRelay {
  private acpServer: AcpServer;
  private bridge: RelayBridge;
  private log: (message: string) => void;

  constructor(options: HostRelayOptions) {
    this.bridge = options.bridge;
    this.log = options.log ?? (() => undefined);
    this.acpServer = new AcpServer({ createAgent: () => this.agentFor("__local__") });
  }

  /** Attaches one authenticated WebSocket to a device-scoped ACP connection. */
  attach(socket: WebSocket, deviceId: string): void {
    const prepared = this.acpServer.prepareWebSocketUpgrade({
      createAgent: () => this.agentFor(deviceId),
    });
    prepared.accept(socket as never);
  }

  private agentFor(deviceId: string) {
    const bridge = this.bridge;
    return agent({ name: "obsidian-chat" })
      .onConnect((connection) => {
        bridge.bindDevice?.(deviceId, connection.client);
        connection.closed
          .then(() => bridge.unbindDevice?.(deviceId))
          .catch(() => bridge.unbindDevice?.(deviceId));
      })
      .onRequest(methods.agent.initialize, async (ctx) => {
        const request = ctx.params as InitializeRequest;
        if (request.protocolVersion !== PROTOCOL_VERSION) {
          throw new Error(`unsupported protocol version ${request.protocolVersion}`);
        }
        return bridge.initialize(deviceId, request);
      })
      .onRequest(methods.agent.session.new, (ctx) => bridge.newSession(deviceId, ctx.params))
      .onRequest(methods.agent.session.load, (ctx) => bridge.loadSession(deviceId, ctx.params))
      .onRequest(methods.agent.session.resume, (ctx) => bridge.resumeSession(deviceId, ctx.params))
      .onRequest(methods.agent.session.list, () => bridge.listSessions(deviceId))
      .onRequest(methods.agent.session.prompt, (ctx) => bridge.prompt(deviceId, ctx.params))
      .onRequest(methods.agent.session.close, (ctx) => bridge.closeSession(deviceId, ctx.params).then(() => ({})))
      .onRequest(methods.agent.session.setMode, (ctx) => bridge.setMode(deviceId, ctx.params))
      .onRequest(methods.agent.session.setConfigOption, (ctx) => bridge.setConfigOption(deviceId, ctx.params))
      .onNotification(methods.agent.session.cancel, (ctx) => bridge.cancel(deviceId, ctx.params));
  }

  async close(): Promise<void> {
    await this.acpServer.close();
  }
}

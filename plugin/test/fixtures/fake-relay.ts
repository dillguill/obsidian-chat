/** Test fixture: a real host listener + relay with a scripted ACP bridge.
 *
 *  Exercises the actual `HostServer` auth/heartbeat path, the actual
 *  `HostRelay`/SDK server transport, and a fake bridge that behaves like the
 *  host bridge for session/list/load/prompt. No Obsidian, no harness child.
 */
import {
  PROTOCOL_VERSION,
  RequestError,
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
import { HostRelay, type RelayBridge } from "../../src/shell/host-relay.ts";
import { HostServer } from "../../src/shell/host-server.ts";

export class FakeRelayBridge implements RelayBridge {
  devices = new Map<string, AgentContext>();
  sessions = new Map<string, { deviceId: string; cwd: string; title: string }>();
  created = 0;
  prompted: Array<{ deviceId: string; sessionId: string; text: string }> = [];
  loadRequests: Array<Record<string, unknown>> = [];
  private counter = 0;

  capabilities(): AgentCapabilities {
    return {
      loadSession: true,
      sessionCapabilities: { list: {} } as never,
    };
  }

  bindDevice(deviceId: string, context: AgentContext): void {
    this.devices.set(deviceId, context);
  }

  unbindDevice(deviceId: string): void {
    this.devices.delete(deviceId);
  }

  async initialize(_deviceId: string, _request: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: "fake-host", version: "0.0.0" },
      agentCapabilities: this.capabilities(),
    };
  }

  async newSession(deviceId: string, request: NewSessionRequest): Promise<NewSessionResponse> {
    this.created += 1;
    const sessionId = `host_${++this.counter}`;
    this.sessions.set(sessionId, { deviceId, cwd: request.cwd, title: `Session ${this.counter}` });
    return { sessionId };
  }

  async loadSession(deviceId: string, request: LoadSessionRequest): Promise<LoadSessionResponse> {
    this.loadRequests.push({ deviceId, ...(request as unknown as Record<string, unknown>) });
    const context = this.devices.get(deviceId);
    if (context) {
      await context.notify(methods.client.session.update, {
        sessionId: request.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "replayed from record" } },
        _meta: { "obsidian-chat/seq": 3, "obsidian-chat/replay": true },
      });
    }
    return {};
  }

  async resumeSession(_deviceId: string, _request: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    throw new Error("not advertised");
  }

  async listSessions(deviceId: string): Promise<ListSessionsResponse> {
    const sessions = [...this.sessions.entries()]
      .filter(([, session]) => session.deviceId === deviceId)
      .map(([sessionId, session]) => ({
        sessionId,
        cwd: session.cwd,
        title: session.title,
        updatedAt: new Date(1_700_000_000_000).toISOString(),
        _meta: { "obsidian-chat/resume": "load-only", "obsidian-chat/degraded": false },
      }));
    return { sessions };
  }

  async prompt(deviceId: string, request: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(request.sessionId);
    if (!session || session.deviceId !== deviceId) {
      throw new RequestError(-32003, "policy: session is not owned by this device");
    }
    const text = request.prompt
      .filter((block) => (block as { type?: string }).type === "text")
      .map((block) => String((block as { text?: string }).text ?? ""))
      .join("");
    this.prompted.push({ deviceId, sessionId: request.sessionId, text });
    const context = this.devices.get(deviceId);
    if (context) {
      await context.notify(methods.client.session.update, {
        sessionId: request.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `echo: ${text}` } },
        _meta: { "obsidian-chat/seq": 1 },
      });
    }
    return { stopReason: "end_turn" };
  }

  async cancel(_deviceId: string, _request: { sessionId: string }): Promise<void> {
    // no-op
  }

  async closeSession(_deviceId: string, _request: CloseSessionRequest): Promise<void> {
    // no-op
  }

  async setMode(_deviceId: string, _request: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    return {} as SetSessionModeResponse;
  }

  async setConfigOption(
    _deviceId: string,
    _request: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    return { configOptions: [] } as SetSessionConfigOptionResponse;
  }
}

export interface TestHost {
  server: HostServer;
  relay: HostRelay;
  bridge: FakeRelayBridge;
  url: string;
  localToken: string;
  close(): Promise<void>;
}

export async function startTestHost(options?: {
  devices?: Record<string, string>;
  localToken?: string;
  /** Enables Tailscale Serve identity auth with this allow-list. */
  allowedUsers?: string[];
}): Promise<TestHost> {
  const devices = options?.devices ?? { phone: "phone-token" };
  const localToken = options?.localToken ?? "local-token";
  const bridge = new FakeRelayBridge();
  const relay = new HostRelay({ bridge });
  const server = new HostServer({
    port: 0,
    devices: () => devices,
    localToken,
    ...(options?.allowedUsers ? { identity: { allowedUsers: () => options.allowedUsers ?? [] } } : {}),
    mcpHandler: async (_req, res) => {
      res.writeHead(204);
      res.end();
    },
    onAcpConnection: (socket, deviceId) => relay.attach(socket, deviceId),
    heartbeatMs: 60_000,
  });
  await server.start();
  return {
    server,
    relay,
    bridge,
    url: `ws://127.0.0.1:${server.boundPort}/acp`,
    localToken,
    async close() {
      await relay.close();
      await server.close();
    },
  };
}

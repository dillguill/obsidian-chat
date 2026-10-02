/** Minimal JSON-RPC 2.0 peer over newline-delimited JSON — the ACP stdio
 *  transport. Hand-rolled because the host only needs request/notify plus two
 *  inbound handlers, and the full ACP SDK would add ~1 MB of schema
 *  validation to the plugin bundle. */
import type { Readable, Writable } from "stream";

type Handler = (params: unknown) => unknown;

export class JsonRpcPeer {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private requestHandlers = new Map<string, Handler>();
  private notificationHandlers = new Map<string, Handler>();
  private buf = "";
  private closed = false;

  constructor(
    input: Readable,
    private output: Writable,
    private log: (msg: string) => void,
  ) {
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.onData(chunk));
    input.on("close", () => this.close(new Error("connection closed")));
  }

  onRequest(method: string, handler: Handler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: Handler): void {
    this.notificationHandlers.set(method, handler);
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("connection closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.closed) this.send({ jsonrpc: "2.0", method, params });
  }

  close(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private send(msg: unknown): void {
    this.output.write(JSON.stringify(msg) + "\n");
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        this.log(`non-JSON line from harness: ${line.slice(0, 200)}`);
        continue;
      }
      void this.dispatch(msg);
    }
  }

  private async dispatch(msg: any): Promise<void> {
    if (msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message ?? "request failed"), { data: msg.error.data }));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id === undefined || msg.id === null) {
      this.notificationHandlers.get(msg.method)?.(msg.params);
      return;
    }
    const handler = this.requestHandlers.get(msg.method);
    if (!handler) {
      this.send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
      return;
    }
    try {
      this.send({ jsonrpc: "2.0", id: msg.id, result: (await handler(msg.params)) ?? null });
    } catch (err) {
      this.send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String((err as Error).message ?? err) } });
    }
  }
}

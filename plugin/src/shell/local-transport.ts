/** Desktop-only local ACP transport: spawn exactly one harness child and speak
 *  ACP over its stdio via the SDK's `ndJsonStream` (FR-001/FR-003).
 *
 *  Obsidian-free on purpose: the caller guards with `Platform.isDesktopApp`.
 *  Node built-ins are loaded lazily so the mobile bundle never evaluates them.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import { backoffDelay, type ShellTransport, type TransportConnector } from "./transport.ts";
import { splitCommand } from "./identity.ts";

export { splitCommand };

import { loadNodeModule } from "./node.ts";

export function respawnDelay(attempt: number): number {
  return backoffDelay(attempt);
}

export class LocalTransport implements ShellTransport {
  readonly label: string;
  readonly stream: Stream;
  private child: ChildProcessWithoutNullStreams;
  private callbacks = new Set<(reason: string) => void>();
  private closed = false;

  private constructor(
    label: string,
    child: ChildProcessWithoutNullStreams,
    nodeStream: typeof import("node:stream"),
  ) {
    this.label = label;
    this.child = child;
    const output = nodeStream.Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>;
    const input = nodeStream.Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>;
    this.stream = ndJsonStream(output, input);
    child.on("exit", (code, signal) => {
      if (this.closed) return;
      const reason = signal ? `harness exited (${signal})` : `harness exited (code ${code ?? "unknown"})`;
      for (const cb of [...this.callbacks]) cb(reason);
    });
    child.on("error", (err) => {
      if (this.closed) return;
      for (const cb of [...this.callbacks]) cb(`harness error: ${err.message}`);
    });
  }

  static async spawn(options: {
    command: string;
    cwd: string;
    env?: Record<string, string>;
    onStderr?: (line: string) => void;
  }): Promise<LocalTransport> {
    const argv = splitCommand(options.command);
    if (!argv.length) throw new Error("harness command is empty");
    const cp = await loadNodeModule<typeof import("node:child_process")>("node:child_process");
    const nodeStream = await loadNodeModule<typeof import("node:stream")>("node:stream");
    const child = cp.spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // npm-installed CLIs are `.cmd` shims on Windows and only resolve through a shell.
      shell: process.platform === "win32",
      env: { ...process.env, ...(options.env ?? {}), PATH: harnessPath(process.env.PATH ?? "") },
    });
    const transport = new LocalTransport(argv[0], child, nodeStream);
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trimEnd();
      if (text) options.onStderr?.(text);
    });
    return transport;
  }

  onClose(cb: (reason: string) => void): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (child.exitCode !== null || child.killed) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}

/** Extra PATH entries used by packaged Obsidian installs on macOS/Linux. */
export function harnessPath(original: string): string {
  const extra = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    ...(process.env.HOME ? [`${process.env.HOME}/.local/bin`, `${process.env.HOME}/.opencode/bin`, `${process.env.HOME}/.npm-global/bin`] : []),
  ];
  return [original, ...extra].filter(Boolean).join(":");
}

export class LocalTransportConnector implements TransportConnector {
  private options: { command: string; cwd: string; env?: Record<string, string>; onStderr?: (line: string) => void };
  constructor(options: { command: string; cwd: string; env?: Record<string, string>; onStderr?: (line: string) => void }) {
    this.options = options;
  }
  async connect(): Promise<ShellTransport> {
    return LocalTransport.spawn(this.options);
  }
}

/** Transport seam: one ACP stream plus lifecycle hooks. */
import type { Stream } from "@agentclientprotocol/sdk";

export interface ShellTransport {
  /** Non-secret label for status surfaces (never contains a token). */
  readonly label: string;
  readonly stream: Stream;
  close(): Promise<void>;
  /** Called when the transport dies unexpectedly (not after an explicit close). */
  onClose(cb: (reason: string) => void): () => void;
}

export interface TransportConnector {
  connect(): Promise<ShellTransport>;
}

/** Bounded exponential backoff for reconnects/respawns (1s → 15s). */
export function backoffDelay(attempt: number, baseMs = 1_000, maxMs = 15_000): number {
  const n = Math.max(0, Math.min(attempt, 10));
  return Math.min(maxMs, baseMs * 2 ** n);
}

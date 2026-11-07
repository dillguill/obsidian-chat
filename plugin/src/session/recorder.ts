/** Records a client's event stream into the host-owned JSONL session record.
 *
 *  This runs at the session level, not the view level: closing the chat tab does
 *  not stop the append stream (FR-066), and the record is the durable transcript.
 */
import type { ChatEvent } from "../acp/types.ts";
import type { NewEntry, SessionStore } from "./store.ts";
import type { PromptEntry } from "./record.ts";

export class SessionRecorder {
  private store: SessionStore;
  private sessionId: string;
  private turnNumber = 0;

  constructor(store: SessionStore, sessionId: string) {
    this.store = store;
    this.sessionId = sessionId;
  }

  get recordId(): string {
    return this.sessionId;
  }

  async recordPrompt(blocks: unknown[]): Promise<void> {
    this.turnNumber += 1;
    const entry: NewEntry = {
      kind: "prompt",
      turn: this.turnNumber,
      blocks,
      textChars: JSON.stringify(blocks).length,
    } satisfies Omit<PromptEntry, "seq" | "ts" | "v">;
    await this.store.append(this.sessionId, entry);
  }

  async recordEvent(event: ChatEvent): Promise<void> {
    if (event.update) {
      const payload = event.update;
      await this.store.append(this.sessionId, {
        kind: "update",
        turn: event.turnNumber ?? this.turnNumber,
        sessionUpdate: payload.type,
        payload,
        late: event.late || undefined,
      } as NewEntry);
      return;
    }
    if (event.turn) {
      await this.store.append(this.sessionId, {
        kind: "turn",
        turn: event.turn.number,
        stopReason: event.turn.stopReason,
        interrupted: event.turn.interrupted || undefined,
      } as NewEntry);
      this.turnNumber = Math.max(this.turnNumber, event.turn.number);
      return;
    }
    if (event.error) {
      await this.store.append(this.sessionId, {
        kind: "error",
        scope: (event.error.scope as never) ?? "harness",
        message: event.error.message,
      } as NewEntry);
    }
  }

  async recordPermissionRequest(requestId: string, toolCall: unknown, options: unknown[]): Promise<void> {
    await this.store.append(this.sessionId, {
      kind: "permission_request",
      turn: this.turnNumber || 1,
      requestId,
      toolCall,
      options,
    } as NewEntry);
  }

  async recordPermissionResponse(
    requestId: string,
    outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" },
    reason?: string,
  ): Promise<void> {
    await this.store.append(this.sessionId, {
      kind: "permission_response",
      requestId,
      outcome,
      reason,
    } as NewEntry);
  }
}

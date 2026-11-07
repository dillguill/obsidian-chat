/** Permission request model (FR-034…FR-038).
 *
 *  The shell never invents options and never decides on its own: it renders the
 *  harness's real tool call and exactly the options the harness offered, and
 *  returns the selected option id verbatim (or `cancelled` on teardown).
 */
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { PendingPermission, PermissionOptionView, ToolCallView } from "./types.ts";
import { mapSessionUpdate } from "./session-update.ts";

export function toPendingPermission(
  requestId: string,
  request: RequestPermissionRequest,
): PendingPermission {
  const mapped = mapSessionUpdate({ sessionUpdate: "tool_call_update", ...request.toolCall } as never);
  const toolCall: ToolCallView =
    mapped && mapped.type === "tool_call" ? mapped.toolCall : { toolCallId: request.toolCall.toolCallId };
  const options: PermissionOptionView[] = (request.options ?? []).map((o) => ({
    optionId: o.optionId,
    name: o.name,
    kind: o.kind,
  }));
  return { requestId, sessionId: request.sessionId, toolCall, options };
}

export function selectOption(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: "selected", optionId } };
}

export function cancelledPermission(): RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } };
}

/** The option the user's choice resolves to, or null for cancellation.
 *  No option id is fabricated: an empty option list can only be cancelled. */
export function decidePermission(
  options: PermissionOptionView[],
  optionId: string | null,
): RequestPermissionResponse {
  if (optionId && options.some((o) => o.optionId === optionId)) return selectOption(optionId);
  return cancelledPermission();
}

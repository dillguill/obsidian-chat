/** Inline, non-blocking approval card for one ACP-proposed vault write
 *  (`session/request_permission`) — specs/002-acp-only-chat-ux, User Story 2.
 *
 *  Renders directly in the chat transcript instead of a blocking `Modal`.
 *  Checked against the reference plugin and Obsidian Copilot Agent (research.md R3):
 *  both approve/reject per call, never batch multiple proposed writes into
 *  one "approve all" control and never allow inline-editing the proposed
 *  content (ACP's `RequestPermissionResponse` only supports picking one of
 *  the harness's offered options — there's no field for edited content).
 *
 *  Always interactive (Approve/Reject) — there's no plugin-owned "plan mode"
 *  auto-reject branch here. Agent mode is now entirely harness-declared
 *  (specs/002-acp-only-chat-ux R5): if a harness's active mode means it
 *  won't propose a write, the plugin simply never receives a
 *  `request_permission` for it, so this card never needs to know what mode
 *  is active — it always shows the same real decision to the user.
 *
 *  `WritePreview`/`ApprovalDecision` used to live in the plugin's now-removed
 *  local BYOK tool-execution stack — this is now their only home, since every
 *  write is executed harness-side and this card only ever renders what the
 *  harness proposed. */
import type { PendingPermission, ToolContentView } from "../acp/types.ts";

export interface WritePreview {
  action: string;
  path: string;
  /** Real diff lines parsed from ACP's ToolCallContent (acp/client.ts's
   *  toolCallContentLines) — added: +, removed: -, unchanged: two spaces. */
  diff?: string[];
  summary: string;
}

export interface ApprovalDecision {
  allowed: boolean;
  remember?: boolean; // "always allow this action"
}

export interface ApprovalCardHandle {
  /** Call once the decision has actually been sent to the harness, to flip
   *  the card into its settled state. `onUndo`, when given (approved writes
   *  only), renders an Undo button that runs it on click and stays available
   *  for the rest of the session. */
  settle(result: { allowed: boolean; onUndo?: () => Promise<void> }): void;
}

/** Renders the card as the last child of `container` (the chat transcript). */
export function renderApprovalCard(
  container: HTMLElement,
  preview: WritePreview,
  onDecide: (d: ApprovalDecision) => void,
): ApprovalCardHandle {
  const card = container.createDiv({ cls: "oc-approval-card" });
  card.createDiv({ cls: "oc-approval-head", text: `${preview.action} — ${preview.path}` });
  card.createDiv({ cls: "oc-approval-summary", text: preview.summary });

  if (preview.diff?.length) {
    const pre = card.createEl("pre", { cls: "oc-approval-diff" });
    // Per-line tint: a diff that stays one colour makes the reader parse the
    // +/- markers themselves. Unchanged lines keep the muted body colour.
    for (const line of preview.diff) {
      const kind = line.startsWith("+") ? "oc-diff-line-add" : line.startsWith("-") ? "oc-diff-line-del" : "";
      pre.createSpan({ cls: `oc-diff-line ${kind}`.trim(), text: line.length ? line : " " });
    }
  }

  const actions = card.createDiv({ cls: "oc-approval-actions" });

  // Primary first: the affirmative decision is the one a reader is looking for,
  // and Reject stays a quiet outline next to it.
  const allowBtn = actions.createEl("button", { cls: "oc-approval-allow", text: "Approve" });
  const denyBtn = actions.createEl("button", { cls: "oc-approval-deny", text: "Reject" });

  const rememberLabel = actions.createEl("label", { cls: "oc-approval-remember" });
  const remember = rememberLabel.createEl("input", { attr: { type: "checkbox" } });
  rememberLabel.createSpan({ text: "Always allow" });

  let decided = false;
  const decide = (allowed: boolean) => {
    if (decided) return;
    decided = true;
    denyBtn.disabled = true;
    allowBtn.disabled = true;
    rememberLabel.addClass("oc-approval-remember-disabled");
    remember.disabled = true;
    onDecide({ allowed, remember: remember.checked });
  };
  denyBtn.addEventListener("click", () => decide(false));
  allowBtn.addEventListener("click", () => decide(true));

  return {
    settle(result) {
      actions.empty();
      if (result.allowed) {
        actions.createSpan({ cls: "oc-approval-applied", text: "✓ Approved" });
        if (result.onUndo) {
          const undoBtn = actions.createEl("button", { cls: "oc-approval-undo", text: "Undo" });
          undoBtn.addEventListener("click", async () => {
            undoBtn.disabled = true;
            await result.onUndo!();
            actions.empty();
            actions.createSpan({ cls: "oc-approval-undone", text: "Undone" });
          });
        }
      } else {
        actions.createSpan({ cls: "oc-approval-denied", text: "Rejected" });
      }
    },
  };
}

// ---------- generic ACP permission card (specs/004-acp-shell, FR-034…FR-038) ----------

/** Renders the harness's real tool call and exactly the options it offered.
 *  There is no plugin-invented Approve/Reject pair and no default decision:
 *  every button is one of the harness's own `optionId`s, returned verbatim. */
export function renderPermissionCard(
  container: HTMLElement,
  permission: PendingPermission,
  onSelect: (optionId: string) => void,
): HTMLElement {
  const card = container.createDiv({ cls: "oc-approval-card oc-permission-card" });
  const call = permission.toolCall;
  const title = call.title ?? call.name ?? "Permission requested";
  card.createDiv({ cls: "oc-approval-head", text: title });

  const meta = [call.kind, call.status].filter(Boolean).join(" · ");
  if (meta) card.createDiv({ cls: "oc-permission-meta", text: meta });

  for (const content of call.content ?? []) renderContent(card, content);

  if (call.rawInput !== undefined) {
    const details = card.createEl("details", { cls: "oc-approval-raw" });
    details.createEl("summary", { text: "Requested input" });
    details.createEl("pre", { text: clampRaw(call.rawInput) });
  }

  const actions = card.createDiv({ cls: "oc-approval-actions" });
  if (!permission.options.length) {
    // An agent that offers no options can only be cancelled; say so instead of
    // inventing a decision the protocol does not define.
    card.createDiv({ cls: "oc-approval-summary", text: "The harness offered no options for this request." });
    return card;
  }
  let decided = false;
  const buttons: HTMLButtonElement[] = [];
  for (const option of permission.options) {
    const button = actions.createEl("button", {
      cls: option.kind.startsWith("reject") ? "oc-approval-deny" : "oc-approval-allow",
      text: option.name,
    });
    button.disabled = false;
    button.addEventListener("click", () => {
      if (decided) return;
      decided = true;
      for (const b of buttons) b.disabled = true;
      onSelect(option.optionId);
      actions.empty();
      actions.createSpan({ cls: "oc-approval-applied", text: `Answered: ${option.name}` });
    });
    buttons.push(button);
  }
  return card;
}

function renderContent(card: HTMLElement, content: ToolContentView): void {
  switch (content.type) {
    case "text":
      card.createDiv({ cls: "oc-approval-summary", text: content.text });
      return;
    case "diff": {
      const pre = card.createEl("pre", { cls: "oc-approval-diff" });
      const lines = String(content.newText ?? "").split("\n").slice(0, 200);
      for (const line of lines) {
        const kind = line.startsWith("+") ? "oc-diff-line-add" : line.startsWith("-") ? "oc-diff-line-del" : "";
        pre.createSpan({ cls: `oc-diff-line ${kind}`.trim(), text: line.length ? line : " " });
      }
      if (content.path) card.createDiv({ cls: "oc-approval-summary", text: content.path });
      return;
    }
    case "terminal":
      card.createDiv({ cls: "oc-approval-summary", text: `terminal ${content.terminalId}` });
      return;
    case "resource_link":
    case "resource":
      card.createDiv({ cls: "oc-approval-summary", text: content.name ?? content.uri });
      return;
    case "image":
    case "audio":
      card.createDiv({ cls: "oc-approval-summary", text: content.mimeType });
      return;
    default:
      card.createDiv({ cls: "oc-approval-summary", text: "Unrecognised content" });
  }
}

function clampRaw(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  const limit = 16 * 1024;
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…(truncated)`;
}

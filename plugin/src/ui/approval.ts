/** Inline, non-blocking approval card for one ACP-proposed vault write
 *  (`session/request_permission`) — specs/002-acp-only-chat-ux, User Story 2.
 *
 *  Renders directly in the chat transcript instead of a blocking `Modal`.
 *  Checked against Claudian and Obsidian Copilot Agent (research.md R3):
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
    pre.createEl("code", { text: preview.diff.join("\n") });
  }

  const actions = card.createDiv({ cls: "oc-approval-actions" });

  const rememberLabel = actions.createEl("label", { cls: "oc-approval-remember" });
  const remember = rememberLabel.createEl("input", { attr: { type: "checkbox" } });
  rememberLabel.createSpan({ text: "Always allow this action" });

  const denyBtn = actions.createEl("button", { cls: "oc-approval-deny", text: "Reject" });
  const allowBtn = actions.createEl("button", { cls: "oc-approval-allow mod-cta", text: "Approve" });

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

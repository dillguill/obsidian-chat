/** Inline edit — rewrite a selected passage with a word-level diff, then apply.
 *  Runs from the active Markdown editor (command "Inline edit selection" + the
 *  editor context menu). Respects the approval mode:
 *    - auto   : apply immediately (no diff modal)
 *    - review : show the word-level diff, Apply/Discard
 *    - plan   : show the diff, Apply disabled (preview only)                  */
import { App, Modal, Notice, MarkdownView, Setting } from "obsidian";
import type ObsidianChatPlugin from "../main";
import { getActiveProvider } from "../settings";
import { buildRuntime } from "../chat/runtime";
import { wordDiff, renderWordDiff, diffStat, type DiffSegment } from "./diff";

export async function runInlineEdit(app: App, plugin: ObsidianChatPlugin): Promise<void> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const editor = view?.editor;
  const selection = editor?.getSelection() ?? "";
  if (!selection.trim()) {
    new Notice("Select a passage to edit first.");
    return;
  }

  const instruction = await new Promise<string | null>((resolve) => new InstructionPromptModal(app, resolve).open());
  if (instruction == null || !instruction.trim()) return;

  const active = getActiveProvider(plugin.settings);
  const runtime = buildRuntime(active);
  const sys = [
    "You are editing a note in an Obsidian vault.",
    "Rewrite the passage below to satisfy the user's instruction.",
    "Return ONLY the rewritten passage as plain markdown — no commentary, no code fences, no preamble.",
  ].join(" ");
  const user = `Instruction: ${instruction.trim()}\n\nPassage:\n${selection}`;

  let rewritten = "";
  let error: string | null = null;
  try {
    await runtime.stream({
      model: active.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      tools: [],
      onEvent: (e) => {
        if (e.type === "token") rewritten += e.text;
        else if (e.type === "error") error = e.message;
      },
    });
  } catch (err) {
    error = String((err as Error).message ?? err);
  }
  if (error) {
    new Notice(`Inline edit failed: ${error}`);
    return;
  }

  const cleaned = rewritten.trim();
  if (!cleaned) {
    new Notice("The model returned an empty rewrite.");
    return;
  }
  const segments = wordDiff(selection, cleaned);

  const mode = plugin.settings.approvalMode;
  if (mode === "auto") {
    editor!.replaceSelection(cleaned);
    const { add, del } = diffStat(segments);
    new Notice(`Applied inline edit (+${add} -${del}).`);
    return;
  }

  await new Promise<void>((resolve) => {
    const modal = new InlineEditModal(app, segments, mode === "plan" ? "plan" : "review", (apply) => {
      if (apply && editor) {
        editor.replaceSelection(cleaned);
        new Notice("Applied inline edit.");
      }
      resolve();
    });
    modal.open();
  });
}

class InstructionPromptModal extends Modal {
  constructor(app: App, private resolve: (v: string | null) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-inline-prompt");
    contentEl.createEl("h3", { text: "What should I do with this passage?" });
    const ta = contentEl.createEl("textarea", {
      cls: "oc-inline-ta",
      attr: { placeholder: 'e.g. "Make it more concise and link to [[Related]]"', rows: "4" },
    });
    ta.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        this.resolve(ta.value);
        this.close();
      }
    });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => {
        this.resolve(null);
        this.close();
      }))
      .addButton((b) =>
        b.setButtonText("Rewrite").setCta().onClick(() => {
          this.resolve(ta.value);
          this.close();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class InlineEditModal extends Modal {
  private done = false;
  constructor(
    app: App,
    private segments: DiffSegment[],
    private mode: "review" | "plan",
    private onDone: (apply: boolean) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oc-inline-edit");
    contentEl.createEl("h3", { text: this.mode === "plan" ? "Rewrite (plan — not applied)" : "Rewrite" });

    const body = contentEl.createEl("div", { cls: "oc-inline-diff" });
    body.innerHTML = renderWordDiff(this.segments);

    if (this.mode === "plan") {
      new Setting(contentEl).addButton((b) =>
        b.setButtonText("OK (not applied)").setCta().onClick(() => {
          this.finish(false);
        })
      );
      return;
    }

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Discard").onClick(() => {
          this.finish(false);
        })
      )
      .addButton((b) =>
        b.setButtonText("Apply").setCta().onClick(() => {
          this.finish(true);
        })
      );
  }

  private finish(apply: boolean) {
    if (this.done) return;
    this.done = true;
    this.onDone(apply);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.done) this.onDone(false);
  }
}

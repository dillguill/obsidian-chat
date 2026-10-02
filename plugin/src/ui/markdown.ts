/** Render assistant/user markdown into an element using Obsidian's renderer,
 *  so `[[wikilinks]]`, code blocks, and inline formatting work (and are
 *  clickable). */
import { App, MarkdownRenderer, Component, setIcon } from "obsidian";

export async function renderMarkdown(app: App, el: HTMLElement, text: string, sourcePath: string, parent: Component): Promise<void> {
  el.empty();
  await MarkdownRenderer.render(app, text, el, sourcePath, parent);
  addCodeCopyButtons(el);
}

/** Adds a copy button to every code block Obsidian just rendered.
 *
 *  MarkdownRenderer ships no chrome of its own, so inside a custom view a code
 *  block would otherwise have no way to be copied (specs/003-workspace-parity
 *  W7.7). Idempotent: a re-render replaces the element's children, and the
 *  guard skips any block that already carries a button. */
function addCodeCopyButtons(root: HTMLElement): void {
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    if (pre.querySelector(".oc-code-copy")) continue;
    const btn = createEl("button", {
      cls: "oc-code-copy",
      attr: { type: "button", "aria-label": "Copy code", title: "Copy" },
    });
    setIcon(btn, "copy");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
      void copyWithFeedback(btn, code);
    });
    pre.appendChild(btn);
  }
}

async function copyWithFeedback(btn: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  btn.empty();
  setIcon(btn, "check");
  window.setTimeout(() => {
    btn.empty();
    setIcon(btn, "copy");
  }, 1200);
}

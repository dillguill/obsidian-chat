/** Render assistant/user markdown into an element using Obsidian's renderer,
 *  so `[[wikilinks]]`, code blocks, and inline formatting work (and are
 *  clickable). */
import { App, MarkdownRenderer, Component } from "obsidian";

export async function renderMarkdown(app: App, el: HTMLElement, text: string, sourcePath: string, parent: Component): Promise<void> {
  el.empty();
  await MarkdownRenderer.render(app, text, el, sourcePath, parent);
}

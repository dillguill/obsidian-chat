/** Generic ACP transcript renderer (FR-043…FR-050).
 *
 *  Everything comes from ACP's own fields: title verbatim, programmatic name
 *  only as a missing-title fallback, kind/status/content/locations/raw I/O.
 *  There is no tool-name dictionary and no invented labels; unknown update
 *  kinds become a generic raw row and are never dropped. Icons are limited to
 *  ACP's fixed ToolKind enum (the view applies them).
 */
import type { RenderUpdate, ToolCallView, ToolContentView } from "../acp/types.ts";
import { boundedJson } from "./raw-bounds.ts";
import { diffStat, formatDuration } from "./format.ts";

export type ActivityPresentation = "chronological" | "grouped";

/** Grouped/collapsed presentation is only ever opt-in; chronological is the
 *  default and any unknown setting falls back to it. */
export function activityPresentation(setting: string | null | undefined): ActivityPresentation {
  return setting === "grouped" ? "grouped" : "chronological";
}

export interface ToolCardModel {
  toolCallId: string;
  /** Harness title verbatim; programmatic name only when absent; then kind. */
  title: string;
  kind?: string;
  status?: string;
  late: boolean;
  durationText?: string;
  content: ToolContentView[];
  locations: Array<{ path: string; line?: number }>;
  rawInput?: ReturnType<typeof boundedJson>;
  rawOutput?: ReturnType<typeof boundedJson>;
}

export function toolCardModel(call: ToolCallView, startedAt?: number, now = Date.now()): ToolCardModel {
  const durationText = startedAt !== undefined && call.status && call.status !== "pending" && call.status !== "in_progress"
    ? formatDuration(now - startedAt)
    : undefined;
  return {
    toolCallId: call.toolCallId,
    title: call.title ?? call.name ?? call.kind ?? "Tool call",
    kind: call.kind,
    status: call.status,
    late: call.late === true,
    durationText,
    content: call.content ?? [],
    locations: call.locations ?? [],
    rawInput: call.rawInput === undefined ? undefined : boundedJson(call.rawInput),
    rawOutput: call.rawOutput === undefined ? undefined : boundedJson(call.rawOutput),
  };
}

/** ACP's fixed ToolKind enum → an icon name. Never a tool-name mapping. */
export const TOOL_KIND_ICONS: Record<string, string> = {
  read: "file-text",
  edit: "pencil",
  delete: "trash-2",
  move: "folder-symlink",
  search: "search",
  execute: "terminal",
  think: "brain",
  fetch: "globe",
  other: "wrench",
};

export interface ToolCardOptions {
  renderMarkdown?: (el: HTMLElement, text: string) => void;
  onOpenLocation?: (path: string, line?: number) => void;
}

export interface ToolCardHandle {
  el: HTMLElement;
  update(call: ToolCallView): void;
}

/** Generic tool card: one card per `toolCallId`; later updates mutate it. */
export function renderToolCard(
  container: HTMLElement,
  call: ToolCallView,
  options: ToolCardOptions = {},
  startedAt?: number,
): ToolCardHandle {
  const el = container.createDiv({ cls: "oc-tool-card", attr: { "data-tool-call-id": call.toolCallId } });
  const handle: ToolCardHandle = {
    el,
    update(next) {
      draw(next);
    },
  };
  const draw = (current: ToolCallView) => {
    el.empty();
    const model = toolCardModel(current, startedAt);
    const head = el.createDiv({ cls: "oc-tool-head" });
    head.createSpan({ cls: "oc-tool-title", text: model.title });
    const meta = [model.kind, model.status, model.late ? "late" : null, model.durationText]
      .filter(Boolean)
      .join(" · ");
    if (meta) head.createSpan({ cls: "oc-tool-meta", text: meta });
    if (model.locations.length) {
      const locations = head.createDiv({ cls: "oc-tool-locations" });
      for (const location of model.locations) {
        const label = location.line ? `${location.path}:${location.line}` : location.path;
        if (options.onOpenLocation) {
          const link = locations.createEl("button", { cls: "oc-tool-location", text: label, attr: { type: "button" } });
          link.addEventListener("click", () => options.onOpenLocation!(location.path, location.line));
        } else {
          locations.createSpan({ cls: "oc-tool-location", text: label });
        }
      }
    }
    const body = el.createDiv({ cls: "oc-tool-body" });
    for (const content of model.content) renderContent(body, content, options);
    if (model.rawInput) addRawDetails(body, "Raw input", model.rawInput.text);
    if (model.rawOutput) addRawDetails(body, "Raw output", model.rawOutput.text);
  };
  draw(call);
  return handle;
}

function renderContent(parent: HTMLElement, content: ToolContentView, options: ToolCardOptions): void {
  switch (content.type) {
    case "text": {
      const el = parent.createDiv({ cls: "oc-tool-content-text" });
      if (options.renderMarkdown) options.renderMarkdown(el, content.text);
      else el.setText(content.text);
      return;
    }
    case "diff": {
      const stat = diffStat(content.oldText, content.newText);
      parent.createDiv({
        cls: "oc-tool-diff-stat",
        text: `${content.path} · +${stat.added} −${stat.removed}`,
      });
      const pre = parent.createEl("pre", { cls: "oc-tool-diff" });
      const lines = content.newText.split("\n").slice(0, 400);
      for (const line of lines) {
        const kind = line.startsWith("+") ? "oc-diff-add" : line.startsWith("-") ? "oc-diff-del" : "";
        pre.createSpan({ cls: `oc-diff-line ${kind}`.trim(), text: line.length ? line : " " });
      }
      return;
    }
    case "terminal":
      parent.createDiv({ cls: "oc-tool-terminal", text: `Terminal output · ${content.terminalId}` });
      return;
    case "image": {
      const src = content.data ? `data:${content.mimeType};base64,${content.data}` : content.uri;
      if (src) parent.createEl("img", { cls: "oc-tool-image", attr: { src, alt: "Tool image" } });
      else parent.createDiv({ cls: "oc-tool-terminal", text: `Image · ${content.mimeType}` });
      return;
    }
    case "audio": {
      const src = content.data ? `data:${content.mimeType};base64,${content.data}` : content.uri;
      if (src) parent.createEl("audio", { attr: { controls: "true", src } });
      else parent.createDiv({ cls: "oc-tool-terminal", text: `Audio · ${content.mimeType}` });
      return;
    }
    case "resource_link":
      parent.createEl("a", {
        cls: "oc-tool-resource",
        text: content.title ?? content.name ?? content.uri,
        attr: { href: content.uri },
      });
      return;
    case "resource": {
      const details = parent.createEl("details", { cls: "oc-tool-resource" });
      details.createEl("summary", { text: content.name ?? content.uri });
      if (content.text) details.createEl("pre", { text: boundedJson(content.text).text });
      return;
    }
    default: {
      const raw = boundedJson((content as { raw?: unknown }).raw ?? content);
      addRawDetails(parent, "Unrecognised content", raw.text);
    }
  }
}

function addRawDetails(parent: HTMLElement, summary: string, text: string): void {
  const details = parent.createEl("details", { cls: "oc-tool-raw" });
  details.createEl("summary", { text: summary });
  // Lazy: the text is only in the DOM once the disclosure is opened.
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("pre")) return;
    details.createEl("pre", { text });
  });
}

/** Agent message text; streaming is rendered as plain text and upgraded to
 *  Markdown by the view at turn end. */
export function renderMessage(container: HTMLElement, role: "user" | "agent", text: string): HTMLElement {
  return container.createDiv({ cls: `oc-msg oc-msg-${role}`, text });
}

export function renderThought(container: HTMLElement, text: string): HTMLElement {
  const details = container.createEl("details", { cls: "oc-thought" });
  details.createEl("summary", { text: "Thought" });
  details.createEl("div", { cls: "oc-thought-body", text });
  return details;
}

export function renderPlan(container: HTMLElement, entries: Array<{ content: string; priority?: string; status?: string }>): HTMLElement {
  const box = container.createDiv({ cls: "oc-plan" });
  box.createDiv({ cls: "oc-plan-title", text: "Plan" });
  for (const entry of entries) {
    box.createDiv({
      cls: `oc-plan-row oc-plan-${entry.status ?? "pending"}`,
      text: `${entry.status ?? "pending"} · ${entry.content}`,
    });
  }
  return box;
}

export function renderUsage(container: HTMLElement, usage: { used: number; size: number; cost?: { amount: number; currency: string } }): HTMLElement {
  const cost = usage.cost ? ` · ${usage.cost.amount} ${usage.cost.currency}` : "";
  return container.createDiv({ cls: "oc-usage", text: `${usage.used} / ${usage.size} tokens${cost}` });
}

/** Generic row for unknown/unstable update kinds: the kind and a bounded raw
 *  payload disclosure. Never dropped. */
export function renderRawUpdate(container: HTMLElement, kind: string, payload: unknown): HTMLElement {
  const details = container.createEl("details", { cls: "oc-raw-update" });
  details.createEl("summary", { text: `ACP update: ${kind}` });
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("pre")) return;
    details.createEl("pre", { text: boundedJson(payload).text });
  });
  return details;
}

/** Render one mapped update. Returns the element it created, when any. */
export function renderUpdate(
  container: HTMLElement,
  update: RenderUpdate,
  options: ToolCardOptions = {},
): HTMLElement | null {
  switch (update.type) {
    case "message":
      return renderMessage(container, update.role, update.text);
    case "thought":
      return renderThought(container, update.text);
    case "plan":
      return renderPlan(container, update.entries);
    case "usage":
      return renderUsage(container, update.usage);
    case "raw":
      return renderRawUpdate(container, update.sessionUpdate, update.payload);
    default:
      return null;
  }
}

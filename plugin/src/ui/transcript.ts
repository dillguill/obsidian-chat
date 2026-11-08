/** Chat transcript DOM: compact tool rows, thoughts, plans, raw rows.
 *  A tool call is one row (icon · title · short detail · status) whose output
 *  is drawn lazily only when expanded. Models come from renderer.ts. */
import { setIcon } from "obsidian";
import type { RenderUpdate, ToolCallView, ToolContentView } from "../acp/types.ts";
import { boundedJson } from "./raw-bounds.ts";
import { diffStat } from "./format.ts";
import { formatTokens, mergeToolCall, TOOL_KIND_ICONS, toolCardModel, toolDetail } from "./renderer.ts";

export interface ToolCardOptions {
  renderMarkdown?: (el: HTMLElement, text: string) => void;
  onOpenLocation?: (path: string, line?: number) => void;
}

export interface ToolCardHandle {
  el: HTMLElement;
  /** Latest merged state of this call. */
  readonly call: ToolCallView;
  update(call: ToolCallView): void;
}

const TOOL_OUTPUT_LIMIT = 20_000;

/** Compact tool row: one per `toolCallId`. Later (partial) updates are merged
 *  in; the body is drawn only while expanded. */
export function renderToolCard(
  container: HTMLElement,
  call: ToolCallView,
  options: ToolCardOptions = {},
  startedAt?: number,
): ToolCardHandle {
  const el = container.createDiv({ cls: "oc-tool", attr: { "data-tool-call-id": call.toolCallId } });
  const head = el.createDiv({ cls: "oc-tool-head", attr: { role: "button", tabindex: "0" } });
  const iconEl = head.createSpan({ cls: "oc-tool-icon" });
  const titleEl = head.createSpan({ cls: "oc-tool-title" });
  const detailEl = head.createSpan({ cls: "oc-tool-detail" });
  const statusEl = head.createSpan({ cls: "oc-tool-status" });
  const body = el.createDiv({ cls: "oc-tool-body" });
  let current = call;
  let open = false;
  let bodyDrawnFor: ToolCallView | null = null;
  let iconKind: string | undefined = "\u0000";
  let statusKey = "\u0000";

  const drawHead = () => {
    const model = toolCardModel(current, startedAt);
    if (iconKind !== model.kind) {
      iconKind = model.kind;
      iconEl.empty();
      setIcon(iconEl, TOOL_KIND_ICONS[model.kind ?? "other"] ?? "wrench");
    }
    titleEl.setText(model.title);
    const detail = toolDetail(current);
    detailEl.setText(detail);
    detailEl.toggleClass("oc-hidden", !detail || detail === model.title);
    el.dataset.status = model.status ?? "pending";
    const key = `${model.status}|${model.late}`;
    if (key !== statusKey) {
      statusKey = key;
      statusEl.empty();
      if (model.status === "completed") setIcon(statusEl, "check");
      else if (model.status === "failed") setIcon(statusEl, "x");
      else statusEl.createSpan({ cls: "oc-spinner" });
    }
    statusEl.setAttr("title", [model.status ?? "pending", model.late ? "late" : null, model.durationText].filter(Boolean).join(" · "));
  };

  const drawBody = () => {
    if (bodyDrawnFor === current) return;
    bodyDrawnFor = current;
    const model = toolCardModel(current, startedAt);
    body.empty();
    if (model.locations.length > 0) {
      const locations = body.createDiv({ cls: "oc-tool-locations" });
      for (const location of model.locations) {
        const label = location.line ? `${location.path}:${location.line}` : location.path;
        const link = locations.createEl("a", { cls: "oc-tool-location", text: label });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          options.onOpenLocation?.(location.path, location.line);
        });
      }
    }
    for (const content of model.content) renderContent(body, content, options);
    if (model.rawInput) addRawDetails(body, "Input", model.rawInput.text);
    if (model.rawOutput) addRawDetails(body, "Output", model.rawOutput.text);
    if (!body.childElementCount) body.createDiv({ cls: "oc-tool-empty", text: "No output" });
  };

  const toggle = () => {
    open = !open;
    el.toggleClass("is-open", open);
    if (open) drawBody();
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });

  drawHead();
  return {
    el,
    get call() {
      return current;
    },
    update(next) {
      current = mergeToolCall(current, next);
      drawHead();
      if (open) drawBody();
    },
  };
}

function renderContent(parent: HTMLElement, content: ToolContentView, options: ToolCardOptions): void {
  switch (content.type) {
    case "text": {
      const text = content.text.length > TOOL_OUTPUT_LIMIT
        ? `${content.text.slice(0, TOOL_OUTPUT_LIMIT)}\n… (${content.text.length - TOOL_OUTPUT_LIMIT} more characters)`
        : content.text;
      parent.createEl("pre", { cls: "oc-tool-output", text });
      return;
    }
    case "diff": {
      const stat = diffStat(content.oldText, content.newText);
      const head = parent.createDiv({ cls: "oc-tool-diff-stat" });
      head.createSpan({ text: content.path });
      head.createSpan({ cls: "oc-diff-add", text: ` +${stat.added}` });
      head.createSpan({ cls: "oc-diff-del", text: ` −${stat.removed}` });
      const pre = parent.createEl("pre", { cls: "oc-tool-output oc-tool-diff" });
      const lines = content.newText.split("\n").slice(0, 400);
      for (const line of lines) {
        const kind = line.startsWith("+") ? "oc-diff-add" : line.startsWith("-") ? "oc-diff-del" : "";
        pre.createDiv({ cls: `oc-diff-line ${kind}`.trim(), text: line.length ? line : " " });
      }
      return;
    }
    case "terminal":
      parent.createDiv({ cls: "oc-tool-note", text: `Terminal output · ${content.terminalId}` });
      return;
    case "image": {
      const src = content.data ? `data:${content.mimeType};base64,${content.data}` : content.uri;
      if (src) parent.createEl("img", { cls: "oc-tool-image", attr: { src, alt: "Tool image" } });
      else parent.createDiv({ cls: "oc-tool-note", text: `Image · ${content.mimeType}` });
      return;
    }
    case "audio": {
      const src = content.data ? `data:${content.mimeType};base64,${content.data}` : content.uri;
      if (src) parent.createEl("audio", { attr: { controls: "true", src } });
      else parent.createDiv({ cls: "oc-tool-note", text: `Audio · ${content.mimeType}` });
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
      const details = parent.createEl("details", { cls: "oc-tool-raw" });
      details.createEl("summary", { text: content.name ?? content.uri });
      if (content.text) details.createEl("pre", { cls: "oc-tool-output", text: boundedJson(content.text).text });
      return;
    }
    default: {
      const raw = boundedJson((content as { raw?: unknown }).raw ?? content);
      addRawDetails(parent, "Unrecognised content", raw.text);
    }
  }
  void options;
}

function addRawDetails(parent: HTMLElement, summary: string, text: string): void {
  const details = parent.createEl("details", { cls: "oc-tool-raw" });
  details.createEl("summary", { text: summary });
  // Lazy: the text is only in the DOM once the disclosure is opened.
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("pre")) return;
    details.createEl("pre", { cls: "oc-tool-output", text });
  });
}

/** Plain message element (the view upgrades agent text to Markdown). */
export function renderMessage(container: HTMLElement, role: "user" | "agent", text: string): HTMLElement {
  return container.createDiv({ cls: `oc-msg oc-msg-${role}`, text });
}

export function renderThought(container: HTMLElement, text: string): HTMLElement {
  const details = container.createEl("details", { cls: "oc-thought" });
  details.createEl("summary", { text: "Thinking" });
  details.createEl("div", { cls: "oc-thought-body", text });
  return details;
}

const PLAN_ICONS: Record<string, string> = { pending: "circle", in_progress: "circle-dot", completed: "check-circle-2" };

export function renderPlan(container: HTMLElement, entries: Array<{ content: string; priority?: string; status?: string }>): HTMLElement {
  const box = container.createDiv({ cls: "oc-plan" });
  fillPlan(box, entries);
  return box;
}

export function fillPlan(box: HTMLElement, entries: Array<{ content: string; priority?: string; status?: string }>): void {
  box.empty();
  const done = entries.filter((entry) => entry.status === "completed").length;
  box.createDiv({ cls: "oc-plan-title", text: `Plan · ${done}/${entries.length}` });
  for (const entry of entries) {
    const status = entry.status ?? "pending";
    const row = box.createDiv({ cls: `oc-plan-row oc-plan-${status}` });
    setIcon(row.createSpan({ cls: "oc-plan-icon" }), PLAN_ICONS[status] ?? "circle");
    row.createSpan({ cls: "oc-plan-text", text: entry.content });
  }
}

export function renderUsage(container: HTMLElement, usage: { used: number; size: number; cost?: { amount: number; currency: string } }): HTMLElement {
  const cost = usage.cost ? ` · ${usage.cost.amount} ${usage.cost.currency}` : "";
  return container.createDiv({ cls: "oc-usage", text: `${formatTokens(usage.used)} / ${formatTokens(usage.size)} tokens${cost}` });
}

/** Generic row for unknown/unstable update kinds: the kind and a bounded raw
 *  payload disclosure. Never dropped. */
export function renderRawUpdate(container: HTMLElement, kind: string, payload: unknown): HTMLElement {
  const details = container.createEl("details", { cls: "oc-raw-update" });
  details.createEl("summary", { text: `Update: ${kind}` });
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("pre")) return;
    details.createEl("pre", { cls: "oc-tool-output", text: boundedJson(payload).text });
  });
  return details;
}

/** Render one mapped update. Returns the element it created, when any. */
export function renderUpdate(
  container: HTMLElement,
  update: RenderUpdate,
  options: ToolCardOptions = {},
): HTMLElement | null {
  void options;
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

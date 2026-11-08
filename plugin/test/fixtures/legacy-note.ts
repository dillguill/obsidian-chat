/** Test-only legacy-note writer (the runtime writer is deleted). Produces the
 *  same canonical block/prose the old Markdown format used, for import tests. */
import type { LegacyMessage } from "../../src/session/migrate.ts";

export { type LegacyMessage };

function fmt(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function metaToFrontmatter(meta: { created: number; updated: number; tokens: number; title?: string }): string {
  const lines = ["---", "type: chat-session"];
  if (meta.title) lines.push(`title: ${JSON.stringify(meta.title)}`);
  lines.push(`created: ${fmt(meta.created)}`, `updated: ${fmt(meta.updated)}`, `tokens: ${meta.tokens}`, "---", "");
  return lines.join("\n");
}

export function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export function renderBody(title: string, messages: LegacyMessage[]): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const message of messages) {
    const label = message.role === "user" ? "👤 User" : message.role === "assistant" ? "🤖 Assistant" : message.role === "system" ? "🔑 System" : "🔧 Tool";
    lines.push(`## ${label} (${fmt(Date.now())})`, "");
    if (message.reasoning?.length) {
      for (const thought of message.reasoning) {
        const duration = thought.durationSeconds !== undefined ? ` (${thought.durationSeconds}s)` : "";
        lines.push(`### 🧠 Thought${duration}`, "", thought.text.trim(), "");
      }
      lines.push("<!-- end-thoughts -->", "");
    }
    if (message.activity?.length) {
      lines.push(`<!-- oc-activity-b64: ${base64Encode(JSON.stringify({ v: 1, items: message.activity.slice(-50) }))} -->`, "");
    }
    lines.push(message.content.trim(), "");
  }
  lines.push(`<!-- oc-transcript-b64: ${base64Encode(JSON.stringify({ v: 1, messages }))} -->`, "");
  return lines.join("\n");
}

/** Human-facing conversation labels (T125).
 *
 *  Rule: a healthy, resumable conversation shows no tag at all. Internal
 *  single-word states (`resume-capable`, `load-only`, `fresh-only`, `imported`,
 *  `degraded`) must never reach the UI; exceptions get plain language. */
import type { ResumeStateName } from "../session/record.ts";

/** Status tag for a conversation, or null when nothing should be shown. */
export function conversationStatusLabel(state: ResumeStateName | string | null | undefined): string | null {
  switch (state) {
    // Resumable through the harness — no tag.
    case "resume-capable":
    case "load-only":
    case undefined:
    case null:
    case "":
      return null;
    // Not resumable; the stored transcript is still readable.
    case "digest-only":
      return "Old conversation — digest only";
    case "fresh-only":
      return "Old conversation — can’t reattach";
    default:
      // An unknown/new state must not leak a raw enum token.
      return null;
  }
}

/** Tag for a record whose tail needed repair, or null. */
export function recordStatusLabel(degraded: boolean): string | null {
  return degraded ? "Record repaired" : null;
}

/** Warning tag for unusually large records (50 MiB), or null. */
export function recordSizeLabel(large: boolean): string | null {
  return large ? "Large record (>50 MB)" : null;
}

/** Join only the labels that should actually be shown. */
export function conversationMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");
}

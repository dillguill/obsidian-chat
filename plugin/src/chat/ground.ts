/** Grounding — assemble a system prompt from retrieved notes + vault rules.
 *  Citations are emitted as `[[wikilinks]]` so the answer is clickable in the
 *  vault and Graph View-visible. Pure string builder, no obsidian deps. */
import type { RetrievedNote } from "./types";

export interface GroundContext {
  systemPrompt: string;
  citations: string[]; // vault-relative paths returned to the UI
}

/** Build the system prompt for a grounded turn. */
export function buildGrounding(  query: string,
  notes: RetrievedNote[],
  extra: { vaultRules?: string; agents?: string },
): GroundContext {
  const citations: string[] = []; // dedup paths
  const parts: string[] = [
    "You are Obsidian Chat, a research assistant for the user's Obsidian vault.",
    "You have tools to search/read the vault (search_vault, read_file, list_folder), search the web (web_search), and write to it (create_note, edit_note, rename_move_file, create_folder, set_property, manage_tags, delete_file).",
    "Vault notes are only included if shown below or if @mentioned. When you need context, use search_vault / read_file to find and read notes; cite them as [[wikilinks]] inline. If the vault lacks the answer, say so plainly rather than inventing.",
  ];

  if (extra.vaultRules || extra.agents) {
    parts.push("\n# Vault rules\n");
    parts.push(extra.vaultRules?.trim() ?? "");
    if (extra.agents) parts.push(extra.agents.trim());
  }

  if (notes.length) {
    parts.push("\n# Vault context (retrieved)\n");
    for (const n of notes) {
      if (!citations.includes(n.rel)) citations.push(n.rel);
      const name = n.rel.replace(/\.md$/, "");
      parts.push(`## [[${name}]]`);
      parts.push(n.snippet);
    }
  }

  parts.push(`\n# Current question\n${query}`);
  return { systemPrompt: parts.join("\n\n"), citations };
}

/** Extract wiki-link destinations from text (e.g. `[[Note]]`, `[[Note|alias]]`,
 *  `[[Note#heading]]`). Returns the target portion without `.md`. Used to attach
 *  `@`-mentioned notes as explicit grounding context. */
export function extractWikilinks(text: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const target = m[1].trim().replace(/\.md$/, "");
    if (target) links.push(target);
  }
  return links;
}

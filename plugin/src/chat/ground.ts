/** Wikilink extraction — used to attach `@`-mentioned notes as explicit
 *  grounding context for an ACP turn. Pure string utility, no obsidian deps. */

/** Extract wiki-link destinations from text (e.g. `[[Note]]`, `[[Note|alias]]`,
 *  `[[Note#heading]]`). Returns the target portion without `.md`. */
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

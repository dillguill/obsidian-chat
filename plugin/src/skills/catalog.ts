/** Skills from a user-selected vault folder (pure; no Obsidian import).
 *
 *  Layout follows the Agent Skills convention, plus plain notes:
 *    <folder>/<name>/SKILL.md   a skill folder (other files are resources)
 *    <folder>/<name>.md         a single-note skill
 *  `name` and `description` come from frontmatter when present. The agent
 *  receives a short catalog once per conversation and reads a skill's file
 *  only when a task calls for it; picking a skill attaches its full text. */

export interface SkillFile {
  path: string;
  frontmatter?: Record<string, unknown> | null;
}

export interface Skill {
  name: string;
  description: string;
  /** Vault-relative path of the skill's main note. */
  path: string;
}

export function normalizeFolder(folder: string | null | undefined): string {
  return String(folder ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function skillsIn(folder: string, files: readonly SkillFile[]): Skill[] {
  const root = normalizeFolder(folder);
  if (!root) return [];
  const prefix = `${root}/`;
  const out: Skill[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix) || !file.path.toLowerCase().endsWith(".md")) continue;
    const rest = file.path.slice(prefix.length).split("/");
    let fallback: string;
    if (rest.length === 1) fallback = rest[0].replace(/\.md$/i, "");
    else if (rest.length === 2 && rest[1].toLowerCase() === "skill.md") fallback = rest[0];
    else continue; // resources inside a skill folder, or deeper notes
    const fm = file.frontmatter ?? {};
    const name = typeof fm.name === "string" && fm.name.trim() ? fm.name.trim() : fallback;
    const description = typeof fm.description === "string" ? fm.description.replace(/\s+/g, " ").trim() : "";
    out.push({ name, description, path: file.path });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The once-per-conversation catalog block sent to the agent. */
export function catalogText(skills: readonly Skill[]): string {
  const lines = skills.map((skill) => `- ${skill.name} (${skill.path})${skill.description ? `: ${skill.description}` : ""}`);
  return [
    "These skills are available in this vault. When a request matches one, read its file at the path shown before acting, and follow it. Files next to a SKILL.md are that skill's resources.",
    "",
    ...lines,
  ].join("\n");
}

/** Removes YAML frontmatter from a skill note before it is attached. */
export function skillBody(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

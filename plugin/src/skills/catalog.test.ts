import test from "node:test";
import assert from "node:assert/strict";
import { catalogText, normalizeFolder, skillBody, skillsIn } from "./catalog.ts";

test("skills come from SKILL.md folders and top-level notes; resources and deeper notes are skipped", () => {
  const skills = skillsIn("/Skills/", [
    { path: "Skills/weekly-review/SKILL.md", frontmatter: { name: "Weekly review", description: "Summarize   the week" } },
    { path: "Skills/weekly-review/template.md" },
    { path: "Skills/meeting-notes.md", frontmatter: { description: "Turn a transcript into notes" } },
    { path: "Skills/deep/nested/thing.md" },
    { path: "Other/note.md" },
    { path: "Skills/image.png" },
  ]);
  assert.deepEqual(skills, [
    { name: "meeting-notes", description: "Turn a transcript into notes", path: "Skills/meeting-notes.md" },
    { name: "Weekly review", description: "Summarize the week", path: "Skills/weekly-review/SKILL.md" },
  ]);
});

test("no folder means no skills", () => {
  assert.deepEqual(skillsIn("", [{ path: "a.md" }]), []);
  assert.equal(normalizeFolder("  /a/b/ "), "a/b");
});

test("the catalog lists name, path and description; bodies drop frontmatter", () => {
  const text = catalogText([{ name: "x", description: "does x", path: "S/x.md" }]);
  assert.match(text, /- x \(S\/x\.md\): does x/);
  assert.equal(skillBody("---\nname: x\n---\n\n# Do x\nsteps"), "# Do x\nsteps");
  assert.equal(skillBody("no frontmatter"), "no frontmatter");
});

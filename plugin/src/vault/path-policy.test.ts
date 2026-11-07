import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateAcpPath, evaluateRelativePath, isBlacklisted, normalizeRelative, type PathPolicyConfig } from "./path-policy.ts";

const config: PathPolicyConfig = {
  vaultRoot: "/vault",
  harnessRoot: "/vault",
  blacklist: ["Private/", "Journals"],
};

test("normalizes safe relative paths and rejects traversal/absolute input", () => {
  assert.equal(normalizeRelative("Notes/A.md"), "Notes/A.md");
  assert.equal(normalizeRelative("./Notes//A.md"), "Notes/A.md");
  assert.equal(normalizeRelative("../etc/passwd"), null);
  assert.equal(normalizeRelative("/etc/passwd"), null);
  assert.equal(normalizeRelative("Notes/../../x"), null);
  assert.equal(normalizeRelative("Notes/\0A.md"), null);
});

test("allows absolute paths inside the vault and maps them to vault-relative", () => {
  const v = evaluateAcpPath("/vault/Notes/A.md", config);
  assert.equal(v.allowed, true);
  if (v.allowed) assert.equal(v.relPath, "Notes/A.md");
});

test("maps a harness root that differs from the vault root (remote prefix)", () => {
  const v = evaluateAcpPath("/mnt/vault/Notes/A.md", { ...config, harnessRoot: "/mnt/vault" });
  assert.equal(v.allowed, true);
  if (v.allowed) assert.equal(v.relPath, "Notes/A.md");
});

test("refuses paths outside the harness root", () => {
  const v = evaluateAcpPath("/other/Notes/A.md", config);
  assert.equal(v.allowed, false);
  if (!v.allowed) assert.equal(v.reason, "outside-vault");
});

test("refuses relative, malformed, NUL and traversal paths without clamping", () => {
  for (const p of ["Notes/A.md", "", "/vault/../etc/passwd", "/vault/Notes/\0A.md", "/vault/Notes/../A.md"]) {
    const v = evaluateAcpPath(p, config);
    assert.equal(v.allowed, false, `expected refusal for ${JSON.stringify(p)}`);
  }
  const root = evaluateAcpPath("/vault", config);
  assert.equal(root.allowed, false);
});

test("refuses blacklisted folders and descendants, case-insensitively", () => {
  for (const p of ["/vault/Private/A.md", "/vault/private", "/vault/Journals/2026.md", "/vault/journals"]) {
    const v = evaluateAcpPath(p, config);
    assert.equal(v.allowed, false, p);
    if (!v.allowed) assert.equal(v.reason, "blacklisted");
  }
  assert.equal(isBlacklisted("Private/A.md", config.blacklist), true);
  assert.equal(isBlacklisted("Public/A.md", config.blacklist), false);
});

test("protects .obsidian, .trash and the session store unconditionally", () => {
  for (const p of ["/vault/.obsidian/app.json", "/vault/.trash/A.md", "/vault/.chat/sessions/s_1.jsonl"]) {
    const v = evaluateAcpPath(p, config);
    assert.equal(v.allowed, false, p);
    if (!v.allowed) assert.equal(v.reason, "config-protected");
  }
});

test("normalizes Windows separators and case-insensitive roots", () => {
  const v = evaluateAcpPath("C:\\Vault\\Notes\\A.md", {
    ...config,
    vaultRoot: "C:/Vault",
    harnessRoot: "C:/vault",
  });
  assert.equal(v.allowed, true);
  if (v.allowed) {
    assert.equal(v.relPath, "Notes/A.md");
    assert.equal(v.absolutePath, "C:/Vault/Notes/A.md");
  }
});

test("relative MCP paths use the same policy", () => {
  const ok = evaluateRelativePath("Notes/A.md", config);
  assert.equal(ok.allowed, true);
  const blocked = evaluateRelativePath("Private/A.md", config);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.reason, "blacklisted");
  const escaped = evaluateRelativePath("../etc/passwd", config);
  assert.equal(escaped.allowed, false);
});

/** Rules for model pins/defaults (the regression that made every new session
 *  replay an unusable model). Run with `npm test`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateDefaultModel, normalizePinnedModels, orderModels, resolveModelChoice } from "./model-prefs.ts";

const values = [{ value: "opencode-go/a" }, { value: "opencode/b" }];

// ---------- resolveModelChoice ----------

test("no default leaves the harness's own model alone", () => {
  assert.deepEqual(resolveModelChoice(values, null, "opencode/b"), { action: "keep" });
});

test("an offered default is applied", () => {
  assert.deepEqual(resolveModelChoice(values, "opencode-go/a", "opencode/b"), { action: "set", value: "opencode-go/a" });
});

test("a session already on the default is left alone (no redundant round-trip)", () => {
  assert.deepEqual(resolveModelChoice(values, "opencode-go/a", "opencode-go/a"), { action: "keep" });
});

test("a stale default is reported, never replayed", () => {
  assert.deepEqual(resolveModelChoice(values, "opencode/gone", null), { action: "missing", value: "opencode/gone" });
});

// ---------- normalizePinnedModels ----------

test("legacy BYOK pin objects are dropped, not migrated", () => {
  const legacy = [{ providerId: "5aeab665", model: "qwen3.8-flash" }, { providerId: "x", model: "y" }];
  assert.deepEqual(normalizePinnedModels(legacy), []);
});

test("keeps opaque strings, trims, dedupes, and ignores junk", () => {
  assert.deepEqual(normalizePinnedModels([" opencode-go/a ", "opencode-go/a", "", 7, null, "opencode/b"]), [
    "opencode-go/a",
    "opencode/b",
  ]);
});

test("a missing or non-array pins field becomes an empty list", () => {
  assert.deepEqual(normalizePinnedModels(undefined), []);
  assert.deepEqual(normalizePinnedModels("opencode-go/a"), []);
});

// ---------- migrateDefaultModel ----------

test("a pre-pin install promotes acpConfigOverrides.model and clears the key", () => {
  const migrated = migrateDefaultModel(undefined, { model: "opencode/deepseek-v4.1-flash-free", mode: "build" });
  assert.equal(migrated.defaultModel, "opencode/deepseek-v4.1-flash-free");
  assert.deepEqual(migrated.overrides, { mode: "build" });
});

test("an explicit null default is preserved (user chose the harness default)", () => {
  const migrated = migrateDefaultModel(null, { model: "opencode-go/a", mode: "build" });
  assert.equal(migrated.defaultModel, null);
  assert.deepEqual(migrated.overrides, { mode: "build" });
});

test("a fresh install with nothing stored ends up on the harness default", () => {
  assert.deepEqual(migrateDefaultModel(undefined, undefined), { defaultModel: null, overrides: {} });
});

test("an already-migrated install keeps its default", () => {
  assert.deepEqual(migrateDefaultModel("opencode-go/a", { mode: "build" }), {
    defaultModel: "opencode-go/a",
    overrides: { mode: "build" },
  });
});

// ---------- orderModels ----------

test("pinned models sort first and each half keeps the harness order", () => {
  const items = [{ value: "p1" }, { value: "u1" }, { value: "p2" }, { value: "u2" }];
  assert.deepEqual(
    orderModels(items, ["p2", "p1"]).map((i) => i.value),
    ["p1", "p2", "u1", "u2"],
  );
});

test("no pins leaves the harness order untouched", () => {
  const items = [{ value: "a" }, { value: "b" }];
  assert.deepEqual(orderModels(items, []), items);
});

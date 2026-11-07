/** Session naming + recent-date policy (2026-10-24). Pure functions, so the
 *  thresholds are pinned here rather than re-derived by eye in the UI. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeDate, titleFromText } from "./session-title.ts";

// ---------- titles ----------

test("uses a short first question verbatim", () => {
  assert.equal(titleFromText("Reorganize the black hole prompt"), "Reorganize the black hole prompt");
});

test("flattens whitespace and control characters", () => {
  assert.equal(titleFromText("  Reorganize\n\tthe   prompt\u0007 "), "Reorganize the prompt");
});

test("has a placeholder for an empty session", () => {
  assert.equal(titleFromText("   "), "New chat");
});

test("truncates long questions without splitting a word", () => {
  const title = titleFromText(
    "Reorganize the black hole image prompt into something readable while keeping every physics detail intact",
  );
  assert.ok(title.length <= 60, `expected <= 60 chars, got ${title.length}`);
  assert.ok(title.endsWith("…"));
  assert.ok(!title.includes("  "));
  assert.ok(!title.slice(0, -1).endsWith(" "));
});

test("keeps a long unbroken token from collapsing to an ellipsis", () => {
  const title = titleFromText("a".repeat(100), 20);
  assert.equal(title, "aaaaaaaaaaaaaaaaa…");
});

// ---------- recent dates ----------

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

test("recent dates read as elapsed time on the same day", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);
  assert.equal(relativeDate(now - 20_000, now), "just now");
  assert.equal(relativeDate(now - 5 * minute, now), "5m ago");
  assert.equal(relativeDate(now - 3 * hour, now), "3h ago");
});

test("this week falls back to a weekday, older to a short date", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);
  const weekday = relativeDate(now - 3 * day, now);
  const older = relativeDate(now - 20 * day, now);
  assert.equal(weekday, new Date(now - 3 * day).toLocaleDateString(undefined, { weekday: "short" }));
  assert.equal(older, new Date(now - 20 * day).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
});

test("a clock skew never prints a negative age", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);
  assert.equal(relativeDate(now + hour, now), "just now");
});

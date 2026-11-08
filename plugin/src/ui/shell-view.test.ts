/** T080 + T125: chronological is the default presentation, and conversation
 *  labels are human language with no tag for a resumable chat. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_ACTIVITY_DENSITY } from "./transcript-prefs.ts";
import { activityPresentation } from "./renderer.ts";
import { conversationMeta, conversationStatusLabel, recordStatusLabel } from "./labels.ts";

test("the default activity presentation is chronological and expanded", () => {
  assert.equal(DEFAULT_ACTIVITY_DENSITY, "chronological");
  assert.equal(activityPresentation(DEFAULT_ACTIVITY_DENSITY), "chronological");
});

test("grouping is opt-in only", () => {
  assert.equal(activityPresentation("grouped"), "grouped");
});

test("a healthy resumable conversation has no status tag", () => {
  assert.equal(conversationStatusLabel("resume-capable"), null);
  assert.equal(conversationStatusLabel("load-only"), null);
  assert.equal(conversationStatusLabel(undefined), null);
  assert.equal(conversationStatusLabel("some-future-state"), null, "raw enums never leak into the UI");
});

test("non-resumable conversations get plain language, not internal enum words", () => {
  for (const state of ["fresh-only", "digest-only"]) {
    const label = conversationStatusLabel(state);
    assert.ok(label, "an exception is labelled");
    assert.ok(!/fresh-only|digest-only|imported|load-only|resume-capable/i.test(label!), "no internal single-word state is shown");
  }
});

test("only degraded records get a repair tag, and meta joins only real labels", () => {
  assert.equal(recordStatusLabel(false), null);
  assert.equal(recordStatusLabel(true), "Record repaired");
  assert.equal(conversationMeta([undefined, null, "", "Record repaired"]), "Record repaired");
  assert.equal(conversationMeta([undefined, null]), "");
});

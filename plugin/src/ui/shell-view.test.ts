/** T080 + T125: chronological is the default presentation, and conversation
 *  labels are human language with no tag for a resumable chat. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_ACTIVITY_DENSITY } from "./transcript-prefs.ts";
import { activityPresentation } from "./renderer.ts";
import { conversationMeta, conversationStatusLabel, recordStatusLabel } from "./labels.ts";

test("the default presentation is a readable chat with activity collapsed", () => {
  assert.equal(DEFAULT_ACTIVITY_DENSITY, "grouped");
  assert.equal(activityPresentation(DEFAULT_ACTIVITY_DENSITY), "grouped");
});

test("the expanded protocol stream is an explicit opt-in", () => {
  assert.equal(activityPresentation("chronological"), "chronological");
});

test("a healthy resumable conversation has no status tag", () => {
  assert.equal(conversationStatusLabel("resume-capable"), null);
  assert.equal(conversationStatusLabel("load-only"), null);
  assert.equal(conversationStatusLabel(undefined), null);
  assert.equal(conversationStatusLabel("some-future-state"), null, "raw enums never leak into the UI");
});

test("conversations that can't reattach still continue, so History shows no warning tag", () => {
  for (const state of ["fresh-only", "digest-only", "resume-capable", "load-only", "something-new"]) {
    assert.equal(conversationStatusLabel(state), null, state);
  }
});

test("only degraded records get a repair tag, and meta joins only real labels", () => {
  assert.equal(recordStatusLabel(false), null);
  assert.equal(recordStatusLabel(true), "Record repaired");
  assert.equal(conversationMeta([undefined, null, "", "Record repaired"]), "Record repaired");
  assert.equal(conversationMeta([undefined, null]), "");
});

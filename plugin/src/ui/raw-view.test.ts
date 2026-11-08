/** T079: raw views are paged and bounded; per-turn filtering is exact. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { pagedRaw, rawEntriesForTurn, rawEntryJson, type RawRecordEntry } from "./raw-view.ts";

function entry(index: number, turn = 1): RawRecordEntry {
  return { seq: index, turn, sessionUpdate: "agent_message_chunk", payload: { index } };
}

test("paging clamps into range and reports pages/total", () => {
  const entries = Array.from({ length: 250 }, (_, index) => entry(index + 1));
  assert.deepEqual(
    [pagedRaw(entries, 1, 100).page, pagedRaw(entries, 1, 100).pages, pagedRaw(entries, 1, 100).total],
    [1, 3, 250],
  );
  assert.equal(pagedRaw(entries, 2, 100).entries[0].seq, 101);
  assert.equal(pagedRaw(entries, 99, 100).page, 3, "a too-large page clamps to the last page");
  assert.equal(pagedRaw(entries, 0, 100).page, 1, "a too-small page clamps to the first page");
  assert.equal(pagedRaw(entries, 3, 100).entries.length, 50);
});

test("raw JSON display is bounded with an explicit truncation marker", () => {
  const huge: RawRecordEntry = { ...entry(1), payload: { text: "x".repeat(40_000) } };
  const bounded = rawEntryJson(huge);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.text.includes("truncated"));
  const small = rawEntryJson(entry(2));
  assert.equal(small.truncated, false);
});

test("per-turn raw disclosure selects exactly that turn's notifications", () => {
  const entries = [entry(1, 1), entry(2, 1), entry(3, 2), entry(4, 2), entry(5, 2)];
  assert.deepEqual(rawEntriesForTurn(entries, 1).map((item) => item.seq), [1, 2]);
  assert.deepEqual(rawEntriesForTurn(entries, 2).map((item) => item.seq), [3, 4, 5]);
  assert.deepEqual(rawEntriesForTurn(entries, 3), []);
});

test("unknown update kinds are representable raw entries and are not dropped", () => {
  const unknown: RawRecordEntry = { seq: 7, turn: 2, sessionUpdate: "compaction_update", payload: { future: true } };
  assert.ok(rawEntryJson(unknown).text.includes("compaction_update"));
});

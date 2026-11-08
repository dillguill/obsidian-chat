/** T072: the composer control model renders nothing when nothing is declared,
 *  keeps unknown categories as ordinary controls, and never assumes the fixed
 *  model/thinking/agent trio. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import { hasRenderableControls, PICKER_THRESHOLD, shouldUsePicker } from "./controls.ts";
import { composerControlModel } from "./controls.ts";

test("nothing declared renders nothing (no fallback trio)", () => {
  const model = composerControlModel({ modes: null, configOptions: null, commands: null });
  assert.equal(hasRenderableControls(model), false);
  assert.deepEqual(model.modes, []);
  assert.deepEqual(model.options, []);
  assert.deepEqual(model.commands, []);
});

test("an unknown category is a normal working control, not hidden or remapped", () => {
  const options = [
    { id: "future_thing", name: "Future thing", category: "invented", type: "select", currentValue: "b", options: [
      { value: "a", name: "A" },
      { value: "b", name: "B" },
    ] },
  ] as unknown as SessionConfigOption[];
  const model = composerControlModel({ modes: null, configOptions: options, commands: null });
  assert.equal(model.options.length, 1);
  assert.equal(model.options[0].id, "future_thing");
  assert.equal(model.options[0].category, "invented");
  assert.equal(model.options[0].choices.length, 2);
});

test("only declared controls appear — one declared option does not create a trio", () => {
  const options = [{ id: "model", name: "Model", type: "select", currentValue: "m", options: [{ value: "m", name: "M" }] }] as unknown as SessionConfigOption[];
  const model = composerControlModel({ modes: null, configOptions: options, commands: null });
  assert.deepEqual(model.options.map((option) => option.id), ["model"]);
  assert.equal(model.modes.length, 0);
});

test("modes and commands are included only when declared", () => {
  const modes = { currentModeId: "x", availableModes: [{ id: "x", name: "X" }] } as SessionModeState;
  const withModes = composerControlModel({ modes, configOptions: null, commands: null });
  assert.equal(hasRenderableControls(withModes), true);
  assert.equal(withModes.modes[0].current, true);
  const withCommands = composerControlModel({
    modes: null,
    configOptions: null,
    commands: [{ name: "review", description: "Review" }] as never,
  });
  assert.equal(withCommands.commands[0].name, "review");
});

test("long option lists use the searchable picker, short ones an inline menu", () => {
  const short = Array.from({ length: PICKER_THRESHOLD }, (_, index) => ({ value: String(index), name: `Choice ${index}` }));
  const long = [...short, { value: `x`, name: "One more" }];
  assert.equal(shouldUsePicker(short), false);
  assert.equal(shouldUsePicker(long), true);
});

test("switching harness declarations replaces the whole control set", () => {
  const before = composerControlModel({
    modes: { currentModeId: "a", availableModes: [{ id: "a", name: "A" }] } as SessionModeState,
    configOptions: [{ id: "model", name: "Model", type: "select", currentValue: "m", options: [{ value: "m", name: "M" }] }] as unknown as SessionConfigOption[],
    commands: null,
  });
  const after = composerControlModel({ modes: null, configOptions: null, commands: null });
  assert.equal(hasRenderableControls(before), true);
  assert.equal(hasRenderableControls(after), false);
});

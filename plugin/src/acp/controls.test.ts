/** T071: controls are a projection of the harness's declarations — modes,
 *  every config option (including unknown categories), and commands. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AvailableCommand, SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import { declaredControls, hasControls } from "./controls.ts";

const modes: SessionModeState = {
  currentModeId: "plan",
  availableModes: [
    { id: "build", name: "Build", description: "Make changes" },
    { id: "plan", name: "Plan", description: "Read-only planning" },
  ],
} as SessionModeState;

const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "m2",
    options: [
      { value: "m1", name: "Model One" },
      {
        group: "more",
        name: "More",
        options: [{ value: "m2", name: "Model Two", description: "faster" }],
      },
    ],
  },
  {
    id: "thought_level",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  },
  {
    id: "new_category",
    name: "Compiler",
    category: "some_future_category",
    type: "boolean",
    currentValue: true,
  },
] as unknown as SessionConfigOption[];

const commands: AvailableCommand[] = [
  { name: "compact", description: "Compact the conversation" },
  { name: "review", description: "Review changes" },
] as AvailableCommand[];

test("modes are normalized with their declared names and current flag", () => {
  const model = declaredControls({ modes, configOptions: null, commands: null });
  assert.deepEqual(
    model.modes.map((mode) => [mode.id, mode.name, mode.current]),
    [
      ["build", "Build", false],
      ["plan", "Plan", true],
    ],
  );
  assert.equal(model.options.length, 0, "no options are invented");
  assert.equal(model.commands.length, 0);
});

test("every declared config option is kept by its own name/type, even an unknown category", () => {
  const model = declaredControls({ modes: null, configOptions, commands: null });
  assert.deepEqual(
    model.options.map((option) => [option.id, option.name, option.type]),
    [
      ["model", "Model", "select"],
      ["thought_level", "Thinking", "select"],
      ["new_category", "Compiler", "boolean"],
    ],
  );
  const compiler = model.options.find((option) => option.id === "new_category")!;
  assert.equal(compiler.category, "some_future_category", "unknown categories are not hidden or remapped");
  assert.equal(compiler.currentValue, true);
  assert.deepEqual(compiler.choices, []);
});

test("grouped select choices are flattened in declared order with descriptions", () => {
  const model = declaredControls({ modes: null, configOptions, commands: null });
  const modelControl = model.options.find((option) => option.id === "model")!;
  assert.deepEqual(
    modelControl.choices.map((choice) => [choice.value, choice.name]),
    [
      ["m1", "Model One"],
      ["m2", "Model Two"],
    ],
  );
  assert.equal(modelControl.choices[1].description, "faster");
});

test("commands are exactly the declared names/descriptions", () => {
  const model = declaredControls({ modes: null, configOptions: null, commands });
  assert.deepEqual(
    model.commands.map((command) => command.name),
    ["compact", "review"],
  );
  assert.equal(model.commands[0].description, "Compact the conversation");
});

test("nothing declared means nothing rendered (no fallback trio)", () => {
  const empty = declaredControls({ modes: null, configOptions: null, commands: null });
  assert.deepEqual(empty, { modes: [], options: [], commands: [] });
  assert.equal(hasControls({ modes: null, configOptions: null, commands: null }), false);
  assert.equal(hasControls({ modes, configOptions: null, commands: null }), true);
});

test("a later declaration replaces earlier controls wholesale (live state normalization)", () => {
  const before = declaredControls({ modes, configOptions, commands });
  const after = declaredControls({
    modes: { currentModeId: "build", availableModes: modes.availableModes } as SessionModeState,
    configOptions: configOptions.filter((option) => option.id !== "model"),
    commands: commands.filter((command) => command.name === "compact"),
  });
  assert.equal(after.modes.find((mode) => mode.current)?.id, "build");
  assert.equal(after.options.some((option) => option.id === "model"), false, "removed declarations disappear");
  assert.deepEqual(after.commands.map((command) => command.name), ["compact"]);
  assert.equal(before.options.length, 3, "the earlier snapshot is unchanged");
});

/** Declared control normalization (FR-039…FR-041).
 *
 *  The shell renders exactly what the harness declares. Nothing here owns a
 *  category list, default value, or fallback control set: ACP's `category`
 *  field is UX metadata only, and unknown categories are rendered like any
 *  other declared option.
 */
import type {
  AvailableCommand,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionModeState,
} from "@agentclientprotocol/sdk";

export interface SelectChoice {
  value: string;
  name: string;
  description?: string;
}

/** Flattens ACP's ungrouped or grouped select options into one ordered list. */
export function flattenSelectOptions(option: SessionConfigOption): SelectChoice[] {
  if (option.type !== "select") return [];
  const out: SelectChoice[] = [];
  for (const item of option.options) {
    if ("group" in item) {
      for (const o of item.options) out.push(toChoice(o));
    } else {
      out.push(toChoice(item));
    }
  }
  return out;
}

function toChoice(o: SessionConfigSelectOption): SelectChoice {
  return o.description ? { value: o.value, name: o.name, description: o.description } : { value: o.value, name: o.name };
}

/** Current display/value for a declared option, without interpreting it. */
export function currentValueOf(option: SessionConfigOption): string | boolean {
  return option.currentValue;
}

/** Human-readable current value for a select option (falls back to the raw id). */
export function currentSelectLabel(option: SessionConfigOption): string | null {
  if (option.type !== "select") return null;
  return flattenSelectOptions(option).find((c) => c.value === option.currentValue)?.name ?? option.currentValue;
}

/** Current mode label from the declared mode state. */
export function currentModeLabel(modes: SessionModeState | null): string | null {
  if (!modes) return null;
  return modes.availableModes.find((m) => m.id === modes.currentModeId)?.name ?? modes.currentModeId;
}

/** Slash-command names exactly as the harness declared them. */
export function commandNames(commands: AvailableCommand[]): string[] {
  return commands.map((c) => c.name).filter((n): n is string => typeof n === "string" && n.length > 0);
}

/** One normalized control row for the composer: exactly the harness's
 *  declaration, with no category filtering and no plugin-owned defaults. */
export interface DeclaredControlModel {
  modes: Array<{ id: string; name: string; description?: string; current: boolean }>;
  options: Array<{
    id: string;
    name: string;
    description?: string;
    category?: string;
    type: "select" | "boolean";
    currentValue: string | boolean;
    /** Select choices (empty for boolean); grouped ACP selects are flattened
     *  in declared order. */
    choices: SelectChoice[];
  }>;
  commands: Array<{ name: string; description?: string }>;
}

/** Normalizes modes, every declared config option (whatever its category),
 *  and commands. An empty input yields an empty model — the composer renders
 *  nothing rather than a fallback set. */
export function declaredControls(input: {
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[] | null;
  commands: AvailableCommand[] | null;
}): DeclaredControlModel {
  const modes = (input.modes?.availableModes ?? []).map((mode) => ({
    id: mode.id,
    name: mode.name,
    ...(mode.description ? { description: mode.description } : {}),
    current: mode.id === input.modes?.currentModeId,
  }));
  const options = (input.configOptions ?? []).map((option) => ({
    id: option.id,
    name: option.name,
    ...(option.description ? { description: option.description } : {}),
    ...(option.category ? { category: option.category } : {}),
    type: option.type,
    currentValue: option.currentValue,
    choices: option.type === "select" ? flattenSelectOptions(option) : [],
  }));
  const commands = (input.commands ?? []).map((command) => ({
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
  }));
  return { modes, options, commands };
}

/** True when a control should be shown: a declared option/mode/command always
 *  is; the caller hides only the empty set, never a declared item. */
export function hasControls(input: {
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[] | null;
  commands: AvailableCommand[] | null;
}): boolean {
  return (
    !!input.modes?.availableModes.length ||
    !!input.configOptions?.length ||
    !!input.commands?.length
  );
}

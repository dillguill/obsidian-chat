/** Model pin/default rules — deliberately `obsidian`-free so they can be
 *  unit-tested (same convention as `session/store.ts`).
 *
 *  The plugin still owns no model *semantics*: a pin and a default are opaque
 *  harness option values, exactly like `acpConfigOverrides` (Principle II).
 *  What this module owns is the *policy* around them — which is the part that
 *  caused a real outage: the old code promoted every pick to a permanent
 *  override and replayed it forever, so a model the account could no longer
 *  use was re-sent on every new session. The rule now is:
 *
 *    - a default that the harness still offers is applied on session open;
 *    - no default means send nothing, so the harness's own config wins;
 *    - a stale default is never replayed blindly — report it and fall back.
 */

/** One decide-what-to-do-about-the-model outcome, so the ACK/UI layer only has
 *  to translate it into a `session/set_config_option` call (or a notice). */
export type ModelChoice =
  /** Leave the session on whatever the harness opened with. */
  | { action: "keep" }
  /** Send this value as the session's model. */
  | { action: "set"; value: string }
  /** A default was configured but the harness doesn't list it any more. */
  | { action: "missing"; value: string };

/** Pins are opaque strings; anything else (notably the pre-ACP BYOK shape
 *  `{ providerId, model }`) is dropped rather than migrated — those values
 *  were provider-scoped and mean nothing to a harness. */
export function normalizePinnedModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/** One-time upgrade from the pre-pin settings shape.
 *
 *  `storedDefault` is the value read from `data.json`: `undefined` means the
 *  install predates `defaultModel` (migrate from the old
 *  `acpConfigOverrides.model` so an upgrade doesn't silently switch models),
 *  while `null` is a deliberate "follow the harness" and is preserved.
 *  Either way `model` is stripped from the replay map — the default is the
 *  only thing that decides a session's model now. */
export function migrateDefaultModel(
  storedDefault: unknown,
  overrides: Record<string, string | boolean> | undefined,
): { defaultModel: string | null; overrides: Record<string, string | boolean> } {
  const rest: Record<string, string | boolean> = { ...(overrides ?? {}) };
  const legacy = typeof rest.model === "string" ? rest.model.trim() : "";
  delete rest.model;

  if (typeof storedDefault === "string") return { defaultModel: storedDefault.trim() || null, overrides: rest };
  if (storedDefault === null) return { defaultModel: null, overrides: rest };
  return { defaultModel: legacy || null, overrides: rest };
}

/** Resolve what a freshly connected session should do about its model. */
export function resolveModelChoice(
  values: ReadonlyArray<{ value: string }>,
  defaultModel: string | null,
  currentValue: string | null | undefined,
): ModelChoice {
  if (!defaultModel) return { action: "keep" }; // no default → harness decides
  if (!values.some((v) => v.value === defaultModel)) return { action: "missing", value: defaultModel };
  if (currentValue === defaultModel) return { action: "keep" };
  return { action: "set", value: defaultModel };
}

/** Pinned-first ordering for the picker. `Array.prototype.sort` is stable, so
 *  the harness's own order (its provider grouping) survives inside each half. */
export function orderModels<T extends { value: string }>(items: readonly T[], pinned: readonly string[]): T[] {
  const set = new Set(pinned);
  return [...items].sort((a, b) => Number(set.has(b.value)) - Number(set.has(a.value)));
}

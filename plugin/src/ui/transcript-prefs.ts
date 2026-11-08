/** Transcript presentation preferences shared by settings and the shell view.
 *  Pure so defaults can be tested without Obsidian. */

export type ActivityDensity = "chronological" | "grouped";

/** Expanded, arrival-order activity is the default; grouping is opt-in only
 *  (FR-047). */
export const DEFAULT_ACTIVITY_DENSITY: ActivityDensity = "chronological";

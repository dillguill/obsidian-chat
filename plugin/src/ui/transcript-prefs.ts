/** Transcript presentation preferences shared by settings and the shell view.
 *  Pure so defaults can be tested without Obsidian. */

export type ActivityDensity = "chronological" | "grouped";

/** Default transcript is a readable chat: user/assistant text with each turn's
 *  agent activity collapsed behind one disclosure. The fully expanded,
 *  arrival-order protocol stream remains an explicit opt-in (FR-047). */
export const DEFAULT_ACTIVITY_DENSITY: ActivityDensity = "grouped";

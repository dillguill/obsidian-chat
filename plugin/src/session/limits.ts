/** Runtime bounds shared by the record, raw view and replay (T115).
 *  Keeping them in one pure module means a bound cannot drift between the UI,
 *  the store and the relay. */

/** Maximum serialized size of one JSONL entry (truncated explicitly beyond). */
export const MAX_ENTRY_BYTES = 256 * 1024;

/** Maximum raw payload text rendered in the UI (local-only, lazy). */
export const RAW_DISPLAY_LIMIT = 16 * 1024;

/** Maximum entries replayed to a reconnecting device before a full-replay
 *  fallback/truncation notice. */
export const REPLAY_MAX_ENTRIES = 20_000;

/** Warn above this record size (surface per-session size in the UI). */
export const SESSION_SIZE_WARN_BYTES = 50 * 1024 * 1024;

/** Maximum harness restart attempts after an unexpected child exit. */
export const HARNESS_RESTART_ATTEMPTS = 5;

/** Remote reconnect attempts (contract: 1 s → 15 s, 8 attempts). */
export const RECONNECT_ATTEMPTS = 8;

/** Operational approval timeout (contract: 10 minutes). */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

/** Number of history entries rendered when reopening a long conversation;
 *  older content remains available through the paged raw record. */
export const HISTORY_RENDER_LIMIT = 1_000;

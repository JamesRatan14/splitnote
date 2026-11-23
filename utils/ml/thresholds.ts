/**
 * Confidence gates for showing model suggestions in the UI.
 * Shared with evals/run.ts so the reported "accuracy when shown" matches what the user sees.
 */
export const CATEGORY_HINT_MIN_CONFIDENCE = 0.2;
export const MODE_HINT_MIN_CONFIDENCE = 0.6;
/** Payment-mode prediction needs at least this many past expenses. */
export const MODE_HINT_MIN_HISTORY = 10;
/** Friend suggestions need at least this many past expenses. */
export const FRIEND_SUGGESTION_MIN_HISTORY = 3;
export const MAX_FRIEND_SUGGESTIONS = 4;

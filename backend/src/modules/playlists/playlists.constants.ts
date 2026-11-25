/** Upper bound per playlist; keeps reorders small and bounds the temporary position offset below. */
export const MAX_PLAYLIST_ITEMS = 1000;

/**
 * Reorders first park the affected rows at position + OFFSET (all above any real position), then
 * write the final positions. This avoids transient (playlist_id, position) unique violations,
 * because PostgreSQL checks a non-deferrable unique index row by row.
 */
export const POSITION_PARKING_OFFSET = 1_000_000;

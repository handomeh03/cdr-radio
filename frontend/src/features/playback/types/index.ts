import type { DesiredStatus, Station } from "@/features/stations/types";

/**
 * PLAYING: playout confirmed this track is on air. FALLBACK: playout confirmed the standby tone
 * is on air. UNKNOWN: no recent report from playout, so nothing is claimed.
 */
export type PlaybackStatus = "PLAYING" | "FALLBACK" | "UNKNOWN";

/** GET /stations/main/now-playing (public). Built only from confirmed Liquidsoap events. */
export interface NowPlaying {
  status: PlaybackStatus;
  /** True only for PLAYING. */
  confirmed: boolean;
  track: { id: string; title: string; artist: string | null; durationMs: number | null } | null;
  startedAt: string | null;
  startOffsetMs: number;
  desiredStatus: DesiredStatus;
}

/** POST /stations/main/playback/apply. Omitted fields keep their saved value; null clears the playlist. */
export interface ApplyPlaybackInput {
  activePlaylistId?: string | null;
  desiredStatus?: DesiredStatus;
  /** Cut the current track now instead of switching at the next track boundary. */
  immediate?: boolean;
}

export interface ApplyPlaybackResult {
  station: Station;
  effective: "next_track" | "now";
  control: { ok: boolean; source: "playlist" | "fallback"; flushed?: number; queued?: boolean; skipped?: boolean };
}

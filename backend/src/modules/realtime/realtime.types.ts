import type { BroadcastStatus } from '../../generated/prisma/enums.js';
import type { PlaybackStatus } from '../stations/stations.service.js';

/** Public, read-only Socket.IO namespace. Clients only listen; the server ignores anything they send. */
export const RADIO_NAMESPACE = '/radio';

/** Server-to-client event names. */
export const RADIO_EVENTS = {
  /** Confirmed playback state; sent on connect and whenever it changes. */
  nowPlaying: 'now-playing',
  /** Icecast stream health and listener count; sent on connect and whenever it changes. */
  streamStatus: 'stream-status',
} as const;

/**
 * Same fields and meaning as GET /stations/main/now-playing, with dates as ISO strings, plus when
 * the server produced it. PLAYING means playout confirmed a track start; FALLBACK that it
 * confirmed the standby source; UNKNOWN that there is no recent report. `desiredStatus` is the
 * requested setting, never proof of what is on air.
 */
export interface NowPlayingEvent {
  status: PlaybackStatus;
  confirmed: boolean;
  track: {
    id: string;
    title: string;
    artist: string | null;
    durationMs: number | null;
  } | null;
  startedAt: string | null;
  startOffsetMs: number;
  desiredStatus: BroadcastStatus;
  /** Server clock when this snapshot was produced (ISO). */
  emittedAt: string;
}

/**
 * LIVE: Icecast reports the stream mount (source connected). OFFLINE: Icecast answered but the
 * mount is not there. UNKNOWN: Icecast could not be reached or read, so nothing is claimed
 * (never "0 listeners" and never "healthy").
 */
export type StreamHealth = 'LIVE' | 'OFFLINE' | 'UNKNOWN';

/**
 * This is the SERVER's view of the stream (what Icecast reports). It is not the state of any
 * listener's own audio player.
 */
export interface StreamStatusEvent {
  status: StreamHealth;
  /** Current listeners on the mount; null unless status is LIVE. */
  listeners: number | null;
  /** When Icecast was last read successfully or unsuccessfully (ISO); null before the first poll. */
  checkedAt: string | null;
  /** Server clock when this snapshot was produced (ISO). */
  emittedAt: string;
}

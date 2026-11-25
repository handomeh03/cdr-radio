import type { NowPlaying } from "./index";

/** Socket.IO namespace and event names (read-only, server to client). Mirrors the backend contract. */
export const RADIO_NAMESPACE = "/radio";
export const RADIO_EVENTS = {
  nowPlaying: "now-playing",
  streamStatus: "stream-status",
} as const;

/** Same fields as GET /stations/main/now-playing, plus when the server produced the snapshot. */
export type NowPlayingEvent = NowPlaying & { emittedAt: string };

/**
 * LIVE: Icecast reports the mount. OFFLINE: Icecast answered but the mount is missing. UNKNOWN:
 * Icecast could not be read, so nothing is claimed. This is the server's view, not a listener's player.
 */
export type StreamHealth = "LIVE" | "OFFLINE" | "UNKNOWN";

export interface StreamStatusEvent {
  status: StreamHealth;
  /** Listeners on the mount; null unless status is LIVE. */
  listeners: number | null;
  checkedAt: string | null;
  emittedAt: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Narrow checks so a malformed payload is ignored instead of breaking the page. */
export function isNowPlayingEvent(value: unknown): value is NowPlayingEvent {
  return (
    isObject(value) &&
    (value.status === "PLAYING" || value.status === "FALLBACK" || value.status === "UNKNOWN") &&
    typeof value.confirmed === "boolean" &&
    (value.desiredStatus === "ON_AIR" || value.desiredStatus === "OFF_AIR") &&
    typeof value.startOffsetMs === "number" &&
    (value.startedAt === null || typeof value.startedAt === "string") &&
    typeof value.emittedAt === "string" &&
    (value.track === null || (isObject(value.track) && typeof value.track.title === "string"))
  );
}

export function isStreamStatusEvent(value: unknown): value is StreamStatusEvent {
  return (
    isObject(value) &&
    (value.status === "LIVE" || value.status === "OFFLINE" || value.status === "UNKNOWN") &&
    (value.listeners === null || typeof value.listeners === "number") &&
    typeof value.emittedAt === "string"
  );
}

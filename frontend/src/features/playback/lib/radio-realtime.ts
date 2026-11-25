import type { QueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { createRadioSocket } from "@/config/socket";
import { playbackKeys } from "../query-keys";
import type { NowPlaying } from "../types";
import {
  RADIO_EVENTS,
  isNowPlayingEvent,
  isStreamStatusEvent,
  type StreamStatusEvent,
} from "../types/realtime";

export interface RealtimeState {
  /** The socket is connected. */
  connected: boolean;
  /** A now-playing snapshot arrived on this connection, so the cache is current. */
  snapshot: boolean;
  /** Latest Icecast reading from the server; null when not connected (never a stale value). */
  streamStatus: StreamStatusEvent | null;
}

const OFFLINE: RealtimeState = { connected: false, snapshot: false, streamStatus: null };

/** Keeps the connection across quick unmount/mount cycles (React strict mode, route changes). */
const RELEASE_GRACE_MS = 500;
/** Bounds for retrying a connection the server refused (Socket.IO does not retry those itself). */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 10_000;

/**
 * The one shared real-time connection (metadata only; audio never uses it).
 *
 * - One Socket.IO client for the whole app. Components call `acquire()` and the connection is
 *   shared by reference count, so many components never mean many connections.
 * - Socket listeners are attached once, when the socket is created, so they cannot be duplicated.
 * - Confirmed now-playing events are written into the existing TanStack Query cache entry
 *   (`playbackKeys.nowPlaying`), so every screen that already reads it updates by itself.
 * - "Healthy" (connected and a snapshot received) lets the REST polling pause; any other state
 *   resumes it, which is the fallback.
 */
class RadioRealtime {
  private socket: Socket | null = null;
  private queryClient: QueryClient | null = null;
  private consumers = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = RETRY_MIN_MS;
  private listeners = new Set<() => void>();
  private state: RealtimeState = OFFLINE;
  /** Server clock of the newest snapshot applied on this connection (ordering guard). */
  private newestEmittedAt = 0;
  /** Local clock of the newest applied socket event (lets a slower REST response be discarded). */
  private lastEventAt = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RealtimeState => this.state;
  getServerSnapshot = (): RealtimeState => OFFLINE;
  getLastEventAt = (): number => this.lastEventAt;

  /** Starts (or joins) the shared connection. Returns the release function; safe to call twice. */
  acquire(queryClient: QueryClient): () => void {
    this.queryClient = queryClient;
    this.consumers += 1;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;

    this.socket ??= this.createSocket();
    if (this.socket && !this.socket.connected && !this.socket.active) this.socket.connect();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.consumers -= 1;
      if (this.consumers > 0) return;
      this.releaseTimer = setTimeout(() => {
        if (this.consumers === 0) this.close();
      }, RELEASE_GRACE_MS);
    };
  }

  private createSocket(): Socket | null {
    const socket = createRadioSocket();
    if (!socket) return null;

    socket.on("connect", () => {
      this.clearRetry();
      this.newestEmittedAt = 0; // a new connection starts with a fresh snapshot
      this.set({ connected: true, snapshot: false });
    });
    socket.on("disconnect", (reason) => {
      // Socket.IO does not retry after the server itself closed the connection; do it here.
      if (reason === "io server disconnect") socket.connect();
      this.set({ connected: false, snapshot: false, streamStatus: null });
      // Resume REST right away instead of waiting out the next interval.
      void this.queryClient?.invalidateQueries({ queryKey: playbackKeys.nowPlaying });
    });
    socket.on("connect_error", () => {
      // Socket.IO retries network failures itself, but not a connection the server refused
      // (socket.active is false then). Retry that here, with a growing, bounded delay.
      if (socket.active || this.retryTimer || this.consumers === 0) return;
      const delay = this.retryDelayMs;
      this.retryDelayMs = Math.min(delay * 2, RETRY_MAX_MS);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.consumers > 0 && !socket.connected) socket.connect();
      }, delay);
    });
    socket.on(RADIO_EVENTS.nowPlaying, (payload: unknown) => {
      if (!isNowPlayingEvent(payload)) return;
      const emittedAt = Date.parse(payload.emittedAt);
      if (Number.isFinite(emittedAt)) {
        if (emittedAt < this.newestEmittedAt) return; // older than what is already shown
        this.newestEmittedAt = emittedAt;
      }
      const nowPlaying: NowPlaying = {
        status: payload.status,
        confirmed: payload.confirmed,
        track: payload.track,
        startedAt: payload.startedAt,
        startOffsetMs: payload.startOffsetMs,
        desiredStatus: payload.desiredStatus,
      };
      this.lastEventAt = Date.now();
      this.queryClient?.setQueryData(playbackKeys.nowPlaying, nowPlaying);
      if (!this.state.snapshot) this.set({ snapshot: true });
    });
    socket.on(RADIO_EVENTS.streamStatus, (payload: unknown) => {
      if (isStreamStatusEvent(payload)) this.set({ streamStatus: payload });
    });
    return socket;
  }

  /** No consumers left: disconnect, and forget everything a later visitor must not see. */
  private close(): void {
    this.clearRetry();
    this.socket?.disconnect();
    this.set(OFFLINE);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelayMs = RETRY_MIN_MS;
  }

  private set(partial: Partial<RealtimeState>): void {
    const next = { ...this.state, ...partial };
    if (next.connected === this.state.connected && next.snapshot === this.state.snapshot && next.streamStatus === this.state.streamStatus) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

export const radioRealtime = new RadioRealtime();

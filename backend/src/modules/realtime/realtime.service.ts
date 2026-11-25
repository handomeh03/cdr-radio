import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import {
  PlaybackService,
  type PlaybackReport,
} from '../playback/playback.service.js';
import {
  PLAYBACK_REPORT_STALE_MS,
  StationsService,
  type NowPlayingDto,
} from '../stations/stations.service.js';
import { IcecastStatusService } from './icecast-status.service.js';
import type { NowPlayingEvent, StreamStatusEvent } from './realtime.types.js';

type Listener<T> = (event: T) => void;

/** How often a missed playout report is noticed. Cheap: it only compares timestamps in memory. */
const FRESHNESS_CHECK_MS = 5_000;

/**
 * The shared real-time state. One instance for all clients:
 *
 * - now-playing comes only from confirmed sources: a playout report stored by PlaybackService
 *   (a track or the fallback started) or a saved station setting change. Each is re-read from the
 *   same code path the REST endpoint uses, so sockets and REST can never disagree. When playout
 *   goes quiet the snapshot turns UNKNOWN on a timer, exactly like REST does.
 * - stream status (Icecast health and listeners) is read by ONE bounded poll, and only while at
 *   least one client is connected; the cached value is dropped when polling stops, so a new
 *   client never receives an old reading.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly pollMs: number;

  private nowPlaying: NowPlayingEvent | null = null;
  /** Epoch ms of the latest playout report this snapshot is based on (0 = none). */
  private reportedAtMs = 0;
  private refreshing: Promise<void> | null = null;
  private refreshQueued = false;

  private streamStatus: StreamStatusEvent = unknownStream(null);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private clientCount = 0;

  private freshnessTimer: ReturnType<typeof setInterval> | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  private readonly nowPlayingListeners = new Set<Listener<NowPlayingEvent>>();
  private readonly streamListeners = new Set<Listener<StreamStatusEvent>>();

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly stations: StationsService,
    private readonly playback: PlaybackService,
    private readonly icecast: IcecastStatusService,
  ) {
    this.pollMs = config.get('STREAM_STATUS_POLL_MS', { infer: true });
  }

  onModuleInit(): void {
    this.unsubscribe.push(
      this.playback.onReport((report) => this.onPlaybackReport(report)),
      this.stations.onSettingsChanged(() => void this.refresh()),
    );
    void this.refresh(); // prime the snapshot so the first client gets it immediately
    this.freshnessTimer = setInterval(() => this.checkFreshness(), FRESHNESS_CHECK_MS);
    this.freshnessTimer.unref();
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    if (this.freshnessTimer) clearInterval(this.freshnessTimer);
    this.freshnessTimer = null;
    this.stopPolling();
    this.nowPlayingListeners.clear();
    this.streamListeners.clear();
  }

  // ---- subscriptions (used by the gateway) ----------------------------------------------------

  onNowPlaying(listener: Listener<NowPlayingEvent>): () => void {
    this.nowPlayingListeners.add(listener);
    return () => this.nowPlayingListeners.delete(listener);
  }

  onStreamStatus(listener: Listener<StreamStatusEvent>): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  /** The current confirmed snapshot, or null if it could not be read (the client then uses REST). */
  async getNowPlaying(): Promise<NowPlayingEvent | null> {
    if (!this.nowPlaying) await this.refresh();
    return this.nowPlaying;
  }

  getStreamStatus(): StreamStatusEvent {
    return this.streamStatus;
  }

  /** Called by the gateway with the number of connected clients; starts/stops the shared poll. */
  setClientCount(count: number): void {
    const had = this.clientCount > 0;
    this.clientCount = count;
    if (count > 0 && !had) this.startPolling();
    if (count === 0 && had) this.stopPolling();
  }

  // ---- now-playing ------------------------------------------------------------------------------------

  private onPlaybackReport(report: PlaybackReport): void {
    if (report.changed || this.nowPlaying?.status === 'UNKNOWN' || !this.nowPlaying) {
      void this.refresh();
      return;
    }
    // A repeat report: playout is alive and nothing changed.
    this.reportedAtMs = Date.now();
  }

  /**
   * Re-reads the confirmed state and publishes it if it changed. Reads never overlap: a request
   * that arrives during a read runs one more read afterwards, so an older result cannot be
   * published after a newer one.
   */
  private refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshQueued = false;
        try {
          const { nowPlaying, reportedAt } = await this.stations.getNowPlayingReport();
          this.reportedAtMs = reportedAt?.getTime() ?? 0;
          this.apply(toEvent(nowPlaying));
        } catch (error) {
          this.logger.warn(
            `Could not read the now-playing state: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      } while (this.refreshQueued);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Playout went quiet: say UNKNOWN, as the REST endpoint would, without another query. */
  private checkFreshness(): void {
    const current = this.nowPlaying;
    if (!current || current.status === 'UNKNOWN') return;
    if (Date.now() - this.reportedAtMs <= PLAYBACK_REPORT_STALE_MS) return;
    this.apply({
      ...current,
      status: 'UNKNOWN',
      confirmed: false,
      track: null,
      startedAt: null,
      startOffsetMs: 0,
      emittedAt: new Date().toISOString(),
    });
  }

  private apply(next: NowPlayingEvent): void {
    const previous = this.nowPlaying;
    this.nowPlaying = next;
    if (previous && sameNowPlaying(previous, next)) return;
    for (const listener of this.nowPlayingListeners) listener(next);
  }

  // ---- stream status ----------------------------------------------------------------------------------

  private startPolling(): void {
    if (this.pollTimer) return;
    void this.pollOnce();
    this.pollTimer = setInterval(() => void this.pollOnce(), this.pollMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    // Do not keep a reading nobody is refreshing: the next client must not see an old value.
    this.streamStatus = unknownStream(null);
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return; // never overlap reads
    this.polling = true;
    try {
      const reading = await this.icecast.read();
      if (!this.pollTimer) return; // polling stopped while the read was in flight
      const next: StreamStatusEvent = {
        status: reading.status,
        listeners: reading.status === 'LIVE' ? reading.listeners : null,
        checkedAt: new Date().toISOString(),
        emittedAt: new Date().toISOString(),
      };
      const previous = this.streamStatus;
      this.streamStatus = next;
      if (previous.status === next.status && previous.listeners === next.listeners) return;
      for (const listener of this.streamListeners) listener(next);
    } finally {
      this.polling = false;
    }
  }
}

const unknownStream = (checkedAt: string | null): StreamStatusEvent => ({
  status: 'UNKNOWN',
  listeners: null,
  checkedAt,
  emittedAt: new Date().toISOString(),
});

function toEvent(dto: NowPlayingDto): NowPlayingEvent {
  return {
    status: dto.status,
    confirmed: dto.confirmed,
    // Explicit fields only: nothing else on the source object can leak into the payload.
    track: dto.track && {
      id: dto.track.id,
      title: dto.track.title,
      artist: dto.track.artist,
      durationMs: dto.track.durationMs,
    },
    startedAt: dto.startedAt ? dto.startedAt.toISOString() : null,
    startOffsetMs: dto.startOffsetMs,
    desiredStatus: dto.desiredStatus,
    emittedAt: new Date().toISOString(),
  };
}

function sameNowPlaying(a: NowPlayingEvent, b: NowPlayingEvent): boolean {
  return (
    a.status === b.status &&
    a.startedAt === b.startedAt &&
    a.startOffsetMs === b.startOffsetMs &&
    a.desiredStatus === b.desiredStatus &&
    a.track?.id === b.track?.id &&
    a.track?.title === b.track?.title &&
    a.track?.artist === b.track?.artist &&
    a.track?.durationMs === b.track?.durationMs
  );
}

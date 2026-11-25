import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { BroadcastStatus, TrackStatus } from '../../generated/prisma/enums.js';
import { R2StorageService } from '../../storage/r2-storage.service.js';
import { MAIN_STATION_SLUG } from '../stations/stations.constants.js';
import {
  StationsService,
  type StationDto,
} from '../stations/stations.service.js';
import {
  LiquidsoapControlService,
  type ControlResult,
} from '../streaming/liquidsoap-control.service.js';
import type { ApplyPlaybackDto } from './dto/apply-playback.dto.js';
import type { StreamEventDto } from './dto/stream-event.dto.js';

/** One issued request for Liquidsoap. `uri` is a short-lived presigned URL: never log it. */
export interface NextItemDto {
  occurrenceId: string;
  playlistId: string;
  itemId: string;
  position: number;
  trackId: string;
  title: string;
  artist: string;
  durationMs: number;
  uri: string;
}

export interface EventResult {
  applied: boolean;
  reason?: 'duplicate' | 'stale' | 'unknown_track' | 'logged';
}

export interface PlaybackReport {
  changed: boolean;
}

export interface ApplyResult {
  station: StationDto;
  /** When the live stream follows the new settings. */
  effective: 'next_track' | 'now';
  control: ControlResult;
}

type PlayableItem = {
  id: string;
  position: number;
  track: {
    id: string;
    title: string;
    artist: string | null;
    durationMs: number | null;
    storageKey: string | null;
  };
};

/** Events more than this far in the future are rejected (clock or payload error). */
const MAX_CLOCK_SKEW_MS = 60_000;

/**
 * The playlist scheduler and the record of confirmed playback.
 *
 * - `next()` picks what Liquidsoap should queue. It is stateless: the cursor is the item
 *   Liquidsoap last queued (`after`) or, after a Liquidsoap restart, the last confirmed item.
 *   Issuing an item changes nothing in the database, so retries and flushed prefetches can
 *   never advance the cursor or skip an item.
 * - `recordEvent()` is the only writer of StationPlayback, driven by Liquidsoap's reports of
 *   what actually started. Idempotent (same start = duplicate) and ordered (older = stale).
 */
@Injectable()
export class PlaybackService {
  private readonly logger = new Logger(PlaybackService.name);
  /** Serializes skip/apply so two admins cannot interleave control commands. */
  private controlChain: Promise<unknown> = Promise.resolve();
  private readonly reportListeners = new Set<(report: PlaybackReport) => void>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: R2StorageService,
    private readonly stations: StationsService,
    private readonly control: LiquidsoapControlService,
  ) {}

  // ---------------------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------------------

  /** The next item to queue, or null when nothing should play (fallback stays on air). */
  async next(afterItemId?: string): Promise<NextItemDto | null> {
    const station = await this.prisma.station.findUnique({
      where: { slug: MAIN_STATION_SLUG },
      select: {
        desiredStatus: true,
        activePlaylistId: true,
        playback: { select: { currentPlaylistTrackId: true } },
      },
    });
    if (
      !station ||
      station.desiredStatus !== BroadcastStatus.ON_AIR ||
      !station.activePlaylistId
    ) {
      return null;
    }
    const playlistId = station.activePlaylistId;

    // Only READY tracks that have audio in storage are playable, in playlist order.
    const items: PlayableItem[] = await this.prisma.playlistTrack.findMany({
      where: {
        playlistId,
        track: { status: TrackStatus.READY, storageKey: { not: null } },
      },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        position: true,
        track: {
          select: {
            id: true,
            title: true,
            artist: true,
            durationMs: true,
            storageKey: true,
          },
        },
      },
    });
    if (items.length === 0) return null;

    // Prefer Liquidsoap's hint (the item it queued last). Without one (Liquidsoap restarted or
    // just reloaded during the fallback), or if that item no longer exists, continue after the
    // last confirmed item instead.
    const confirmedItemId =
      station.playback?.currentPlaylistTrackId ?? undefined;
    let index = await this.indexAfter(
      items,
      playlistId,
      afterItemId ?? confirmedItemId,
    );
    if (index === 'missing' && afterItemId && confirmedItemId) {
      index = await this.indexAfter(items, playlistId, confirmedItemId);
    }
    const item = items[index === 'missing' ? 0 : index];

    const { url } = await this.storage.getPresignedGetUrl(
      item.track.storageKey!,
    );
    const occurrenceId = randomUUID();
    this.logger.debug(
      `Issued occurrence ${occurrenceId} for item ${item.id} (position ${item.position})`,
    );
    return {
      occurrenceId,
      playlistId,
      itemId: item.id,
      position: item.position,
      trackId: item.track.id,
      title: item.track.title,
      artist: item.track.artist ?? '',
      durationMs: item.track.durationMs ?? 0,
      uri: inNormalizedForm(url),
    };
  }

  /**
   * Index of the item to play after `hintItemId` in `items` (wrapping), 0 when the hint is
   * empty or belongs to another playlist, or 'missing' when the hinted item no longer exists.
   */
  private async indexAfter(
    items: PlayableItem[],
    playlistId: string,
    hintItemId: string | undefined,
  ): Promise<number | 'missing'> {
    if (!hintItemId) return 0;
    const found = items.findIndex((item) => item.id === hintItemId);
    if (found >= 0) return (found + 1) % items.length;

    // Not playable right now: it may be in another playlist, unplayable, or deleted.
    const hinted = await this.prisma.playlistTrack.findUnique({
      where: { id: hintItemId },
      select: { playlistId: true, position: true },
    });
    if (!hinted) return 'missing';
    if (hinted.playlistId !== playlistId) return 0; // playlist switched: start from the top
    const after = items.findIndex((item) => item.position > hinted.position);
    return after >= 0 ? after : 0;
  }

  // ---------------------------------------------------------------------------------------
  // Confirmed playback
  // ---------------------------------------------------------------------------------------

  async recordEvent(event: StreamEventDto): Promise<EventResult> {
    if (event.type === 'request_failed') {
      this.logger.warn(
        `Liquidsoap could not play item ${event.itemId} (occurrence ${event.occurrenceId})` +
          (event.detail ? `: ${event.detail}` : ''),
      );
      return { applied: false, reason: 'logged' };
    }

    const startedAt = new Date(Math.round(event.startedAt * 1000));
    if (startedAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
      throw new BadRequestException('startedAt is in the future');
    }

    const station = await this.prisma.station.findUnique({
      where: { slug: MAIN_STATION_SLUG },
      select: {
        id: true,
        playback: {
          select: {
            startedAt: true,
            currentTrackId: true,
            currentPlaylistTrackId: true,
          },
        },
      },
    });
    if (!station?.playback) {
      throw new NotFoundException(
        'Station not found; it has not been set up yet',
      );
    }
    const current = station.playback;
    const now = new Date();

    // Same start already recorded (repeated delivery or a heartbeat): just mark it as alive.
    const sameStart = current.startedAt?.getTime() === startedAt.getTime();
    const sameContent =
      event.source === 'fallback'
        ? current.currentTrackId === null
        : current.currentTrackId === event.trackId &&
          current.currentPlaylistTrackId === event.itemId;
    if (sameStart && sameContent) {
      await this.prisma.stationPlayback.update({
        where: { stationId: station.id },
        data: { updatedAt: now },
      });
      this.notifyReport({ changed: false });
      return { applied: true, reason: 'duplicate' };
    }

    let data: {
      currentTrackId: string | null;
      currentPlaylistTrackId?: string | null;
    };
    if (event.source === 'fallback') {
      // Keep currentPlaylistTrackId: it is the cursor to resume the playlist after the fallback.
      data = { currentTrackId: null };
    } else {
      const [track, item] = await Promise.all([
        this.prisma.track.findUnique({
          where: { id: event.trackId },
          select: { id: true },
        }),
        this.prisma.playlistTrack.findUnique({
          where: { id: event.itemId },
          select: { id: true },
        }),
      ]);
      if (!track) {
        this.logger.warn(`Ignoring start of unknown track ${event.trackId}`);
        return { applied: false, reason: 'unknown_track' };
      }
      data = {
        currentTrackId: track.id,
        currentPlaylistTrackId: item?.id ?? null,
      };
    }

    // Atomic stale guard: only move forward in time (out-of-order deliveries are ignored).
    const { count } = await this.prisma.stationPlayback.updateMany({
      where: {
        stationId: station.id,
        OR: [{ startedAt: null }, { startedAt: { lte: startedAt } }],
      },
      data: { ...data, startedAt, startOffsetMs: 0, updatedAt: now },
    });
    if (count === 0) return { applied: false, reason: 'stale' };
    this.notifyReport({ changed: true });
    return { applied: true };
  }

  /**
   * Calls the listener after a playout report was stored: `changed` is true when the confirmed
   * state moved (a new track or the fallback started), false for a repeat that only proves
   * playout is alive. Only stored reports notify; ignored (stale, unknown, failed) ones do not.
   * Returns the unsubscribe function.
   */
  onReport(listener: (report: PlaybackReport) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  private notifyReport(report: PlaybackReport): void {
    for (const listener of this.reportListeners) {
      try {
        listener(report);
      } catch (error) {
        // A subscriber must never turn a stored playout event into a failed request.
        this.logger.warn(
          `A playback report listener failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Admin controls
  // ---------------------------------------------------------------------------------------

  /** Ends the current playlist track; the already-queued next item starts immediately. */
  skip(): Promise<{ skipped: true }> {
    return this.serialized(async () => {
      const result = await this.control.skip();
      if (!result.skipped) {
        throw new ConflictException(
          'Nothing to skip: the station is playing its fallback source',
        );
      }
      return { skipped: true as const };
    });
  }

  /**
   * Saves any supplied settings, then makes the live stream follow them: prefetched requests are
   * dropped and the next item is chosen again (next track boundary), or the current track is cut
   * as well (`immediate`). The settings are saved first, so a playout failure is reported as such.
   */
  apply(dto: ApplyPlaybackDto): Promise<ApplyResult> {
    return this.serialized(async () => {
      const { immediate = false, activePlaylistId, desiredStatus } = dto;
      const station =
        activePlaylistId !== undefined || desiredStatus !== undefined
          ? await this.stations.update({ activePlaylistId, desiredStatus })
          : await this.stations.getMain();

      let control: ControlResult;
      try {
        control = await this.control.reload({ skip: immediate });
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        throw new HttpException(
          {
            message: `Settings were saved, but the live stream was not updated: ${error.message}`,
            settingsSaved: true,
          },
          error.getStatus(),
        );
      }
      return { station, effective: immediate ? 'now' : 'next_track', control };
    });
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.controlChain.then(work, work);
    this.controlChain = run.catch(() => undefined);
    return run;
  }
}

/**
 * Liquidsoap's HTTP client logs the full URL whenever it differs from its normalized form, and
 * the only difference in a presigned URL is the %2F inside X-Amz-Credential. Sending literal
 * slashes (which S3/R2 decode to the same value, so the signature stays valid) keeps signed
 * URLs out of the Liquidsoap logs.
 */
export function inNormalizedForm(presignedUrl: string): string {
  return presignedUrl.replace(/%2F/gi, '/');
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { BroadcastStatus } from '../../generated/prisma/enums.js';
import type { UpdateStationDto } from './dto/update-station.dto.js';
import { MAIN_STATION_SLUG } from './stations.constants.js';

/** Public-safe fields only. */
const stationSelect = {
  slug: true,
  name: true,
  desiredStatus: true,
  updatedAt: true,
  activePlaylist: {
    select: { id: true, name: true, _count: { select: { items: true } } },
  },
} as const satisfies Prisma.StationSelect;

const nowPlayingSelect = {
  desiredStatus: true,
  playback: {
    select: {
      startedAt: true,
      startOffsetMs: true,
      updatedAt: true,
      currentTrack: {
        select: { id: true, title: true, artist: true, durationMs: true },
      },
    },
  },
} as const satisfies Prisma.StationSelect;

type StationRow = Prisma.StationGetPayload<{ select: typeof stationSelect }>;
type NowPlayingRow = Prisma.StationGetPayload<{ select: typeof nowPlayingSelect }>;

export interface StationDto {
  slug: string;
  name: string;
  /** What the admin has asked for; not proof that audio is on air. */
  desiredStatus: BroadcastStatus;
  /** The playlist the station is configured to broadcast, or null. */
  activePlaylist: { id: string; name: string; trackCount: number } | null;
  updatedAt: Date;
}

/**
 * PLAYING: playout confirmed this track is on air. FALLBACK: playout confirmed the safety
 * source is on air (no playlist track; the stream is still running). UNKNOWN: no recent report
 * from playout (never started, restarting, or unreachable), so nothing is claimed.
 */
export type PlaybackStatus = 'PLAYING' | 'FALLBACK' | 'UNKNOWN';

/** Playout reports at least every 15 s; older state is not trusted. */
export const PLAYBACK_REPORT_STALE_MS = 45_000;

export interface NowPlayingDto {
  status: PlaybackStatus;
  /** True only when status is PLAYING (a real, recent track start). */
  confirmed: boolean;
  track: {
    id: string;
    title: string;
    artist: string | null;
    durationMs: number | null;
  } | null;
  /** When the current track (or the fallback) started; null when UNKNOWN. */
  startedAt: Date | null;
  startOffsetMs: number;
  /** The admin's requested state (OFF_AIR means the fallback plays; the stream keeps running). */
  desiredStatus: BroadcastStatus;
}

const toStationDto = ({ activePlaylist, ...rest }: StationRow): StationDto => ({
  ...rest,
  activePlaylist: activePlaylist && {
    id: activePlaylist.id,
    name: activePlaylist.name,
    trackCount: activePlaylist._count.items,
  },
});

/**
 * Station settings and the confirmed playback state. Settings changes here do not touch the live
 * stream; PlaybackService applies them (POST /stations/main/playback/apply) and is the only
 * writer of the playback state, from Liquidsoap's confirmed events.
 */
@Injectable()
export class StationsService {
  private readonly settingsListeners = new Set<() => void>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calls the listener after the station's saved settings change. Lets the real-time layer
   * follow changes without this service depending on it. Returns the unsubscribe function.
   */
  onSettingsChanged(listener: () => void): () => void {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  }

  async getMain(): Promise<StationDto> {
    const row = await this.prisma.station.findUnique({
      where: { slug: MAIN_STATION_SLUG },
      select: stationSelect,
    });
    if (!row) throw stationNotFound();
    return toStationDto(row);
  }

  /**
   * Reports only what playout confirmed recently. Settings are never used to infer playback,
   * and a missing or stale report (lost events, playout down) is UNKNOWN, not the last track.
   */
  async getNowPlaying(now = new Date()): Promise<NowPlayingDto> {
    return (await this.getNowPlayingReport(now)).nowPlaying;
  }

  /**
   * getNowPlaying plus the time of the latest playout report (null if none). The real-time layer
   * uses it to notice, without querying again, when a report goes stale.
   */
  async getNowPlayingReport(
    now = new Date(),
  ): Promise<{ nowPlaying: NowPlayingDto; reportedAt: Date | null }> {
    const row = await this.prisma.station.findUnique({
      where: { slug: MAIN_STATION_SLUG },
      select: nowPlayingSelect,
    });
    if (!row) throw stationNotFound();

    const { desiredStatus, playback } = row;
    const reportedAt = playback?.startedAt ? playback.updatedAt : null;
    const fresh =
      !!playback?.startedAt &&
      now.getTime() - playback.updatedAt.getTime() <= PLAYBACK_REPORT_STALE_MS;
    return { nowPlaying: this.toNowPlaying(desiredStatus, playback, fresh), reportedAt };
  }

  private toNowPlaying(
    desiredStatus: BroadcastStatus,
    playback: NowPlayingRow['playback'],
    fresh: boolean,
  ): NowPlayingDto {
    if (!fresh || !playback) {
      return {
        status: 'UNKNOWN',
        confirmed: false,
        track: null,
        startedAt: null,
        startOffsetMs: 0,
        desiredStatus,
      };
    }
    if (!playback.currentTrack) {
      return {
        status: 'FALLBACK',
        confirmed: false,
        track: null,
        startedAt: playback.startedAt,
        startOffsetMs: 0,
        desiredStatus,
      };
    }
    return {
      status: 'PLAYING',
      confirmed: true,
      track: playback.currentTrack,
      startedAt: playback.startedAt,
      startOffsetMs: playback.startOffsetMs,
      desiredStatus,
    };
  }

  async update(dto: UpdateStationDto): Promise<StationDto> {
    const data: Prisma.StationUncheckedUpdateInput = {};
    if (dto.desiredStatus !== undefined) data.desiredStatus = dto.desiredStatus;
    if (dto.activePlaylistId !== undefined) {
      data.activePlaylistId = dto.activePlaylistId;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Provide activePlaylistId and/or desiredStatus to update',
      );
    }

    if (dto.activePlaylistId) {
      const playlist = await this.prisma.playlist.findUnique({
        where: { id: dto.activePlaylistId },
        select: { id: true },
      });
      if (!playlist) throw new NotFoundException('Playlist not found');
    }

    try {
      const station = toStationDto(
        await this.prisma.station.update({
          where: { slug: MAIN_STATION_SLUG },
          data,
          select: stationSelect,
        }),
      );
      for (const listener of this.settingsListeners) {
        try {
          listener();
        } catch {
          // A subscriber must never turn a saved change into a failed request.
        }
      }
      return station;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw stationNotFound();
        // The playlist was deleted between the check above and this update.
        if (error.code === 'P2003') {
          throw new NotFoundException('Playlist not found');
        }
      }
      throw error;
    }
  }
}

const stationNotFound = () =>
  new NotFoundException('Station not found; it has not been set up yet');

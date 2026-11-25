import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { TrackStatus } from '../../generated/prisma/enums.js';
import type { AddPlaylistTrackDto } from './dto/add-playlist-track.dto.js';
import type { CreatePlaylistDto } from './dto/create-playlist.dto.js';
import type { ListPlaylistsQueryDto } from './dto/list-playlists-query.dto.js';
import type { UpdatePlaylistDto } from './dto/update-playlist.dto.js';
import {
  MAX_PLAYLIST_ITEMS,
  POSITION_PARKING_OFFSET,
} from './playlists.constants.js';

const summarySelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} as const satisfies Prisma.PlaylistSelect;

/** Safe track metadata only: no storage key, size or error details. */
const itemSelect = {
  id: true,
  position: true,
  track: {
    select: { id: true, title: true, artist: true, durationMs: true },
  },
} as const satisfies Prisma.PlaylistTrackSelect;

type SummaryRow = Prisma.PlaylistGetPayload<{ select: typeof summarySelect }>;

export type PlaylistItemDto = Prisma.PlaylistTrackGetPayload<{
  select: typeof itemSelect;
}>;

export interface PlaylistSummaryDto {
  id: string;
  name: string;
  description: string | null;
  trackCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlaylistDetailDto extends PlaylistSummaryDto {
  totalDurationMs: number;
  /** Ordered by position (0-based). */
  items: PlaylistItemDto[];
}

export interface PlaylistPage {
  items: PlaylistSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const IN_USE_BY_STATION =
  'Playlist is selected by a station; choose another playlist for the station first';

const toSummary = ({ _count, ...rest }: SummaryRow): PlaylistSummaryDto => ({
  ...rest,
  trackCount: _count.items,
});

/**
 * Playlist management. Every change to a playlist's items runs in one transaction that first
 * locks the playlist row, so concurrent edits of the same playlist are applied one at a time.
 */
@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreatePlaylistDto,
    createdById: string,
  ): Promise<PlaylistSummaryDto> {
    const row = await this.prisma.playlist.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        createdById,
      },
      select: summarySelect,
    });
    return toSummary(row);
  }

  async list(query: ListPlaylistsQueryDto): Promise<PlaylistPage> {
    const { page, pageSize, search } = query;
    const where: Prisma.PlaylistWhereInput = search
      ? { name: { contains: search, mode: 'insensitive' } }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.playlist.findMany({
        where,
        select: summarySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.playlist.count({ where }),
    ]);
    return {
      items: rows.map(toSummary),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<PlaylistDetailDto> {
    const row = await this.prisma.playlist.findUnique({
      where: { id },
      select: {
        ...summarySelect,
        items: { orderBy: { position: 'asc' }, select: itemSelect },
      },
    });
    if (!row) throw new NotFoundException('Playlist not found');

    const { items, ...summary } = row;
    return {
      ...toSummary(summary),
      totalDurationMs: items.reduce(
        (sum, item) => sum + (item.track.durationMs ?? 0),
        0,
      ),
      items,
    };
  }

  async update(
    id: string,
    dto: UpdatePlaylistDto,
  ): Promise<PlaylistSummaryDto> {
    const data: Prisma.PlaylistUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Provide name and/or description to update',
      );
    }
    try {
      return toSummary(
        await this.prisma.playlist.update({
          where: { id },
          data,
          select: summarySelect,
        }),
      );
    } catch (error) {
      throw mapPrismaError(error, 'Playlist not found');
    }
  }

  /**
   * Deletes the playlist and (by cascade) its items. Tracks and R2 audio are untouched.
   * A playlist selected by a station cannot be deleted (409): switch the station first.
   */
  async remove(id: string): Promise<void> {
    const stationsUsingIt = await this.prisma.station.count({
      where: { activePlaylistId: id },
    });
    if (stationsUsingIt > 0) throw new ConflictException(IN_USE_BY_STATION);

    try {
      await this.prisma.playlist.delete({ where: { id } });
    } catch (error) {
      // The RESTRICT foreign key catches a station selecting it since the check above.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(IN_USE_BY_STATION);
      }
      throw mapPrismaError(error, 'Playlist not found');
    }
  }

  /** Appends a READY track at the end (position = current length). */
  async addTrack(
    playlistId: string,
    dto: AddPlaylistTrackDto,
  ): Promise<PlaylistItemDto> {
    return this.withPlaylistLock(playlistId, async (tx) => {
      const track = await tx.track.findUnique({
        where: { id: dto.trackId },
        select: { status: true },
      });
      if (!track) throw new NotFoundException('Track not found');
      if (track.status !== TrackStatus.READY) {
        throw new ConflictException(
          'Only READY tracks can be added to a playlist',
        );
      }

      const { _max, _count } = await tx.playlistTrack.aggregate({
        where: { playlistId },
        _max: { position: true },
        _count: { _all: true },
      });
      if (_count._all >= MAX_PLAYLIST_ITEMS) {
        throw new ConflictException(
          `A playlist can hold at most ${MAX_PLAYLIST_ITEMS} tracks`,
        );
      }

      try {
        return await tx.playlistTrack.create({
          data: {
            playlistId,
            trackId: dto.trackId,
            position: (_max.position ?? -1) + 1,
          },
          select: itemSelect,
        });
      } catch (error) {
        // The track was deleted between the check above and the insert.
        throw mapPrismaError(error, 'Track not found');
      }
    });
  }

  /** Removes one item and shifts the items after it up so positions stay 0..n-1. */
  async removeItem(playlistId: string, itemId: string): Promise<void> {
    await this.withPlaylistLock(playlistId, async (tx) => {
      const ids = await this.currentItemIds(tx, playlistId);
      const index = ids.indexOf(itemId);
      if (index < 0) throw new NotFoundException('Playlist item not found');

      await tx.playlistTrack.delete({ where: { id: itemId } });
      ids.splice(index, 1);
      await this.rewritePositions(tx, ids, index);
    });
  }

  /** `itemIds` must list every current playlist-item id exactly once, in the new order. */
  async reorder(
    playlistId: string,
    itemIds: string[],
  ): Promise<PlaylistDetailDto> {
    await this.withPlaylistLock(playlistId, async (tx) => {
      if (new Set(itemIds).size !== itemIds.length) {
        throw new BadRequestException('itemIds must not contain duplicates');
      }
      const current = await this.currentItemIds(tx, playlistId);
      const known = new Set(current);
      if (itemIds.some((id) => !known.has(id))) {
        throw new ConflictException(
          'itemIds contains ids that are not items of this playlist; reload it and retry',
        );
      }
      if (itemIds.length !== current.length) {
        throw new ConflictException(
          'itemIds must list every item of the playlist exactly once; reload it and retry',
        );
      }

      const firstChanged = itemIds.findIndex((id, i) => id !== current[i]);
      if (firstChanged >= 0) {
        await this.rewritePositions(tx, itemIds, firstChanged);
      }
    });
    return this.findOne(playlistId);
  }

  /**
   * Runs `work` in a transaction that holds the playlist's row lock: UPDATE takes a row lock
   * until commit, so a second editor waits and then sees the first editor's committed result.
   * (It also bumps the playlist's updatedAt.) Throws 404 if the playlist does not exist.
   */
  private withPlaylistLock<T>(
    playlistId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        try {
          await tx.playlist.update({
            where: { id: playlistId },
            data: { updatedAt: new Date() },
            select: { id: true },
          });
        } catch (error) {
          throw mapPrismaError(error, 'Playlist not found');
        }
        return work(tx);
      },
      { timeout: 10_000 },
    );
  }

  private async currentItemIds(
    tx: Prisma.TransactionClient,
    playlistId: string,
  ): Promise<string[]> {
    const rows = await tx.playlistTrack.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Gives `orderedIds[fromIndex..]` the positions fromIndex.., leaving earlier items untouched.
   * Rows are first parked far above any real position, then written to their final slots, so the
   * (playlist_id, position) unique index is never violated part-way through.
   */
  private async rewritePositions(
    tx: Prisma.TransactionClient,
    orderedIds: string[],
    fromIndex: number,
  ): Promise<void> {
    const moving = orderedIds.slice(fromIndex);
    if (moving.length === 0) return;

    await tx.playlistTrack.updateMany({
      where: { id: { in: moving } },
      data: { position: { increment: POSITION_PARKING_OFFSET } },
    });
    for (const [offset, id] of moving.entries()) {
      await tx.playlistTrack.update({
        where: { id },
        data: { position: fromIndex + offset },
        select: { id: true },
      });
    }
  }
}

function mapPrismaError(error: unknown, notFoundMessage: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025: record not found; P2003: a referenced row (the track) no longer exists.
    if (error.code === 'P2025' || error.code === 'P2003') {
      return new NotFoundException(notFoundMessage);
    }
  }
  return error;
}

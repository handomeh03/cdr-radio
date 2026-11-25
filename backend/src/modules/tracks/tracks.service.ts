import { parse } from 'node:path';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { TrackStatus } from '../../generated/prisma/enums.js';
import {
  R2StorageService,
  StorageError,
} from '../../storage/r2-storage.service.js';
import {
  AudioProcessingError,
  AudioProcessingService,
  cleanTag,
  type ProbedAudio,
} from './audio/audio-processing.service.js';
import type { ListTracksQueryDto } from './dto/list-tracks-query.dto.js';
import type { UpdateTrackDto } from './dto/update-track.dto.js';
import type { UploadTrackDto } from './dto/upload-track.dto.js';

/** Fields returned by the API. The storage key is internal and never exposed. */
export const trackSelect = {
  id: true,
  title: true,
  artist: true,
  status: true,
  durationMs: true,
  sourceFormat: true,
  sizeBytes: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TrackSelect;

export type TrackDto = Prisma.TrackGetPayload<{ select: typeof trackSelect }>;

export interface TrackPage {
  items: TrackDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UploadedAudioFile {
  path: string;
  originalname: string;
  size: number;
}

export const trackStorageKey = (id: string) => `tracks/${id}.mp3`;

const IN_PLAYLIST_MESSAGE =
  'Track is used in a playlist; remove it from all playlists first';

type Stage = 'transcode' | 'upload' | 'save';

@Injectable()
export class TracksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TracksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audio: AudioProcessingService,
    private readonly storage: R2StorageService,
  ) {}

  /** Processing is synchronous in one process, so PROCESSING rows at startup were interrupted. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const { count } = await this.prisma.track.updateMany({
        where: { status: TrackStatus.PROCESSING },
        data: {
          status: TrackStatus.FAILED,
          errorMessage: 'Processing was interrupted',
        },
      });
      if (count > 0)
        this.logger.warn(`Marked ${count} interrupted track(s) as FAILED`);
    } catch {
      this.logger.error('Could not check for interrupted tracks at startup');
    }
  }

  /**
   * Validate -> create PROCESSING row -> transcode -> upload to R2 -> READY.
   * Any failure after the row exists marks it FAILED; temp files are always removed.
   */
  async upload(
    file: UploadedAudioFile,
    dto: UploadTrackDto,
  ): Promise<TrackDto> {
    const outputPath = this.audio.newOutputPath();
    try {
      let probed: ProbedAudio;
      try {
        probed = await this.audio.probeUpload(file.path);
      } catch (error) {
        throw toHttpError(error, 'transcode');
      }

      const track = await this.prisma.track.create({
        data: {
          title:
            dto.title ?? probed.title ?? titleFromFileName(file.originalname),
          artist: dto.artist ?? probed.artist,
          sourceFormat: probed.format,
          status: TrackStatus.PROCESSING,
        },
        select: { id: true },
      });
      return await this.process(track.id, file.path, probed, outputPath);
    } finally {
      await this.audio.removeTempFiles(file.path, outputPath);
    }
  }

  private async process(
    id: string,
    inputPath: string,
    probed: ProbedAudio,
    outputPath: string,
  ): Promise<TrackDto> {
    const key = trackStorageKey(id);
    let stage: Stage = 'transcode';
    try {
      const result = await this.audio.transcodeToMp3(
        inputPath,
        probed,
        outputPath,
      );
      stage = 'upload';
      await this.storage.uploadFile(
        key,
        outputPath,
        'audio/mpeg',
        result.sizeBytes,
      );
      stage = 'save';
      return await this.prisma.track.update({
        where: { id },
        data: {
          status: TrackStatus.READY,
          storageKey: key,
          durationMs: result.durationMs,
          sizeBytes: result.sizeBytes,
          errorMessage: null,
        },
        select: trackSelect,
      });
    } catch (error) {
      const httpError = toHttpError(error, stage, id);
      this.logger.warn(
        `Track ${id} failed at ${stage}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      // A failed or uncertain upload may still have written the object: remove it (idempotent).
      if (stage !== 'transcode') {
        await this.storage.deleteObject(key).catch(() => {
          this.logger.error(
            `Could not remove object for failed track ${id}; key ${key} may be orphaned`,
          );
        });
      }
      await this.prisma.track
        .update({
          where: { id },
          data: {
            status: TrackStatus.FAILED,
            errorMessage: publicMessage(httpError),
          },
        })
        .catch(() => this.logger.error(`Could not mark track ${id} as FAILED`));
      throw httpError;
    }
  }

  async list(query: ListTracksQueryDto): Promise<TrackPage> {
    const { page, pageSize, search, status } = query;
    const where: Prisma.TrackWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { artist: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.track.findMany({
        where,
        select: trackSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.track.count({ where }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<TrackDto> {
    const track = await this.prisma.track.findUnique({
      where: { id },
      select: trackSelect,
    });
    if (!track) throw new NotFoundException('Track not found');
    return track;
  }

  async update(id: string, dto: UpdateTrackDto): Promise<TrackDto> {
    const data: Prisma.TrackUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.artist !== undefined) data.artist = dto.artist;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Provide title and/or artist to update');
    }
    try {
      return await this.prisma.track.update({
        where: { id },
        data,
        select: trackSelect,
      });
    } catch (error) {
      throw notFoundIfMissing(error);
    }
  }

  /**
   * A track used by any playlist cannot be deleted (409) and its audio is left untouched.
   *
   * The row is deleted first, inside a transaction, and the R2 object second. A referenced
   * track therefore fails at the database (explicit check, plus the RESTRICT foreign key as a
   * backstop against races) before any audio is removed. If the R2 delete fails, the transaction
   * rolls back, so the row and its audio stay consistent and the request can simply be retried.
   */
  async remove(id: string): Promise<void> {
    const track = await this.prisma.track.findUnique({
      where: { id },
      select: { status: true, storageKey: true },
    });
    if (!track) throw new NotFoundException('Track not found');
    if (track.status === TrackStatus.PROCESSING) {
      throw new ConflictException('Track is still processing');
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const references = await tx.playlistTrack.count({
            where: { trackId: id },
          });
          if (references > 0) throw new ConflictException(IN_PLAYLIST_MESSAGE);

          await tx.track.delete({ where: { id } });
          if (track.storageKey) {
            await this.storage.deleteObject(track.storageKey).catch(() => {
              throw new BadGatewayException(
                'Could not delete the stored audio; try again',
              );
            });
          }
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(IN_PLAYLIST_MESSAGE);
      }
      throw notFoundIfMissing(error);
    }
  }
}

function toHttpError(
  error: unknown,
  stage: Stage,
  trackId?: string,
): HttpException {
  const body = (message: string) => (trackId ? { message, trackId } : message);
  if (error instanceof HttpException) return error;
  if (error instanceof AudioProcessingError) {
    return error.code === 'UNAVAILABLE'
      ? new ServiceUnavailableException(body(error.message))
      : new UnprocessableEntityException(body(error.message));
  }
  if (error instanceof StorageError || stage === 'upload') {
    return new BadGatewayException(body('Could not store the processed audio'));
  }
  return new InternalServerErrorException(body('Could not save the track'));
}

function publicMessage(error: HttpException): string {
  const response = error.getResponse();
  const message =
    typeof response === 'string'
      ? response
      : (response as { message?: unknown }).message;
  return typeof message === 'string'
    ? message.slice(0, 200)
    : 'Processing failed';
}

function notFoundIfMissing(error: unknown): unknown {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
    ? new NotFoundException('Track not found')
    : error;
}

/** "my_song-01.flac" -> "my song-01". Used only as display metadata, never as a storage key. */
export function titleFromFileName(originalName: string): string {
  return (
    cleanTag(parse(originalName).name.replace(/_/g, ' ')) ?? 'Untitled track'
  );
}

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { TrackStatus } from '../../generated/prisma/enums.js';
import {
  StorageError,
  type R2StorageService,
} from '../../storage/r2-storage.service.js';
import {
  AudioProcessingError,
  type AudioProcessingService,
  type ProbedAudio,
} from './audio/audio-processing.service.js';
import { titleFromFileName, TracksService } from './tracks.service.js';

const ID = '0b7c6f1e-3c1d-4b8e-9a2f-5d4e3c2b1a00';
const FILE = {
  path: '/tmp/work/upload-x',
  originalname: 'My_Song.flac',
  size: 1234,
};
const PROBED: ProbedAudio = {
  format: 'flac',
  demuxer: 'flac',
  durationMs: 3000,
  title: null,
  artist: null,
};

function setup() {
  const prisma = {
    track: {
      create: vi.fn().mockResolvedValue({ id: ID }),
      update: vi
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: ID, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
    },
    playlistTrack: { count: vi.fn().mockResolvedValue(0) },
    // Array form (list) and interactive form (remove, which receives this same mock as `tx`).
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const audio = {
    newOutputPath: vi.fn().mockReturnValue('/tmp/work/out-y.mp3'),
    probeUpload: vi.fn().mockResolvedValue(PROBED),
    transcodeToMp3: vi
      .fn()
      .mockResolvedValue({ durationMs: 3010, sizeBytes: 48_000 }),
    removeTempFiles: vi.fn().mockResolvedValue(undefined),
    adoptUpload: vi.fn().mockResolvedValue('/tmp/work/upload-owned'),
  };
  const storage = {
    uploadFile: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
  const service = new TracksService(
    prisma as unknown as PrismaService,
    audio as unknown as AudioProcessingService,
    storage as unknown as R2StorageService,
  );
  const failedUpdate = () =>
    prisma.track.update.mock.calls.find(
      ([arg]) => arg.data.status === TrackStatus.FAILED,
    )?.[0];
  return { prisma, audio, storage, service, failedUpdate };
}

const OWNED = '/tmp/work/upload-owned';
const expectTempCleanup = (audio: ReturnType<typeof setup>['audio']) =>
  expect(audio.removeTempFiles).toHaveBeenCalledWith(OWNED, '/tmp/work/out-y.mp3');

describe('TracksService.upload', () => {
  it('answers at once with the PROCESSING row, then converts, uploads to tracks/{id}.mp3 and marks READY', async () => {
    const { prisma, audio, storage, service } = setup();
    const result = await service.upload(FILE, { title: 'Given Title' });

    expect(prisma.track.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Given Title',
          status: TrackStatus.PROCESSING,
          sourceFormat: 'flac',
        }),
      }),
    );
    expect(result).toMatchObject({ id: ID });

    await service.whenIdle();
    expect(audio.adoptUpload).toHaveBeenCalledWith(FILE.path);
    expect(storage.uploadFile).toHaveBeenCalledWith(
      `tracks/${ID}.mp3`,
      '/tmp/work/out-y.mp3',
      'audio/mpeg',
      48_000,
    );
    expect(prisma.track.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID },
        data: expect.objectContaining({
          status: TrackStatus.READY,
          durationMs: 3010,
          sizeBytes: 48_000,
          storageKey: `tracks/${ID}.mp3`,
        }),
      }),
    );
    expectTempCleanup(audio);
  });

  it('does not wait for the conversion before answering', async () => {
    const { audio, storage, service } = setup();
    let finish: (v: { durationMs: number; sizeBytes: number }) => void = () => {};
    audio.transcodeToMp3.mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    const result = await service.upload(FILE, {});
    expect(result).toMatchObject({ id: ID });
    expect(storage.uploadFile).not.toHaveBeenCalled(); // still converting
    finish({ durationMs: 1, sizeBytes: 2 });
    await service.whenIdle();
    expect(storage.uploadFile).toHaveBeenCalled();
  });

  it('converts one track at a time, in order', async () => {
    const { audio, service } = setup();
    const events: string[] = [];
    let release: () => void = () => {};
    audio.transcodeToMp3
      .mockImplementationOnce(async () => {
        events.push('first start');
        await new Promise<void>((resolve) => (release = resolve));
        events.push('first end');
        return { durationMs: 1, sizeBytes: 2 };
      })
      .mockImplementationOnce(async () => {
        events.push('second start');
        return { durationMs: 1, sizeBytes: 2 };
      });
    await service.upload(FILE, {});
    await service.upload(FILE, {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['first start']); // the second waits
    release();
    await service.whenIdle();
    expect(events).toEqual(['first start', 'first end', 'second start']);
  });

  it('refuses new uploads (503, no row) when too many are waiting', async () => {
    const { prisma, audio, service } = setup();
    audio.transcodeToMp3.mockReturnValue(new Promise(() => {})); // never finishes
    for (let i = 0; i < 5; i++) await service.upload(FILE, {});
    await expect(service.upload(FILE, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.track.create).toHaveBeenCalledTimes(5);
  });

  it('falls back to file tags, then the file name, for the title', async () => {
    const { prisma, audio, service } = setup();
    audio.probeUpload.mockResolvedValueOnce({
      ...PROBED,
      title: 'Tag Title',
      artist: 'Tag Artist',
    });
    await service.upload(FILE, {});
    expect(prisma.track.create.mock.calls[0][0].data).toMatchObject({
      title: 'Tag Title',
      artist: 'Tag Artist',
    });

    await service.upload(FILE, {});
    expect(prisma.track.create.mock.calls[1][0].data.title).toBe('My Song');
    await service.whenIdle();
  });

  it('rejects non-audio with 422 without creating a row, and deletes the temp file', async () => {
    const { prisma, audio, storage, service } = setup();
    audio.probeUpload.mockRejectedValue(
      new AudioProcessingError('INVALID_AUDIO'),
    );

    await expect(service.upload(FILE, {})).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(prisma.track.create).not.toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(audio.adoptUpload).not.toHaveBeenCalled();
    expect(audio.removeTempFiles).toHaveBeenCalledWith(FILE.path);
  });

  it('FFmpeg failure: the request already succeeded; the row is FAILED with a safe message, nothing uploaded', async () => {
    const { audio, storage, service, failedUpdate } = setup();
    audio.transcodeToMp3.mockRejectedValue(
      new AudioProcessingError('TRANSCODE_FAILED'),
    );

    await expect(service.upload(FILE, {})).resolves.toMatchObject({ id: ID });
    await service.whenIdle();
    expect(failedUpdate()).toMatchObject({
      where: { id: ID },
      data: {
        status: TrackStatus.FAILED,
        errorMessage: 'Audio conversion failed',
      },
    });
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expectTempCleanup(audio);
  });

  it('FFmpeg missing: row FAILED', async () => {
    const { audio, service, failedUpdate } = setup();
    audio.transcodeToMp3.mockRejectedValue(
      new AudioProcessingError('UNAVAILABLE'),
    );
    await service.upload(FILE, {});
    await service.whenIdle();
    expect(failedUpdate()).toBeDefined();
  });

  it('R2 failure: row FAILED, possibly-written object removed, no storage detail in the message', async () => {
    const { audio, storage, service, failedUpdate } = setup();
    storage.uploadFile.mockRejectedValue(
      new StorageError('upload', 'AccessDenied, HTTP 403'),
    );

    await service.upload(FILE, {});
    await service.whenIdle();
    expect(storage.deleteObject).toHaveBeenCalledWith(`tracks/${ID}.mp3`);
    expect(failedUpdate()?.data.errorMessage).toBe(
      'Could not store the processed audio',
    );
    expect(failedUpdate()?.data.errorMessage).not.toMatch(/AccessDenied|403/);
    expectTempCleanup(audio);
  });

  it('DB failure after upload: the uploaded object is deleted (no orphan) and the queue keeps working', async () => {
    const { prisma, audio, storage, service } = setup();
    prisma.track.update.mockRejectedValueOnce(new Error('connection lost'));

    await service.upload(FILE, {});
    await service.whenIdle();
    expect(storage.uploadFile).toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledWith(`tracks/${ID}.mp3`);
    expectTempCleanup(audio);

    await service.upload(FILE, {}); // a later upload still converts
    await service.whenIdle();
    expect(storage.uploadFile).toHaveBeenCalledTimes(2);
  });

  it('cannot take over the temp file: the row is marked FAILED and the request gets 500', async () => {
    const { audio, service, failedUpdate } = setup();
    audio.adoptUpload.mockRejectedValue(new Error('disk full'));
    await expect(service.upload(FILE, {})).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(failedUpdate()).toBeDefined();
  });
});

describe('TracksService other operations', () => {
  it('list paginates and reports totals', async () => {
    const { prisma, service } = setup();
    prisma.track.count.mockResolvedValue(45);
    const page = await service.list({ page: 3, pageSize: 20, search: 'rock' });

    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        where: {
          OR: [
            { title: { contains: 'rock', mode: 'insensitive' } },
            { artist: { contains: 'rock', mode: 'insensitive' } },
          ],
        },
      }),
    );
    expect(prisma.track.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'storageKey',
    );
    expect(page).toMatchObject({
      total: 45,
      page: 3,
      pageSize: 20,
      totalPages: 3,
    });
  });

  it('update requires a field and maps a missing row to 404', async () => {
    const { prisma, service } = setup();
    await expect(service.update(ID, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.track.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: 'x',
      }),
    );
    await expect(service.update(ID, { title: 'New' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('remove deletes the row first, then the R2 object, inside one transaction', async () => {
    const { prisma, storage, service } = setup();
    prisma.track.findUnique.mockResolvedValue({
      status: TrackStatus.READY,
      storageKey: `tracks/${ID}.mp3`,
    });
    const order: string[] = [];
    storage.deleteObject.mockImplementation(async () => void order.push('r2'));
    prisma.track.delete.mockImplementation(async () => void order.push('db'));

    await service.remove(ID);
    expect(order).toEqual(['db', 'r2']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith(`tracks/${ID}.mp3`);
  });

  it('remove: a track used by a playlist is 409 and its audio is never touched', async () => {
    const { prisma, storage, service } = setup();
    prisma.track.findUnique.mockResolvedValue({
      status: TrackStatus.READY,
      storageKey: `tracks/${ID}.mp3`,
    });
    prisma.playlistTrack.count.mockResolvedValue(2);

    await expect(service.remove(ID)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.track.delete).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('remove: the foreign-key backstop (race with a playlist add) is also 409 with the audio untouched', async () => {
    const { prisma, storage, service } = setup();
    prisma.track.findUnique.mockResolvedValue({
      status: TrackStatus.READY,
      storageKey: `tracks/${ID}.mp3`,
    });
    prisma.track.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK violation', {
        code: 'P2003',
        clientVersion: 'x',
      }),
    );

    await expect(service.remove(ID)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('remove: an R2 failure aborts the transaction with 502 (the row delete is rolled back)', async () => {
    const { prisma, storage, service } = setup();
    prisma.track.findUnique.mockResolvedValue({
      status: TrackStatus.READY,
      storageKey: `tracks/${ID}.mp3`,
    });
    storage.deleteObject.mockRejectedValue(
      new StorageError('delete', 'timeout'),
    );

    // The row delete ran inside the transaction callback that then threw, so Prisma rolls it
    // back; the e2e suite verifies the row survives using a store that emulates rollback.
    await expect(service.remove(ID)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(prisma.track.delete).toHaveBeenCalledTimes(1);
  });

  it('remove: 404 when missing, 409 while processing, no R2 call for FAILED rows', async () => {
    const { prisma, storage, service } = setup();
    prisma.track.findUnique.mockResolvedValueOnce(null);
    await expect(service.remove(ID)).rejects.toBeInstanceOf(NotFoundException);

    prisma.track.findUnique.mockResolvedValueOnce({
      status: TrackStatus.PROCESSING,
      storageKey: null,
    });
    await expect(service.remove(ID)).rejects.toBeInstanceOf(ConflictException);

    prisma.track.findUnique.mockResolvedValueOnce({
      status: TrackStatus.FAILED,
      storageKey: null,
    });
    await service.remove(ID);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(prisma.track.delete).toHaveBeenCalledWith({ where: { id: ID } });
  });

  it('startup marks interrupted PROCESSING tracks as FAILED', async () => {
    const { prisma, service } = setup();
    await service.onApplicationBootstrap();
    expect(prisma.track.updateMany).toHaveBeenCalledWith({
      where: { status: TrackStatus.PROCESSING },
      data: {
        status: TrackStatus.FAILED,
        errorMessage: 'Processing was interrupted',
      },
    });
  });

  it('titleFromFileName never returns an empty title', () => {
    expect(titleFromFileName('cool_track-01.wav')).toBe('cool track-01');
    expect(titleFromFileName('.mp3')).toBe('.mp3');
    expect(titleFromFileName('   .wav')).toBe('Untitled track');
  });
});

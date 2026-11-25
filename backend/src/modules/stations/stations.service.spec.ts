import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { seedStation } from '../../../prisma/seed-station.js';
import { createFakePrisma } from '../../../test/support/fake-track-store.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { StationsService } from './stations.service.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function setup(options: { seeded?: boolean } = {}) {
  const db = createFakePrisma();
  const service = new StationsService(db as unknown as PrismaService);
  if (options.seeded !== false) await seedStation(db as never);

  const makePlaylist = async (name: string, trackCount = 0) => {
    const playlist = (await db.playlist.create({ data: { name } })) as {
      id: string;
    };
    const track = (await db.track.create({
      data: { title: 't', status: 'READY' },
    })) as { id: string };
    for (let position = 0; position < trackCount; position++) {
      await db.playlistTrack.create({
        data: { playlistId: playlist.id, trackId: track.id, position },
      });
    }
    return { ...playlist, trackId: track.id };
  };
  return { db, service, makePlaylist };
}

describe('StationsService: reading', () => {
  it('404 until the station has been seeded', async () => {
    const { service } = await setup({ seeded: false });
    await expect(service.getMain()).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getNowPlaying()).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.update({ desiredStatus: 'ON_AIR' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the seeded station: OFF_AIR, no playlist', async () => {
    const { service } = await setup();
    expect(await service.getMain()).toMatchObject({
      slug: 'main',
      name: 'CDR Central Radio',
      desiredStatus: 'OFF_AIR',
      activePlaylist: null,
    });
  });

  it('shows the configured playlist with safe fields only', async () => {
    const { service, makePlaylist } = await setup();
    const playlist = await makePlaylist('Morning', 3);
    await service.update({ activePlaylistId: playlist.id });

    const station = await service.getMain();
    expect(station.activePlaylist).toEqual({
      id: playlist.id,
      name: 'Morning',
      trackCount: 3,
    });
    expect(Object.keys(station).sort()).toEqual([
      'activePlaylist',
      'desiredStatus',
      'name',
      'slug',
      'updatedAt',
    ]);
  });

  it('now-playing is NOT confirmed when nothing was ever reported', async () => {
    const { service } = await setup();
    expect(await service.getNowPlaying()).toEqual({
      status: 'UNKNOWN',
      confirmed: false,
      track: null,
      startedAt: null,
      startOffsetMs: 0,
      desiredStatus: 'OFF_AIR',
    });
  });

  it('now-playing is NOT confirmed for a partial playback row (track without a start time)', async () => {
    const { db, service, makePlaylist } = await setup();
    const { trackId } = await makePlaylist('P', 1);
    db.stationPlayback.rows[0].currentTrackId = trackId;
    expect((await service.getNowPlaying()).confirmed).toBe(false);
  });

  it('now-playing returns the confirmed track (safe fields) once a start was recorded', async () => {
    const { db, service, makePlaylist } = await setup();
    const { trackId } = await makePlaylist('P', 1);
    const startedAt = new Date('2026-11-24T10:00:00Z');
    Object.assign(db.stationPlayback.rows[0], {
      currentTrackId: trackId,
      startedAt,
      startOffsetMs: 1500,
    });

    const result = await service.getNowPlaying();
    expect(result).toMatchObject({
      confirmed: true,
      startedAt,
      startOffsetMs: 1500,
    });
    expect(Object.keys(result.track!).sort()).toEqual([
      'artist',
      'durationMs',
      'id',
      'title',
    ]);
  });
});

describe('StationsService: updating settings', () => {
  it('selects a playlist, switches to another, and clears it with null', async () => {
    const { service, makePlaylist } = await setup();
    const a = await makePlaylist('A', 1);
    const b = await makePlaylist('B', 2);

    expect(
      (await service.update({ activePlaylistId: a.id })).activePlaylist?.id,
    ).toBe(a.id);
    expect(
      (await service.update({ activePlaylistId: b.id })).activePlaylist,
    ).toMatchObject({ id: b.id, trackCount: 2 });
    expect(
      (await service.update({ activePlaylistId: null })).activePlaylist,
    ).toBeNull();
  });

  it('changes only what was sent', async () => {
    const { service, makePlaylist } = await setup();
    const playlist = await makePlaylist('A');
    await service.update({ activePlaylistId: playlist.id });

    const onAir = await service.update({ desiredStatus: 'ON_AIR' });
    expect(onAir).toMatchObject({
      desiredStatus: 'ON_AIR',
      activePlaylist: { id: playlist.id },
    });
    const offAir = await service.update({ desiredStatus: 'OFF_AIR' });
    expect(offAir.activePlaylist?.id).toBe(playlist.id);
  });

  it('404 for a playlist that does not exist, changing nothing', async () => {
    const { db, service, makePlaylist } = await setup();
    const keep = await makePlaylist('Keep');
    await service.update({ activePlaylistId: keep.id });

    await expect(
      service.update({ activePlaylistId: MISSING_ID, desiredStatus: 'ON_AIR' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.station.rows[0]).toMatchObject({
      activePlaylistId: keep.id,
      desiredStatus: 'OFF_AIR',
    });
  });

  it('404 (not 500) if the playlist is deleted between the check and the update', async () => {
    const { db, service } = await setup();
    // The existence check sees a playlist that is already gone by the time of the update.
    vi.spyOn(db.playlist, 'findUnique').mockResolvedValueOnce({
      id: MISSING_ID,
    } as never);
    await expect(
      service.update({ activePlaylistId: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 when nothing is sent', async () => {
    const { service } = await setup();
    await expect(service.update({})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('never touches the confirmed playback state', async () => {
    const { db, service, makePlaylist } = await setup();
    const playlist = await makePlaylist('A', 1);
    const before = structuredClone(db.stationPlayback.rows[0]);

    await service.update({
      activePlaylistId: playlist.id,
      desiredStatus: 'ON_AIR',
    });
    await service.update({ activePlaylistId: null, desiredStatus: 'OFF_AIR' });

    expect(db.stationPlayback.rows[0]).toEqual(before);
    expect((await service.getNowPlaying()).confirmed).toBe(false);
  });
});

describe('StationsService: truthful now-playing states', () => {
  it('FALLBACK when playout confirmed the safety source (no track claimed)', async () => {
    const { db, service } = await setup();
    const startedAt = new Date();
    Object.assign(db.stationPlayback.rows[0], {
      currentTrackId: null,
      startedAt,
      updatedAt: new Date(),
    });
    expect(await service.getNowPlaying()).toMatchObject({
      status: 'FALLBACK',
      confirmed: false,
      track: null,
      startedAt,
    });
  });

  it('UNKNOWN (not the last track) when playout has not reported for longer than 45 s', async () => {
    const { db, service, makePlaylist } = await setup();
    const { trackId } = await makePlaylist('P', 1);
    const reportedAt = new Date('2026-11-24T10:00:00Z');
    Object.assign(db.stationPlayback.rows[0], {
      currentTrackId: trackId,
      startedAt: reportedAt,
      updatedAt: reportedAt,
    });

    const fresh = await service.getNowPlaying(
      new Date(reportedAt.getTime() + 44_000),
    );
    expect(fresh).toMatchObject({ status: 'PLAYING', confirmed: true });

    const stale = await service.getNowPlaying(
      new Date(reportedAt.getTime() + 46_000),
    );
    expect(stale).toMatchObject({
      status: 'UNKNOWN',
      confirmed: false,
      track: null,
    });
  });
});

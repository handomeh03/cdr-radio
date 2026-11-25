import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { seedStation } from '../../../prisma/seed-station.js';
import { createFakePrisma } from '../../../test/support/fake-track-store.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { R2StorageService } from '../../storage/r2-storage.service.js';
import { StationsService } from '../stations/stations.service.js';
import type { LiquidsoapControlService } from '../streaming/liquidsoap-control.service.js';
import { PlaybackService } from './playback.service.js';

const now = () => Date.now() / 1000;

async function setup(options: { seeded?: boolean } = {}) {
  const db = createFakePrisma();
  if (options.seeded !== false) await seedStation(db as never);
  const storage = {
    getPresignedGetUrl: vi.fn(async (key: string) => ({
      url: `https://r2.example.test/${key}?X-Amz-Signature=abc`,
      expiresAt: new Date(Date.now() + 300_000),
    })),
  };
  const control = {
    skip: vi.fn(async () => ({
      ok: true,
      source: 'playlist' as 'playlist' | 'fallback',
      skipped: true,
    })),
    reload: vi.fn(async ({ skip }: { skip: boolean }) => ({
      ok: true,
      source: 'playlist' as const,
      flushed: 1,
      queued: true,
      skipped: skip,
    })),
  };
  const stations = new StationsService(db as unknown as PrismaService);
  const service = new PlaybackService(
    db as unknown as PrismaService,
    storage as unknown as R2StorageService,
    stations,
    control as unknown as LiquidsoapControlService,
  );

  const track = async (
    title: string,
    status = 'READY',
    storageKey: string | null = 'k',
  ) => {
    const row = (await db.track.create({
      data: { title, status, durationMs: 30_000, storageKey: null },
    })) as { id: string };
    if (storageKey) {
      await db.track.update({
        where: { id: row.id },
        data: { storageKey: `tracks/${row.id}.mp3` },
      });
    }
    return row.id;
  };
  /** A playlist whose items use the given track ids (repeats allowed), in order. */
  const playlist = async (name: string, trackIds: string[]) => {
    const p = (await db.playlist.create({ data: { name } })) as { id: string };
    const itemIds: string[] = [];
    for (const [position, trackId] of trackIds.entries()) {
      const item = (await db.playlistTrack.create({
        data: { playlistId: p.id, trackId, position },
      })) as { id: string };
      itemIds.push(item.id);
    }
    return { id: p.id, itemIds };
  };
  const onAir = (
    playlistId: string | null,
    status: 'ON_AIR' | 'OFF_AIR' = 'ON_AIR',
  ) =>
    db.station.update({
      where: { slug: 'main' },
      data: { activePlaylistId: playlistId, desiredStatus: status },
    });
  const titleOf = async (afterItemId?: string) =>
    (await service.next(afterItemId))?.title ?? null;
  /** Simulates Liquidsoap: queue, keep `after` up to date, return titles in play order. */
  const playOrder = async (count: number, start?: string) => {
    const titles: string[] = [];
    let after = start;
    for (let i = 0; i < count; i++) {
      const item = await service.next(after);
      if (!item) break;
      titles.push(item.title);
      after = item.itemId;
    }
    return titles;
  };
  return {
    db,
    service,
    storage,
    control,
    track,
    playlist,
    onAir,
    titleOf,
    playOrder,
  };
}

describe('PlaybackService.next: what plays', () => {
  it('nothing (fallback) before seeding, while OFF_AIR, without a playlist, or with nothing playable', async () => {
    expect(await (await setup({ seeded: false })).service.next()).toBeNull();

    const { service, track, playlist, onAir } = await setup();
    expect(await service.next()).toBeNull(); // seeded: OFF_AIR, no playlist

    const empty = await playlist('Empty', []);
    await onAir(empty.id);
    expect(await service.next()).toBeNull();

    const bad = await playlist('Bad', [
      await track('processing', 'PROCESSING', null),
      await track('failed', 'FAILED', null),
    ]);
    await onAir(bad.id);
    expect(await service.next()).toBeNull();

    const good = await playlist('Good', [await track('A')]);
    await onAir(good.id, 'OFF_AIR');
    expect(await service.next()).toBeNull();
  });

  it('plays READY tracks in playlist order and wraps around', async () => {
    const { track, playlist, onAir, playOrder } = await setup();
    const p = await playlist('P', [
      await track('A'),
      await track('B'),
      await track('C'),
    ]);
    await onAir(p.id);
    expect(await playOrder(7)).toEqual(['A', 'B', 'C', 'A', 'B', 'C', 'A']);
  });

  it('plays duplicate track entries as separate items', async () => {
    const { track, playlist, onAir, playOrder } = await setup();
    const x = await track('X');
    const p = await playlist('P', [x, await track('Y'), x]);
    await onAir(p.id);
    expect(await playOrder(6)).toEqual(['X', 'Y', 'X', 'X', 'Y', 'X']);
  });

  it('loops a single-track playlist', async () => {
    const { track, playlist, onAir, playOrder } = await setup();
    const p = await playlist('P', [await track('Solo')]);
    await onAir(p.id);
    expect(await playOrder(3)).toEqual(['Solo', 'Solo', 'Solo']);
  });

  it('skips items whose track is not READY (or has no audio), keeping the order', async () => {
    const { track, playlist, onAir, playOrder } = await setup();
    const p = await playlist('P', [
      await track('A'),
      await track('broken', 'FAILED', null),
      await track('C'),
    ]);
    await onAir(p.id);
    expect(await playOrder(4)).toEqual(['A', 'C', 'A', 'C']);
  });

  it('a retry (same `after`) returns the same item again: nothing is skipped', async () => {
    const { track, playlist, onAir, service } = await setup();
    const p = await playlist('P', [
      await track('A'),
      await track('B'),
      await track('C'),
    ]);
    await onAir(p.id);
    const first = await service.next(p.itemIds[0]);
    const retry = await service.next(p.itemIds[0]);
    expect([first?.title, retry?.title]).toEqual(['B', 'B']);
    expect(first?.occurrenceId).not.toBe(retry?.occurrenceId); // each issue is a new occurrence
  });

  it('issuing items never writes playback state', async () => {
    const { db, track, playlist, onAir, service } = await setup();
    const p = await playlist('P', [await track('A'), await track('B')]);
    await onAir(p.id);
    const before = structuredClone(db.stationPlayback.rows);
    await service.next();
    await service.next(p.itemIds[0]);
    expect(db.stationPlayback.rows).toEqual(before);
  });

  it('follows a reorder: continues after the hinted item at its new place', async () => {
    const { db, track, playlist, onAir, titleOf } = await setup();
    const p = await playlist('P', [
      await track('A'),
      await track('B'),
      await track('C'),
    ]);
    await onAir(p.id);
    // New order: C, A, B. After A comes B.
    const [a, b, c] = p.itemIds;
    for (const [position, id] of [c, a, b].entries()) {
      db.playlistTrack.rows.find((r) => r.id === id)!.position = position;
    }
    expect(await titleOf(a)).toBe('B');
    expect(await titleOf(b)).toBe('C');
  });

  it('a switched playlist starts at its first item (the old hint is ignored)', async () => {
    const { track, playlist, onAir, titleOf } = await setup();
    const one = await playlist('One', [await track('A1'), await track('A2')]);
    const two = await playlist('Two', [await track('B1'), await track('B2')]);
    await onAir(two.id);
    expect(await titleOf(one.itemIds[0])).toBe('B1');
  });

  it('hint removed from the playlist: continues after the last CONFIRMED item', async () => {
    const { db, track, playlist, onAir, titleOf } = await setup();
    const p = await playlist('P', [
      await track('A'),
      await track('B'),
      await track('C'),
    ]);
    await onAir(p.id);
    // A is confirmed on air; B was prefetched, then removed from the playlist (C moves up).
    db.stationPlayback.rows[0].currentPlaylistTrackId = p.itemIds[0];
    db.playlistTrack.rows.splice(1, 1);
    db.playlistTrack.rows.find((r) => r.id === p.itemIds[2])!.position = 1;
    expect(await titleOf(p.itemIds[1])).toBe('C');
  });

  it('no hint (Liquidsoap restarted): resumes after the last confirmed item, else from the top', async () => {
    const { db, track, playlist, onAir, titleOf } = await setup();
    const p = await playlist('P', [
      await track('A'),
      await track('B'),
      await track('C'),
    ]);
    await onAir(p.id);
    expect(await titleOf()).toBe('A');
    db.stationPlayback.rows[0].currentPlaylistTrackId = p.itemIds[1];
    expect(await titleOf()).toBe('C');
  });

  it('returns safe data for Liquidsoap and presigns the private object', async () => {
    const { track, playlist, onAir, service, storage } = await setup();
    const id = await track('A');
    const p = await playlist('P', [id]);
    await onAir(p.id);
    const item = await service.next();
    expect(item).toMatchObject({
      playlistId: p.id,
      itemId: p.itemIds[0],
      position: 0,
      trackId: id,
      title: 'A',
      artist: '',
      durationMs: 30_000,
    });
    expect(storage.getPresignedGetUrl).toHaveBeenCalledWith(`tracks/${id}.mp3`);
    expect(item?.occurrenceId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('PlaybackService.recordEvent: confirmed playback', () => {
  async function started() {
    const ctx = await setup();
    const a = await ctx.track('A');
    const b = await ctx.track('B');
    const p = await ctx.playlist('P', [a, b]);
    await ctx.onAir(p.id);
    const event = (
      itemIndex: number,
      startedAt: number,
      type = 'track_started',
    ) => ({
      type: type as 'track_started' | 'heartbeat',
      source: 'playlist' as const,
      occurrenceId: crypto.randomUUID(),
      itemId: p.itemIds[itemIndex],
      trackId: [a, b][itemIndex],
      startedAt,
    });
    return {
      ...ctx,
      p,
      a,
      b,
      event,
      row: () => ctx.db.stationPlayback.rows[0],
    };
  }

  it('records the confirmed track, item and start time', async () => {
    const { service, event, row, a, p } = await started();
    const t = now() - 2;
    expect(await service.recordEvent(event(0, t))).toEqual({ applied: true });
    expect(row()).toMatchObject({
      currentTrackId: a,
      currentPlaylistTrackId: p.itemIds[0],
      startOffsetMs: 0,
    });
    expect(row().startedAt?.getTime()).toBe(Math.round(t * 1000));
  });

  it('is idempotent: a repeated delivery or heartbeat of the same start changes nothing', async () => {
    const { service, event, row } = await started();
    const t = now() - 2;
    const e = event(0, t);
    await service.recordEvent(e);
    const snapshot = { ...row() };
    expect(await service.recordEvent(e)).toEqual({
      applied: true,
      reason: 'duplicate',
    });
    expect(await service.recordEvent({ ...e, type: 'heartbeat' })).toEqual({
      applied: true,
      reason: 'duplicate',
    });
    expect({ ...row(), updatedAt: snapshot.updatedAt }).toEqual(snapshot);
  });

  it('ignores stale (out-of-order) events', async () => {
    const { service, event, row, b } = await started();
    const t = now() - 10;
    await service.recordEvent(event(1, t + 5)); // B started later
    expect(await service.recordEvent(event(0, t))).toEqual({
      applied: false,
      reason: 'stale',
    });
    expect(row().currentTrackId).toBe(b);
  });

  it('a heartbeat repairs a lost track_started event', async () => {
    const { service, event, row, b } = await started();
    const t = now() - 20;
    await service.recordEvent(event(0, t));
    // B's track_started never arrived; the next heartbeat reports B.
    expect(await service.recordEvent(event(1, t + 10, 'heartbeat'))).toEqual({
      applied: true,
    });
    expect(row().currentTrackId).toBe(b);
  });

  it('fallback clears the track but keeps the playlist cursor, then the playlist resumes after it', async () => {
    const { service, event, row, p, titleOf } = await started();
    const t = now() - 20;
    await service.recordEvent(event(0, t));
    await service.recordEvent({
      type: 'track_started',
      source: 'fallback',
      startedAt: t + 5,
    });
    expect(row()).toMatchObject({
      currentTrackId: null,
      currentPlaylistTrackId: p.itemIds[0],
    });
    expect(await titleOf()).toBe('B');
  });

  it('rejects events from the future and ignores unknown tracks', async () => {
    const { service, event } = await started();
    await expect(
      service.recordEvent(event(0, now() + 3600)),
    ).rejects.toBeInstanceOf(BadRequestException);
    const unknown = {
      ...event(0, now() - 1),
      trackId: '00000000-0000-4000-8000-000000000000',
    };
    expect(await service.recordEvent(unknown)).toEqual({
      applied: false,
      reason: 'unknown_track',
    });
  });

  it('logs request failures without changing playback', async () => {
    const { service, event, db } = await started();
    const before = structuredClone(db.stationPlayback.rows);
    expect(
      await service.recordEvent({
        ...event(0, now()),
        type: 'request_failed' as never,
        detail: 'resolve failed',
      }),
    ).toEqual({ applied: false, reason: 'logged' });
    expect(db.stationPlayback.rows).toEqual(before);
  });

  it('404 when the station has not been set up', async () => {
    const { service } = await setup({ seeded: false });
    await expect(
      service.recordEvent({
        type: 'heartbeat',
        source: 'fallback',
        startedAt: now(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlaybackService: admin controls', () => {
  it('skip succeeds only when Liquidsoap confirms it skipped a playlist track', async () => {
    const { service, control } = await setup();
    expect(await service.skip()).toEqual({ skipped: true });

    control.skip.mockResolvedValueOnce({
      ok: true,
      source: 'fallback',
      skipped: false,
    });
    await expect(service.skip()).rejects.toBeInstanceOf(ConflictException);

    control.skip.mockRejectedValueOnce(new ServiceUnavailableException('down'));
    await expect(service.skip()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('apply saves the settings, then reloads (next boundary) or reloads + skips (immediate)', async () => {
    const { service, control, track, playlist, db } = await setup();
    const p = await playlist('P', [await track('A')]);

    const result = await service.apply({
      activePlaylistId: p.id,
      desiredStatus: 'ON_AIR',
    });
    expect(result).toMatchObject({
      effective: 'next_track',
      station: { desiredStatus: 'ON_AIR', activePlaylist: { id: p.id } },
    });
    expect(control.reload).toHaveBeenLastCalledWith({ skip: false });
    expect(db.station.rows[0].activePlaylistId).toBe(p.id);

    expect((await service.apply({ immediate: true })).effective).toBe('now');
    expect(control.reload).toHaveBeenLastCalledWith({ skip: true });
  });

  it('apply reports truthfully when the settings were saved but playout was unreachable', async () => {
    const { service, control, db } = await setup();
    control.reload.mockRejectedValueOnce(
      new ServiceUnavailableException('unreachable'),
    );

    const error = await service
      .apply({ desiredStatus: 'ON_AIR' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toMatchObject({
      settingsSaved: true,
    });
    expect(db.station.rows[0].desiredStatus).toBe('ON_AIR');
  });

  it('apply validates the playlist before touching playout', async () => {
    const { service, control } = await setup();
    await expect(
      service.apply({
        activePlaylistId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(control.reload).not.toHaveBeenCalled();
  });

  it('serializes concurrent control operations', async () => {
    const { service, control } = await setup();
    const order: string[] = [];
    control.reload.mockImplementationOnce(async () => {
      order.push('reload:start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('reload:end');
      return {
        ok: true,
        source: 'playlist',
        flushed: 0,
        queued: true,
        skipped: false,
      };
    });
    control.skip.mockImplementationOnce(async () => {
      order.push('skip');
      return { ok: true, source: 'playlist', skipped: true };
    });
    await Promise.all([service.apply({}), service.skip()]);
    expect(order).toEqual(['reload:start', 'reload:end', 'skip']);
  });
});

describe('inNormalizedForm', () => {
  it('turns %2F into "/" so Liquidsoap does not log the signed URL', async () => {
    const { inNormalizedForm } = await import('./playback.service.js');
    const url =
      'https://b.a.r2.cloudflarestorage.com/tracks/x.mp3?X-Amz-Credential=KEY%2F20261124%2Fauto%2Fs3%2Faws4_request&X-Amz-Signature=abc';
    expect(inNormalizedForm(url)).toBe(
      'https://b.a.r2.cloudflarestorage.com/tracks/x.mp3?X-Amz-Credential=KEY/20261124/auto/s3/aws4_request&X-Amz-Signature=abc',
    );
  });
});

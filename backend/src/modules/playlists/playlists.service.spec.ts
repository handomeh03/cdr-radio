import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createFakePrisma } from '../../../test/support/fake-track-store.js';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  MAX_PLAYLIST_ITEMS,
  POSITION_PARKING_OFFSET,
} from './playlists.constants.js';
import { PlaylistsService } from './playlists.service.js';

const USER_ID = randomUUID();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function setup() {
  const db = createFakePrisma();
  const service = new PlaylistsService(db as unknown as PrismaService);

  const makeTrack = async (
    title: string,
    status: 'READY' | 'PROCESSING' | 'FAILED' = 'READY',
  ) =>
    (await db.track.create({
      data: {
        title,
        status,
        artist: 'Someone',
        durationMs: 60_000,
        storageKey: `tracks/${randomUUID()}.mp3`,
      },
    })) as { id: string };
  const makePlaylist = (name = 'Morning') => service.create({ name }, USER_ID);

  /** Playlist with one item per title (each title gets its own track). */
  const playlistWith = async (...titles: string[]) => {
    const playlist = await makePlaylist();
    const itemIds: string[] = [];
    for (const title of titles) {
      const track = await makeTrack(title);
      const item = await service.addTrack(playlist.id, { trackId: track.id });
      itemIds.push(item.id);
    }
    return { playlist, itemIds };
  };
  const order = async (playlistId: string) =>
    (await service.findOne(playlistId)).items.map((i) => i.track.title);
  const positions = async (playlistId: string) =>
    (await service.findOne(playlistId)).items.map((i) => i.position);

  return {
    db,
    service,
    makeTrack,
    makePlaylist,
    playlistWith,
    order,
    positions,
  };
}

describe('PlaylistsService: playlists', () => {
  it('creates a playlist with the creator recorded and no tracks', async () => {
    const { service, db } = await setup();
    const created = await service.create(
      { name: 'Lunch', description: 'Light jazz' },
      USER_ID,
    );
    expect(created).toMatchObject({
      name: 'Lunch',
      description: 'Light jazz',
      trackCount: 0,
    });
    expect(db.playlist.rows[0].createdById).toBe(USER_ID);
    expect(created).not.toHaveProperty('createdById');
  });

  it('lists with pagination, name search and track counts', async () => {
    const { service, makePlaylist, makeTrack } = await setup();
    for (const name of [
      'Breakfast',
      'Lunch',
      'Dinner',
      'Late lunch',
      'Brunch',
    ]) {
      await makePlaylist(name);
    }
    const lunch = (
      await service.list({ page: 1, pageSize: 20, search: 'LUNCH' })
    ).items;
    expect(lunch.map((p) => p.name).sort()).toEqual(['Late lunch', 'Lunch']);

    const track = await makeTrack('t');
    await service.addTrack(lunch[0].id, { trackId: track.id });
    await service.addTrack(lunch[0].id, { trackId: track.id });

    const page = await service.list({ page: 2, pageSize: 2 });
    expect(page).toMatchObject({
      total: 5,
      page: 2,
      pageSize: 2,
      totalPages: 3,
    });
    expect(page.items).toHaveLength(2);

    const all = await service.list({ page: 1, pageSize: 100 });
    expect(all.items.find((p) => p.id === lunch[0].id)?.trackCount).toBe(2);
  });

  it('returns details with ordered items, safe track metadata and total duration', async () => {
    const { service, playlistWith } = await setup();
    const { playlist } = await playlistWith('A', 'B');
    const detail = await service.findOne(playlist.id);

    expect(detail).toMatchObject({ trackCount: 2, totalDurationMs: 120_000 });
    expect(detail.items.map((i) => i.position)).toEqual([0, 1]);
    expect(Object.keys(detail.items[0].track).sort()).toEqual([
      'artist',
      'durationMs',
      'id',
      'title',
    ]);
    await expect(service.findOne(MISSING_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates name/description, can clear the description, and validates', async () => {
    const { service, makePlaylist } = await setup();
    const p = await service.create({ name: 'Old', description: 'x' }, USER_ID);

    expect(await service.update(p.id, { name: 'New' })).toMatchObject({
      name: 'New',
      description: 'x',
    });
    expect(await service.update(p.id, { description: null })).toMatchObject({
      name: 'New',
      description: null,
    });
    await expect(service.update(p.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.update(MISSING_ID, { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await makePlaylist();
  });

  it('deletes the playlist and its items but never the tracks', async () => {
    const { service, db, playlistWith } = await setup();
    const { playlist } = await playlistWith('A', 'B');
    expect(db.playlistTrack.rows).toHaveLength(2);

    await service.remove(playlist.id);

    expect(db.playlist.rows).toHaveLength(0);
    expect(db.playlistTrack.rows).toHaveLength(0);
    expect(db.track.rows).toHaveLength(2);
    await expect(service.remove(playlist.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PlaylistsService: adding tracks', () => {
  it('appends at zero-based, contiguous positions', async () => {
    const { playlistWith, positions, order } = await setup();
    const { playlist } = await playlistWith('A', 'B', 'C');
    expect(await positions(playlist.id)).toEqual([0, 1, 2]);
    expect(await order(playlist.id)).toEqual(['A', 'B', 'C']);
  });

  it('allows the same track more than once as separate items', async () => {
    const { service, makePlaylist, makeTrack, order } = await setup();
    const playlist = await makePlaylist();
    const track = await makeTrack('Jingle');
    const first = await service.addTrack(playlist.id, { trackId: track.id });
    const second = await service.addTrack(playlist.id, { trackId: track.id });

    expect(first.id).not.toBe(second.id);
    expect([first.position, second.position]).toEqual([0, 1]);
    expect(await order(playlist.id)).toEqual(['Jingle', 'Jingle']);
  });

  it('rejects a missing track (404) and non-READY tracks (409) without adding anything', async () => {
    const { service, db, makePlaylist, makeTrack } = await setup();
    const playlist = await makePlaylist();
    const processing = await makeTrack('p', 'PROCESSING');
    const failed = await makeTrack('f', 'FAILED');

    await expect(
      service.addTrack(playlist.id, { trackId: MISSING_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    for (const track of [processing, failed]) {
      await expect(
        service.addTrack(playlist.id, { trackId: track.id }),
      ).rejects.toBeInstanceOf(ConflictException);
    }
    expect(db.playlistTrack.rows).toHaveLength(0);
  });

  it('404 for an unknown playlist', async () => {
    const { service, makeTrack } = await setup();
    const track = await makeTrack('t');
    await expect(
      service.addTrack(MISSING_ID, { trackId: track.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it(`refuses to grow past ${MAX_PLAYLIST_ITEMS} items (409)`, async () => {
    const { service, db, makePlaylist, makeTrack } = await setup();
    const playlist = await makePlaylist();
    const track = await makeTrack('t');
    for (let position = 0; position < MAX_PLAYLIST_ITEMS; position++) {
      db.playlistTrack.rows.push({
        id: randomUUID(),
        playlistId: playlist.id,
        trackId: track.id,
        position,
        createdAt: new Date(),
      });
    }
    await expect(
      service.addTrack(playlist.id, { trackId: track.id }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('locks the playlist row (inside a transaction) before reading or writing items', async () => {
    const { service, db, makePlaylist, makeTrack } = await setup();
    const playlist = await makePlaylist();
    const track = await makeTrack('t');
    const lock = vi.spyOn(db.playlist, 'update');
    const read = vi.spyOn(db.playlistTrack, 'aggregate');
    const write = vi.spyOn(db.playlistTrack, 'create');
    const transaction = vi.spyOn(db, '$transaction');

    await service.addTrack(playlist.id, { trackId: track.id });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: playlist.id } }),
    );
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      read.mock.invocationCallOrder[0],
    );
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0],
    );
  });
});

describe('PlaylistsService: removing items', () => {
  it('removes a middle item and compacts the positions', async () => {
    const { service, playlistWith, order, positions } = await setup();
    const { playlist, itemIds } = await playlistWith('A', 'B', 'C', 'D');

    await service.removeItem(playlist.id, itemIds[1]);

    expect(await order(playlist.id)).toEqual(['A', 'C', 'D']);
    expect(await positions(playlist.id)).toEqual([0, 1, 2]);
  });

  it('removes the first and last items', async () => {
    const { service, playlistWith, order, positions } = await setup();
    const { playlist, itemIds } = await playlistWith('A', 'B', 'C');

    await service.removeItem(playlist.id, itemIds[0]);
    await service.removeItem(playlist.id, itemIds[2]);

    expect(await order(playlist.id)).toEqual(['B']);
    expect(await positions(playlist.id)).toEqual([0]);
  });

  it('removing the last item leaves an empty, valid playlist; appending then starts at 0', async () => {
    const { service, playlistWith, makeTrack, positions } = await setup();
    const { playlist, itemIds } = await playlistWith('A');
    await service.removeItem(playlist.id, itemIds[0]);
    expect(await positions(playlist.id)).toEqual([]);

    const track = await makeTrack('B');
    const item = await service.addTrack(playlist.id, { trackId: track.id });
    expect(item.position).toBe(0);
  });

  it('404 for an unknown item or an item of another playlist (which stays intact)', async () => {
    const { service, playlistWith, order } = await setup();
    const one = await playlistWith('A');
    const two = await playlistWith('B');

    await expect(
      service.removeItem(one.playlist.id, MISSING_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.removeItem(one.playlist.id, two.itemIds[0]),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.removeItem(MISSING_ID, one.itemIds[0]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await order(two.playlist.id)).toEqual(['B']);
  });

  it('uses temporary disjoint positions, so the unique index is never hit', async () => {
    const { service, db, playlistWith } = await setup();
    const { playlist, itemIds } = await playlistWith('A', 'B', 'C', 'D');
    const park = vi.spyOn(db.playlistTrack, 'updateMany');

    await service.removeItem(playlist.id, itemIds[0]);

    expect(park).toHaveBeenCalledWith({
      where: { id: { in: itemIds.slice(1) } },
      data: { position: { increment: POSITION_PARKING_OFFSET } },
    });
  });
});

describe('PlaylistsService: reordering', () => {
  it('applies a full new order and returns the playlist in that order', async () => {
    const { service, playlistWith, positions } = await setup();
    const { playlist, itemIds } = await playlistWith('A', 'B', 'C', 'D');
    const [a, b, c, d] = itemIds;

    const result = await service.reorder(playlist.id, [d, b, a, c]);

    expect(result.items.map((i) => i.track.title)).toEqual([
      'D',
      'B',
      'A',
      'C',
    ]);
    expect(await positions(playlist.id)).toEqual([0, 1, 2, 3]);
  });

  it('reorders duplicate-track items independently', async () => {
    const { service, makePlaylist, makeTrack, order } = await setup();
    const playlist = await makePlaylist();
    const x = await makeTrack('X');
    const y = await makeTrack('Y');
    const i1 = await service.addTrack(playlist.id, { trackId: x.id });
    const i2 = await service.addTrack(playlist.id, { trackId: y.id });
    const i3 = await service.addTrack(playlist.id, { trackId: x.id });

    await service.reorder(playlist.id, [i3.id, i1.id, i2.id]);

    expect(await order(playlist.id)).toEqual(['X', 'X', 'Y']);
    const detail = await service.findOne(playlist.id);
    expect(detail.items.map((i) => i.id)).toEqual([i3.id, i1.id, i2.id]);
  });

  it('is a no-op (no writes) when the order is unchanged, and accepts [] for an empty playlist', async () => {
    const { service, db, makePlaylist, playlistWith } = await setup();
    const { playlist, itemIds } = await playlistWith('A', 'B');
    const park = vi.spyOn(db.playlistTrack, 'updateMany');
    const write = vi.spyOn(db.playlistTrack, 'update');

    await service.reorder(playlist.id, itemIds);
    expect(park).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    const empty = await makePlaylist('Empty');
    await expect(service.reorder(empty.id, [])).resolves.toMatchObject({
      items: [],
    });
  });

  it('moving only the tail leaves the earlier items untouched', async () => {
    const { service, db, playlistWith } = await setup();
    const { playlist, itemIds } = await playlistWith('A', 'B', 'C', 'D');
    const write = vi.spyOn(db.playlistTrack, 'update');

    await service.reorder(playlist.id, [
      itemIds[0],
      itemIds[1],
      itemIds[3],
      itemIds[2],
    ]);

    const touched = write.mock.calls.map(([arg]) => arg.where.id);
    expect(touched).toEqual([itemIds[3], itemIds[2]]);
  });

  it('rejects duplicate ids with 400 and foreign/missing/extra ids with 409, changing nothing', async () => {
    const { service, playlistWith, order } = await setup();
    const { playlist, itemIds } = await playlistWith('A', 'B', 'C');
    const other = await playlistWith('Z');
    const [a, b, c] = itemIds;

    await expect(
      service.reorder(playlist.id, [a, a, b]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reorder(playlist.id, [a, b, a, c]),
    ).rejects.toBeInstanceOf(BadRequestException);
    // foreign id (an item of another playlist) in place of one of ours
    await expect(
      service.reorder(playlist.id, [a, b, other.itemIds[0]]),
    ).rejects.toBeInstanceOf(ConflictException);
    // unknown id
    await expect(
      service.reorder(playlist.id, [a, b, MISSING_ID]),
    ).rejects.toBeInstanceOf(ConflictException);
    // missing one item
    await expect(service.reorder(playlist.id, [a, b])).rejects.toBeInstanceOf(
      ConflictException,
    );
    // a track id is not an item id
    await expect(
      service.reorder(playlist.id, [
        a,
        b,
        (await service.findOne(playlist.id)).items[2].track.id,
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.reorder(MISSING_ID, [])).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(await order(playlist.id)).toEqual(['A', 'B', 'C']);
    expect(await order(other.playlist.id)).toEqual(['Z']);
  });

  it('rolls everything back if a write fails part-way', async () => {
    const { service, db, playlistWith, order, positions } = await setup();
    const { playlist, itemIds } = await playlistWith('A', 'B', 'C');
    // The 2nd final-position write fails, after the rows were already parked and one rewritten.
    const realUpdate = db.playlistTrack.update.bind(db.playlistTrack);
    let writes = 0;
    const write = vi
      .spyOn(db.playlistTrack, 'update')
      .mockImplementation(async (args) => {
        if (++writes === 2) throw new Error('connection lost');
        return realUpdate(args);
      });

    await expect(
      service.reorder(playlist.id, [itemIds[2], itemIds[1], itemIds[0]]),
    ).rejects.toThrow('connection lost');

    write.mockRestore();
    expect(await order(playlist.id)).toEqual(['A', 'B', 'C']);
    expect(await positions(playlist.id)).toEqual([0, 1, 2]);
  });
});

describe('PlaylistsService: playlists selected by a station', () => {
  const selectFor = async (
    db: Awaited<ReturnType<typeof setup>>['db'],
    playlistId: string,
  ) => {
    await db.station.create({
      data: { slug: 'main', name: 'Main', activePlaylistId: playlistId },
    });
  };

  it('refuses to delete the active playlist (409) and keeps it and its items', async () => {
    const { service, db, playlistWith } = await setup();
    const { playlist } = await playlistWith('A', 'B');
    await selectFor(db, playlist.id);

    const error = await service.remove(playlist.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toMatch(
      /selected by a station/,
    );
    expect(db.playlist.rows).toHaveLength(1);
    expect(db.playlistTrack.rows).toHaveLength(2);
  });

  it('can delete it again after the station switches away or clears it', async () => {
    const { service, db, playlistWith, makePlaylist } = await setup();
    const { playlist } = await playlistWith('A');
    await selectFor(db, playlist.id);
    await expect(service.remove(playlist.id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const other = await makePlaylist('Other');
    await db.station.update({
      where: { slug: 'main' },
      data: { activePlaylistId: other.id },
    });
    await service.remove(playlist.id);
    expect(db.playlist.rows.map((p) => p.id)).toEqual([other.id]);

    await expect(service.remove(other.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await db.station.update({
      where: { slug: 'main' },
      data: { activePlaylistId: null },
    });
    await service.remove(other.id);
    expect(db.playlist.rows).toHaveLength(0);
  });

  it('the foreign-key backstop (a station selects it after the check) is also 409', async () => {
    const { service, db, makePlaylist } = await setup();
    const playlist = await makePlaylist('Raced');
    // The explicit check sees no station; the station then selects it before the delete runs.
    vi.spyOn(db.station, 'count').mockImplementationOnce(async () => {
      await selectFor(db, playlist.id);
      return 0;
    });

    await expect(service.remove(playlist.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.playlist.rows).toHaveLength(1);
  });

  it('other playlists stay deletable, and an unknown playlist is still 404', async () => {
    const { service, db, playlistWith, makePlaylist } = await setup();
    const { playlist } = await playlistWith('A');
    await selectFor(db, playlist.id);
    const spare = await makePlaylist('Spare');

    await service.remove(spare.id);
    await expect(service.remove(MISSING_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('editing the active playlist (items, name) is still allowed', async () => {
    const { service, db, playlistWith, makeTrack, order } = await setup();
    const { playlist } = await playlistWith('A');
    await selectFor(db, playlist.id);

    const track = await makeTrack('B');
    await service.addTrack(playlist.id, { trackId: track.id });
    await service.update(playlist.id, { name: 'Renamed' });

    expect(await order(playlist.id)).toEqual(['A', 'B']);
  });
});

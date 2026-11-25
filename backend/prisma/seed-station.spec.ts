import { createFakePrisma } from '../test/support/fake-track-store.js';
import { seedStation } from './seed-station.js';

describe('seedStation', () => {
  it('creates the main station (OFF_AIR, no playlist) and an empty playback row', async () => {
    const db = createFakePrisma();

    expect(await seedStation(db as never)).toBe('created');

    expect(db.station.rows).toHaveLength(1);
    expect(db.station.rows[0]).toMatchObject({
      slug: 'main',
      name: 'CDR Central Radio',
      desiredStatus: 'OFF_AIR',
      activePlaylistId: null,
    });
    expect(db.stationPlayback.rows).toHaveLength(1);
    expect(db.stationPlayback.rows[0]).toMatchObject({
      stationId: db.station.rows[0].id,
      currentTrackId: null,
      currentPlaylistTrackId: null,
      startedAt: null,
      startOffsetMs: 0,
    });
  });

  it('is idempotent and never overwrites settings an admin has changed', async () => {
    const db = createFakePrisma();
    await seedStation(db as never);

    const playlist = (await db.playlist.create({ data: { name: 'Live' } })) as {
      id: string;
    };
    await db.station.update({
      where: { slug: 'main' },
      data: {
        name: 'Renamed',
        activePlaylistId: playlist.id,
        desiredStatus: 'ON_AIR',
      },
    });
    const stationBefore = structuredClone(db.station.rows[0]);
    const playbackBefore = structuredClone(db.stationPlayback.rows[0]);

    expect(await seedStation(db as never)).toBe('existing');
    expect(await seedStation(db as never)).toBe('existing');

    expect(db.station.rows).toEqual([stationBefore]);
    expect(db.stationPlayback.rows).toEqual([playbackBefore]);
  });

  it('adds only the missing playback row when the station already exists', async () => {
    const db = createFakePrisma();
    await db.station.create({ data: { slug: 'main', name: 'Custom' } });

    expect(await seedStation(db as never)).toBe('existing');

    expect(db.station.rows[0].name).toBe('Custom');
    expect(db.stationPlayback.rows).toHaveLength(1);
  });
});

/**
 * Stations over HTTP: real AppModule, guards, validation and the real Stations/Playlists services;
 * in-memory tables (with foreign-key emulation) and R2. No PostgreSQL or Cloudflare.
 */
import './support/e2e-env.js'; // must stay first: sets env before AppModule loads
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { seedStation } from '../prisma/seed-station.js';
import type { User } from '../src/generated/prisma/client.js';
import {
  ADMIN,
  OPERATOR,
  createTestApp,
  makeUsers,
  sessionFor,
} from './support/e2e-app.js';
import {
  createFakePrisma,
  createFakeStorage,
} from './support/fake-track-store.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('Stations (e2e, in-memory DB/R2)', () => {
  let app: NestExpressApplication;
  let users: User[];
  let db: ReturnType<typeof createFakePrisma>;
  let admin: string;
  let operator: string;

  const server = () => app.getHttpServer();
  const patch = (body: object, cookie = admin) =>
    request(server()).patch('/stations/main').set('Cookie', cookie).send(body);
  const newPlaylist = async (name: string) =>
    (
      await request(server())
        .post('/playlists')
        .set('Cookie', admin)
        .send({ name })
        .expect(201)
    ).body as { id: string };

  async function boot(options: { seeded: boolean }) {
    users = await makeUsers();
    db = createFakePrisma();
    if (options.seeded) await seedStation(db as never);
    app = await createTestApp({
      users,
      prisma: db,
      storage: createFakeStorage(),
    });
    admin = await sessionFor(app, users, ADMIN.email);
    operator = await sessionFor(app, users, OPERATOR.email);
  }

  afterEach(async () => {
    await app.close();
  });

  describe('before the station is seeded', () => {
    beforeEach(() => boot({ seeded: false }));

    it('404 with a clear message instead of a 500', async () => {
      const res = await request(server()).get('/stations/main').expect(404);
      expect(res.body.message).toMatch(/not been set up/);
      await request(server()).get('/stations/main/now-playing').expect(404);
      await patch({ desiredStatus: 'ON_AIR' }).expect(404);
    });
  });

  describe('seeded station', () => {
    beforeEach(() => boot({ seeded: true }));

    describe('public reads', () => {
      it('GET /stations/main works without a session and exposes safe fields only', async () => {
        const res = await request(server()).get('/stations/main').expect(200);

        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toMatchObject({
          slug: 'main',
          name: 'CDR Central Radio',
          desiredStatus: 'OFF_AIR',
          activePlaylist: null,
        });
        expect(Object.keys(res.body).sort()).toEqual([
          'activePlaylist',
          'desiredStatus',
          'name',
          'slug',
          'updatedAt',
        ]);
      });

      it('GET /stations/main/now-playing is "not confirmed" when no track start was reported', async () => {
        const res = await request(server())
          .get('/stations/main/now-playing')
          .expect(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toEqual({
          status: 'UNKNOWN',
          confirmed: false,
          track: null,
          startedAt: null,
          startOffsetMs: 0,
          desiredStatus: 'OFF_AIR',
        });
      });

      it('now-playing reports a track only after a start was recorded, with safe fields', async () => {
        const track = (await db.track.create({
          data: {
            title: 'On air',
            artist: 'Someone',
            status: 'READY',
            durationMs: 180_000,
            storageKey: 'tracks/secret-key.mp3',
          },
        })) as { id: string };
        Object.assign(db.stationPlayback.rows[0], {
          currentTrackId: track.id,
          startedAt: new Date('2026-11-24T10:00:00Z'),
          startOffsetMs: 0,
        });

        const res = await request(server())
          .get('/stations/main/now-playing')
          .expect(200);
        expect(res.body).toEqual({
          status: 'PLAYING',
          desiredStatus: 'OFF_AIR',
          confirmed: true,
          track: {
            id: track.id,
            title: 'On air',
            artist: 'Someone',
            durationMs: 180_000,
          },
          startedAt: '2026-11-24T10:00:00.000Z',
          startOffsetMs: 0,
        });
        expect(JSON.stringify(res.body)).not.toMatch(/storage|secret-key/);
      });
    });

    describe('PATCH /stations/main', () => {
      it('401 without a session, 403 for OPERATOR; nothing changes', async () => {
        await request(server())
          .patch('/stations/main')
          .send({ desiredStatus: 'ON_AIR' })
          .expect(401);
        await patch({ desiredStatus: 'ON_AIR' }, operator).expect(403);
        expect(db.station.rows[0].desiredStatus).toBe('OFF_AIR');
      });

      it('ADMIN selects a playlist and sets ON_AIR; the public read reflects it', async () => {
        const playlist = await newPlaylist('Morning');

        const res = await patch({
          activePlaylistId: playlist.id,
          desiredStatus: 'ON_AIR',
        }).expect(200);
        expect(res.body).toMatchObject({
          desiredStatus: 'ON_AIR',
          activePlaylist: { id: playlist.id, name: 'Morning', trackCount: 0 },
        });

        const pub = await request(server()).get('/stations/main').expect(200);
        expect(pub.body).toMatchObject({
          desiredStatus: 'ON_AIR',
          activePlaylist: { id: playlist.id },
        });
      });

      it('changing settings does NOT make now-playing claim anything is playing', async () => {
        const playlist = await newPlaylist('Morning');
        await patch({
          activePlaylistId: playlist.id,
          desiredStatus: 'ON_AIR',
        }).expect(200);

        const res = await request(server())
          .get('/stations/main/now-playing')
          .expect(200);
        expect(res.body).toMatchObject({ confirmed: false, track: null });
      });

      it('switches playlists and clears the selection with null', async () => {
        const a = await newPlaylist('A');
        const b = await newPlaylist('B');
        await patch({ activePlaylistId: a.id }).expect(200);

        const switched = await patch({ activePlaylistId: b.id }).expect(200);
        expect(switched.body.activePlaylist.id).toBe(b.id);

        const cleared = await patch({ activePlaylistId: null }).expect(200);
        expect(cleared.body.activePlaylist).toBeNull();
        expect(db.station.rows[0].activePlaylistId).toBeNull();
      });

      it('only the sent field changes', async () => {
        const playlist = await newPlaylist('A');
        await patch({ activePlaylistId: playlist.id }).expect(200);
        const res = await patch({ desiredStatus: 'ON_AIR' }).expect(200);
        expect(res.body.activePlaylist.id).toBe(playlist.id);
      });

      it('404 for a playlist that does not exist, changing nothing', async () => {
        const res = await patch({
          activePlaylistId: MISSING_ID,
          desiredStatus: 'ON_AIR',
        }).expect(404);
        expect(res.body.message).toBe('Playlist not found');
        expect(db.station.rows[0]).toMatchObject({
          activePlaylistId: null,
          desiredStatus: 'OFF_AIR',
        });
      });

      it('400 for invalid input', async () => {
        await patch({}).expect(400);
        await patch({ activePlaylistId: 'not-a-uuid' }).expect(400);
        await patch({ activePlaylistId: 123 }).expect(400);
        await patch({ desiredStatus: 'MAYBE' }).expect(400);
        await patch({ desiredStatus: null }).expect(400);
        await patch({ name: 'Hacked' }).expect(400);
        await patch({ slug: 'other' }).expect(400);
        expect(db.station.rows[0]).toMatchObject({
          name: 'CDR Central Radio',
          slug: 'main',
        });
      });
    });

    describe('active playlist protection (Playlists API)', () => {
      it('DELETE /playlists/:id is 409 while the station selects it, with the playlist and its items intact', async () => {
        const playlist = await newPlaylist('Live');
        const track = (await db.track.create({
          data: { title: 't', status: 'READY' },
        })) as { id: string };
        await request(server())
          .post(`/playlists/${playlist.id}/tracks`)
          .set('Cookie', admin)
          .send({ trackId: track.id })
          .expect(201);
        await patch({ activePlaylistId: playlist.id }).expect(200);

        const res = await request(server())
          .delete(`/playlists/${playlist.id}`)
          .set('Cookie', admin)
          .expect(409);
        expect(res.body.message).toMatch(/selected by a station/);

        const detail = await request(server())
          .get(`/playlists/${playlist.id}`)
          .set('Cookie', admin)
          .expect(200);
        expect(detail.body.trackCount).toBe(1);
        expect(db.station.rows[0].activePlaylistId).toBe(playlist.id);
      });

      it('after switching the station away, the old playlist can be deleted', async () => {
        const a = await newPlaylist('A');
        const b = await newPlaylist('B');
        await patch({ activePlaylistId: a.id }).expect(200);
        await request(server())
          .delete(`/playlists/${a.id}`)
          .set('Cookie', admin)
          .expect(409);

        await patch({ activePlaylistId: b.id }).expect(200);
        await request(server())
          .delete(`/playlists/${a.id}`)
          .set('Cookie', admin)
          .expect(204);
        await request(server())
          .delete(`/playlists/${b.id}`)
          .set('Cookie', admin)
          .expect(409);

        await patch({ activePlaylistId: null }).expect(200);
        await request(server())
          .delete(`/playlists/${b.id}`)
          .set('Cookie', admin)
          .expect(204);
      });

      it('unrelated playlists remain deletable', async () => {
        const live = await newPlaylist('Live');
        const spare = await newPlaylist('Spare');
        await patch({ activePlaylistId: live.id }).expect(200);
        await request(server())
          .delete(`/playlists/${spare.id}`)
          .set('Cookie', admin)
          .expect(204);
      });
    });
  });
});

/**
 * Playback over HTTP: real AppModule, guards (JWT, roles, internal token, Origin) and real
 * Playback/Stations services; in-memory tables, presigning and Liquidsoap control are faked.
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
import { createFakePrisma } from './support/fake-track-store.js';

const INTERNAL = `Bearer ${process.env.STREAM_INTERNAL_TOKEN}`;
const FRONTEND = process.env.FRONTEND_URL!;

describe('Playback (e2e)', () => {
  let app: NestExpressApplication;
  let users: User[];
  let db: ReturnType<typeof createFakePrisma>;
  let admin: string;
  let operator: string;
  let control: {
    skip: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
  };
  let playlist: { id: string; itemIds: string[] };

  const server = () => app.getHttpServer();
  const internalNext = (after?: string) =>
    request(server())
      .get(
        `/internal/stream/next${after !== undefined ? `?after=${after}` : ''}`,
      )
      .set('Authorization', INTERNAL);
  const event = (body: object) =>
    request(server())
      .post('/internal/stream/events')
      .set('Authorization', INTERNAL)
      .send(body);

  async function boot(withControl = true) {
    users = await makeUsers();
    db = createFakePrisma();
    await seedStation(db as never);
    const storage = {
      getPresignedGetUrl: async (key: string) => ({
        url: `https://r2.example.test/${key}?X-Amz-Signature=sig`,
        expiresAt: new Date(Date.now() + 300_000),
      }),
    };
    control = {
      skip: vi.fn(async () => ({
        ok: true,
        source: 'playlist',
        skipped: true,
      })),
      reload: vi.fn(async ({ skip }: { skip: boolean }) => ({
        ok: true,
        source: 'playlist',
        flushed: 1,
        queued: true,
        skipped: skip,
      })),
    };
    app = await createTestApp({
      users,
      prisma: db,
      storage,
      ...(withControl ? { control } : {}),
    });
    admin = await sessionFor(app, users, ADMIN.email);
    operator = await sessionFor(app, users, OPERATOR.email);

    const ids: string[] = [];
    for (const title of ['A', 'B', 'C']) {
      const t = (await db.track.create({
        data: { title, status: 'READY', durationMs: 30_000 },
      })) as { id: string };
      await db.track.update({
        where: { id: t.id },
        data: { storageKey: `tracks/${t.id}.mp3` },
      });
      ids.push(t.id);
    }
    const p = (await db.playlist.create({ data: { name: 'P' } })) as {
      id: string;
    };
    const itemIds: string[] = [];
    for (const [position, trackId] of ids.entries()) {
      itemIds.push(
        (
          (await db.playlistTrack.create({
            data: { playlistId: p.id, trackId, position },
          })) as { id: string }
        ).id,
      );
    }
    playlist = { id: p.id, itemIds };
  }

  afterEach(async () => {
    await app.close();
  });

  describe('internal routes (Liquidsoap)', () => {
    beforeEach(() => boot());

    it('reject a missing or wrong token, and an admin session, with 401', async () => {
      await request(server()).get('/internal/stream/next').expect(401);
      await request(server())
        .get('/internal/stream/next')
        .set('Authorization', 'Bearer wrong')
        .expect(401);
      await request(server())
        .get('/internal/stream/next')
        .set('Cookie', admin)
        .expect(401);
      await request(server())
        .post('/internal/stream/events')
        .set('Cookie', admin)
        .send({
          type: 'heartbeat',
          source: 'fallback',
          startedAt: Date.now() / 1000,
        })
        .expect(401);
    });

    it('next: 204 while OFF_AIR / no playlist, then items in order once ON_AIR', async () => {
      const none = await internalNext().expect(204);
      expect(none.headers['cache-control']).toBe('no-store');

      await db.station.update({
        where: { slug: 'main' },
        data: { activePlaylistId: playlist.id, desiredStatus: 'ON_AIR' },
      });
      const first = (await internalNext('').expect(200)).body;
      expect(first).toMatchObject({
        title: 'A',
        itemId: playlist.itemIds[0],
        position: 0,
      });
      expect(Object.keys(first).sort()).toEqual([
        'artist',
        'durationMs',
        'itemId',
        'occurrenceId',
        'playlistId',
        'position',
        'title',
        'trackId',
        'uri',
      ]);
      expect(
        (await internalNext(playlist.itemIds[2]).expect(200)).body.title,
      ).toBe('A');
      await internalNext('not-a-uuid').expect(400);
    });

    it('events: validated, then recorded only from confirmed starts', async () => {
      const startedAt = Date.now() / 1000 - 1;
      await event({ type: 'nope', source: 'playlist', startedAt }).expect(400);
      await event({
        type: 'track_started',
        source: 'playlist',
        startedAt,
      }).expect(400); // ids missing
      await event({
        type: 'heartbeat',
        source: 'fallback',
        startedAt,
        extra: 1,
      }).expect(400);

      const body = {
        type: 'track_started',
        source: 'playlist',
        occurrenceId: crypto.randomUUID(),
        itemId: playlist.itemIds[1],
        trackId: db.playlistTrack.rows[1].trackId,
        startedAt,
      };
      expect((await event(body).expect(200)).body).toEqual({ applied: true });
      expect((await event(body).expect(200)).body).toEqual({
        applied: true,
        reason: 'duplicate',
      });

      const np = await request(server())
        .get('/stations/main/now-playing')
        .expect(200);
      expect(np.body).toMatchObject({
        status: 'PLAYING',
        confirmed: true,
        track: { title: 'B' },
      });

      // Fallback events are accepted with the empty ids Liquidsoap sends.
      await event({
        type: 'track_started',
        source: 'fallback',
        occurrenceId: '',
        itemId: '',
        trackId: '',
        startedAt: startedAt + 1,
      }).expect(200);
      const fb = await request(server())
        .get('/stations/main/now-playing')
        .expect(200);
      expect(fb.body).toMatchObject({
        status: 'FALLBACK',
        confirmed: false,
        track: null,
      });
    });
  });

  describe('admin playback controls', () => {
    beforeEach(() => boot());

    it('401 without a session, 403 for OPERATOR; Liquidsoap is not called', async () => {
      await request(server()).post('/stations/main/playback/skip').expect(401);
      await request(server())
        .post('/stations/main/playback/apply')
        .send({})
        .expect(401);
      await request(server())
        .post('/stations/main/playback/skip')
        .set('Cookie', operator)
        .expect(403);
      await request(server())
        .post('/stations/main/playback/apply')
        .set('Cookie', operator)
        .send({})
        .expect(403);
      expect(control.skip).not.toHaveBeenCalled();
      expect(control.reload).not.toHaveBeenCalled();
    });

    it('skip: 200 when Liquidsoap skipped, 409 when only the fallback is on air', async () => {
      await request(server())
        .post('/stations/main/playback/skip')
        .set('Cookie', admin)
        .set('Origin', FRONTEND)
        .expect(200, { skipped: true });

      control.skip.mockResolvedValueOnce({
        ok: true,
        source: 'fallback',
        skipped: false,
      });
      await request(server())
        .post('/stations/main/playback/skip')
        .set('Cookie', admin)
        .expect(409);
    });

    it('apply: saves settings and reloads at the next boundary; immediate also skips', async () => {
      const res = await request(server())
        .post('/stations/main/playback/apply')
        .set('Cookie', admin)
        .set('Origin', FRONTEND)
        .send({ activePlaylistId: playlist.id, desiredStatus: 'ON_AIR' })
        .expect(200);
      expect(res.body).toMatchObject({
        effective: 'next_track',
        station: {
          desiredStatus: 'ON_AIR',
          activePlaylist: { id: playlist.id },
        },
        control: { flushed: 1, queued: true },
      });
      expect(control.reload).toHaveBeenLastCalledWith({ skip: false });

      const now = await request(server())
        .post('/stations/main/playback/apply')
        .set('Cookie', admin)
        .send({ immediate: true })
        .expect(200);
      expect(now.body.effective).toBe('now');
      expect(control.reload).toHaveBeenLastCalledWith({ skip: true });
    });

    it('apply: 400 for bad input, 404 for an unknown playlist (playout untouched)', async () => {
      const apply = (body: object) =>
        request(server())
          .post('/stations/main/playback/apply')
          .set('Cookie', admin)
          .send(body);
      await apply({ immediate: 'yes' }).expect(400);
      await apply({ activePlaylistId: 'nope' }).expect(400);
      await apply({ somethingElse: true }).expect(400);
      await apply({
        activePlaylistId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
      expect(control.reload).not.toHaveBeenCalled();
    });

    it('CSRF: a cross-origin request is rejected before anything runs', async () => {
      await request(server())
        .post('/stations/main/playback/skip')
        .set('Cookie', admin)
        .set('Origin', 'https://evil.example')
        .expect(403);
      await request(server())
        .patch('/stations/main')
        .set('Cookie', admin)
        .set('Origin', 'https://evil.example')
        .send({ desiredStatus: 'ON_AIR' })
        .expect(403);
      expect(control.skip).not.toHaveBeenCalled();
      expect(db.station.rows[0].desiredStatus).toBe('OFF_AIR');
    });
  });

  describe('when the playout engine is unreachable (real client, closed port)', () => {
    beforeEach(() => boot(false));

    it('skip is 503, never a false success', async () => {
      const res = await request(server())
        .post('/stations/main/playback/skip')
        .set('Cookie', admin)
        .expect(503);
      expect(res.body.message).toMatch(/not reachable/);
    });

    it('apply saves settings but reports 503 with settingsSaved', async () => {
      const res = await request(server())
        .post('/stations/main/playback/apply')
        .set('Cookie', admin)
        .send({ desiredStatus: 'ON_AIR' })
        .expect(503);
      expect(res.body).toMatchObject({ settingsSaved: true });
      expect(db.station.rows[0].desiredStatus).toBe('ON_AIR');
    });
  });
});

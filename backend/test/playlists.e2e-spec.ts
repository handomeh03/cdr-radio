/**
 * Playlists over HTTP: real AppModule, guards, validation and the real TracksService/PlaylistsService;
 * in-memory tables (with unique-index, FK and rollback emulation) and R2. No PostgreSQL or Cloudflare.
 */
import './support/e2e-env.js'; // must stay first: sets env before AppModule loads
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { rm } from 'node:fs/promises';
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

describe('Playlists (e2e, in-memory DB/R2)', () => {
  let app: NestExpressApplication;
  let users: User[];
  let db: ReturnType<typeof createFakePrisma>;
  let storage: ReturnType<typeof createFakeStorage>;
  let admin: string;
  let operator: string;

  const server = () => app.getHttpServer();
  const as = (cookie: string) => ({
    get: (url: string) => request(server()).get(url).set('Cookie', cookie),
    post: (url: string) => request(server()).post(url).set('Cookie', cookie),
    patch: (url: string) => request(server()).patch(url).set('Cookie', cookie),
    put: (url: string) => request(server()).put(url).set('Cookie', cookie),
    delete: (url: string) =>
      request(server()).delete(url).set('Cookie', cookie),
  });

  /** A READY track with an object in (fake) R2, as an upload would leave it. */
  const readyTrack = async (title: string) => {
    const row = (await db.track.create({
      data: { title, status: 'READY', durationMs: 90_000, sizeBytes: 1000 },
    })) as { id: string };
    const storageKey = `tracks/${row.id}.mp3`;
    await db.track.update({ where: { id: row.id }, data: { storageKey } });
    storage.objects.set(storageKey, {
      sizeBytes: 1000,
      contentType: 'audio/mpeg',
    });
    return { id: row.id, storageKey };
  };
  const newPlaylist = async (name = 'Morning') =>
    (await as(admin).post('/playlists').send({ name }).expect(201)).body as {
      id: string;
    };
  const addItem = async (playlistId: string, trackId: string) =>
    (
      await as(admin)
        .post(`/playlists/${playlistId}/tracks`)
        .send({ trackId })
        .expect(201)
    ).body as { id: string; position: number };

  beforeEach(async () => {
    users = await makeUsers();
    db = createFakePrisma();
    storage = createFakeStorage();
    app = await createTestApp({ users, prisma: db, storage });
    admin = await sessionFor(app, users, ADMIN.email);
    operator = await sessionFor(app, users, OPERATOR.email);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await rm(process.env.AUDIO_TMP_DIR!, { recursive: true, force: true });
  });

  describe('authorization', () => {
    const itemUrl = `/playlists/${MISSING_ID}/tracks/${MISSING_ID}`;
    const routes: Array<[string, string, object?]> = [
      ['get', '/playlists'],
      ['get', `/playlists/${MISSING_ID}`],
      ['post', '/playlists', { name: 'x' }],
      ['patch', `/playlists/${MISSING_ID}`, { name: 'x' }],
      ['delete', `/playlists/${MISSING_ID}`],
      ['post', `/playlists/${MISSING_ID}/tracks`, { trackId: MISSING_ID }],
      ['delete', itemUrl],
      ['put', `/playlists/${MISSING_ID}/order`, { itemIds: [] }],
    ];

    it.each(routes)(
      '401 without a session: %s %s',
      async (method, url, body) => {
        const req = (request(server()) as any)[method](url);
        await (body ? req.send(body) : req).expect(401);
      },
    );

    it('OPERATOR may read (200) but not manage (403)', async () => {
      const playlist = await newPlaylist();
      await as(operator).get('/playlists').expect(200);
      await as(operator).get(`/playlists/${playlist.id}`).expect(200);

      const track = await readyTrack('A');
      await as(operator).post('/playlists').send({ name: 'x' }).expect(403);
      await as(operator)
        .patch(`/playlists/${playlist.id}`)
        .send({ name: 'x' })
        .expect(403);
      await as(operator).delete(`/playlists/${playlist.id}`).expect(403);
      await as(operator)
        .post(`/playlists/${playlist.id}/tracks`)
        .send({ trackId: track.id })
        .expect(403);
      await as(operator)
        .put(`/playlists/${playlist.id}/order`)
        .send({ itemIds: [] })
        .expect(403);
      await as(operator)
        .delete(`/playlists/${playlist.id}/tracks/${MISSING_ID}`)
        .expect(403);
      expect(db.playlist.rows).toHaveLength(1);
    });
  });

  describe('validation', () => {
    it('POST /playlists: 400 for missing, blank, oversized or unknown fields', async () => {
      const post = (body: object) => as(admin).post('/playlists').send(body);
      await post({}).expect(400);
      await post({ name: '   ' }).expect(400);
      await post({ name: 'x'.repeat(101) }).expect(400);
      await post({ name: 'ok', description: 'x'.repeat(501) }).expect(400);
      await post({ name: 'ok', createdById: MISSING_ID }).expect(400);
      expect(db.playlist.rows).toHaveLength(0);
    });

    it('trims and collapses whitespace in names', async () => {
      const res = await as(admin)
        .post('/playlists')
        .send({ name: '  Evening   Mix ', description: '' })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Evening Mix', trackCount: 0 });
    });

    it('400 for malformed ids and bodies', async () => {
      const playlist = await newPlaylist();
      await as(admin).get('/playlists/not-a-uuid').expect(400);
      await as(admin)
        .delete(`/playlists/${playlist.id}/tracks/not-a-uuid`)
        .expect(400);
      await as(admin)
        .post(`/playlists/${playlist.id}/tracks`)
        .send({ trackId: 'nope' })
        .expect(400);
      await as(admin)
        .post(`/playlists/${playlist.id}/tracks`)
        .send({})
        .expect(400);
      const order = (body: object) =>
        as(admin).put(`/playlists/${playlist.id}/order`).send(body);
      await order({}).expect(400);
      await order({ itemIds: 'abc' }).expect(400);
      await order({ itemIds: ['not-a-uuid'] }).expect(400);
      await order({ itemIds: Array(1001).fill(MISSING_ID) }).expect(400);
      await as(admin).get('/playlists?pageSize=1000').expect(400);
      await as(admin).get('/playlists?page=0').expect(400);
    });
  });

  describe('management flow', () => {
    it('create -> add (with a repeated track) -> detail -> reorder -> remove -> update -> delete', async () => {
      const [a, b] = [await readyTrack('A'), await readyTrack('B')];
      const playlist = await newPlaylist('Morning');

      const i1 = await addItem(playlist.id, a.id);
      const i2 = await addItem(playlist.id, b.id);
      const i3 = await addItem(playlist.id, a.id); // same track again
      expect([i1.position, i2.position, i3.position]).toEqual([0, 1, 2]);

      const detail = await as(operator)
        .get(`/playlists/${playlist.id}`)
        .expect(200);
      expect(detail.body).toMatchObject({
        name: 'Morning',
        trackCount: 3,
        totalDurationMs: 270_000,
      });
      expect(detail.body.items.map((i: any) => i.track.title)).toEqual([
        'A',
        'B',
        'A',
      ]);
      expect(JSON.stringify(detail.body)).not.toMatch(
        /storageKey|tracks\/|sizeBytes|r2\.|cloudflare/i,
      );

      const reordered = await as(admin)
        .put(`/playlists/${playlist.id}/order`)
        .send({ itemIds: [i3.id, i2.id, i1.id] })
        .expect(200);
      expect(reordered.body.items.map((i: any) => [i.id, i.position])).toEqual([
        [i3.id, 0],
        [i2.id, 1],
        [i1.id, 2],
      ]);

      await as(admin)
        .delete(`/playlists/${playlist.id}/tracks/${i2.id}`)
        .expect(204);
      const afterRemove = await as(admin)
        .get(`/playlists/${playlist.id}`)
        .expect(200);
      expect(
        afterRemove.body.items.map((i: any) => [i.id, i.position]),
      ).toEqual([
        [i3.id, 0],
        [i1.id, 1],
      ]);
      await as(admin)
        .delete(`/playlists/${playlist.id}/tracks/${i2.id}`)
        .expect(404);

      const patched = await as(admin)
        .patch(`/playlists/${playlist.id}`)
        .send({ name: 'Morning v2', description: 'Calm' })
        .expect(200);
      expect(patched.body).toMatchObject({
        name: 'Morning v2',
        description: 'Calm',
        trackCount: 2,
      });
      await as(admin).patch(`/playlists/${playlist.id}`).send({}).expect(400);

      await as(admin).delete(`/playlists/${playlist.id}`).expect(204);
      await as(admin).get(`/playlists/${playlist.id}`).expect(404);
      // Deleting a playlist never deletes tracks or their audio.
      expect(db.track.rows).toHaveLength(2);
      expect(storage.objects.has(a.storageKey)).toBe(true);
      expect(storage.objects.has(b.storageKey)).toBe(true);
    });

    it('lists with pagination, search and counts', async () => {
      for (const name of ['Breakfast', 'Lunch', 'Dinner', 'Brunch']) {
        await newPlaylist(name);
      }
      const track = await readyTrack('A');
      const lunch = (await as(admin).get('/playlists?search=lunch').expect(200))
        .body.items[0];
      await addItem(lunch.id, track.id);

      const page = await as(operator)
        .get('/playlists?page=2&pageSize=3')
        .expect(200);
      expect(page.body).toMatchObject({
        total: 4,
        page: 2,
        pageSize: 3,
        totalPages: 2,
      });
      expect(page.body.items).toHaveLength(1);

      const search = await as(operator).get('/playlists?search=BR').expect(200);
      expect(search.body.items.map((p: any) => p.name).sort()).toEqual([
        'Breakfast',
        'Brunch',
      ]);
      const all = await as(operator).get('/playlists?pageSize=100').expect(200);
      expect(
        all.body.items.find((p: any) => p.id === lunch.id).trackCount,
      ).toBe(1);
    });

    it('404s for unknown playlists, tracks and items', async () => {
      const playlist = await newPlaylist();
      const track = await readyTrack('A');
      await as(admin).get(`/playlists/${MISSING_ID}`).expect(404);
      await as(admin)
        .patch(`/playlists/${MISSING_ID}`)
        .send({ name: 'x' })
        .expect(404);
      await as(admin).delete(`/playlists/${MISSING_ID}`).expect(404);
      await as(admin)
        .post(`/playlists/${MISSING_ID}/tracks`)
        .send({ trackId: track.id })
        .expect(404);
      await as(admin)
        .post(`/playlists/${playlist.id}/tracks`)
        .send({ trackId: MISSING_ID })
        .expect(404);
      await as(admin)
        .delete(`/playlists/${playlist.id}/tracks/${MISSING_ID}`)
        .expect(404);
      await as(admin)
        .put(`/playlists/${MISSING_ID}/order`)
        .send({ itemIds: [] })
        .expect(404);
    });

    it('only READY tracks can be added (409 for PROCESSING/FAILED)', async () => {
      const playlist = await newPlaylist();
      for (const status of ['PROCESSING', 'FAILED']) {
        const track = (await db.track.create({
          data: { title: status, status },
        })) as { id: string };
        const res = await as(admin)
          .post(`/playlists/${playlist.id}/tracks`)
          .send({ trackId: track.id })
          .expect(409);
        expect(res.body.message).toMatch(/READY/);
      }
      expect(db.playlistTrack.rows).toHaveLength(0);
    });

    it('rejects invalid reorders: 400 duplicates, 409 foreign/missing, nothing changes', async () => {
      const track = await readyTrack('A');
      const playlist = await newPlaylist('One');
      const other = await newPlaylist('Two');
      const i1 = await addItem(playlist.id, track.id);
      const i2 = await addItem(playlist.id, track.id);
      const foreign = await addItem(other.id, track.id);
      const put = (ids: string[]) =>
        as(admin).put(`/playlists/${playlist.id}/order`).send({ itemIds: ids });

      await put([i1.id, i1.id]).expect(400);
      await put([i1.id]).expect(409);
      await put([i1.id, foreign.id]).expect(409);
      await put([i1.id, i2.id, MISSING_ID]).expect(409);
      await put([track.id, i2.id]).expect(409); // track ids are not item ids

      const detail = await as(admin)
        .get(`/playlists/${playlist.id}`)
        .expect(200);
      expect(detail.body.items.map((i: any) => i.id)).toEqual([i1.id, i2.id]);
    });
  });

  describe('track deletion protection', () => {
    it('409 while a playlist uses the track: the row and the R2 object are untouched', async () => {
      const track = await readyTrack('Used');
      const playlist = await newPlaylist();
      const item = await addItem(playlist.id, track.id);

      const res = await as(admin).delete(`/tracks/${track.id}`).expect(409);
      expect(res.body.message).toMatch(/playlist/i);
      expect(db.track.rows.some((t) => t.id === track.id)).toBe(true);
      expect(storage.objects.has(track.storageKey)).toBe(true);

      // Once every use is removed, the delete goes through and removes the audio.
      await as(admin)
        .delete(`/playlists/${playlist.id}/tracks/${item.id}`)
        .expect(204);
      await as(admin).delete(`/tracks/${track.id}`).expect(204);
      expect(db.track.rows.some((t) => t.id === track.id)).toBe(false);
      expect(storage.objects.has(track.storageKey)).toBe(false);
    });

    it('stays protected while at least one of several uses remains', async () => {
      const track = await readyTrack('Twice');
      const one = await newPlaylist('One');
      const two = await newPlaylist('Two');
      await addItem(one.id, track.id);
      await addItem(two.id, track.id);

      await as(admin).delete(`/playlists/${one.id}`).expect(204);
      await as(admin).delete(`/tracks/${track.id}`).expect(409);
      expect(storage.objects.has(track.storageKey)).toBe(true);

      await as(admin).delete(`/playlists/${two.id}`).expect(204);
      await as(admin).delete(`/tracks/${track.id}`).expect(204);
    });

    it('an R2 outage during delete returns 502 and keeps the row (rolled back) and the object', async () => {
      const track = await readyTrack('Keep');
      storage.state.failDeletes = true;

      await as(admin).delete(`/tracks/${track.id}`).expect(502);

      expect(db.track.rows.some((t) => t.id === track.id)).toBe(true);
      expect(storage.objects.has(track.storageKey)).toBe(true);

      storage.state.failDeletes = false;
      await as(admin).delete(`/tracks/${track.id}`).expect(204);
      expect(storage.objects.has(track.storageKey)).toBe(false);
    });
  });
});

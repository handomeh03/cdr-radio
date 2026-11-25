/**
 * Tracks over HTTP: real AppModule, guards, Multer, validation and host FFmpeg;
 * in-memory track table and R2. No PostgreSQL or Cloudflare is touched.
 */
import { E2E_AUDIO_WORK_DIR } from './support/e2e-env.js'; // must stay first
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { User } from '../src/generated/prisma/client.js';
import {
  createAudioFixtures,
  type AudioFixtures,
} from './support/audio-fixtures.js';
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

const leftoverTempFiles = async () =>
  (await readdir(E2E_AUDIO_WORK_DIR)).filter((n) => /^(upload|out)-/.test(n));

describe('Tracks (e2e, in-memory DB/R2, real FFmpeg)', () => {
  let app: NestExpressApplication;
  let users: User[];
  let prisma: ReturnType<typeof createFakePrisma>;
  let storage: ReturnType<typeof createFakeStorage>;
  let fixtures: AudioFixtures;
  let fixtureDir: string;
  let admin: string;
  let operator: string;

  const server = () => app.getHttpServer();
  const upload = (
    file: string,
    fields: Record<string, string> = {},
    cookie = admin,
  ) => {
    const req = request(server()).post('/tracks').set('Cookie', cookie);
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req.attach('file', file);
  };

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'cdr-tracks-e2e-'));
    fixtures = await createAudioFixtures(fixtureDir);
    users = await makeUsers();
    prisma = createFakePrisma();
    storage = createFakeStorage();
    app = await createTestApp({ users, prisma, storage });
    admin = await sessionFor(app, users, ADMIN.email);
    operator = await sessionFor(app, users, OPERATOR.email);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await rm(fixtureDir, { recursive: true, force: true });
    await rm(process.env.AUDIO_TMP_DIR!, { recursive: true, force: true });
  });

  afterEach(async () => {
    storage.state.failUploads = false;
    expect(await leftoverTempFiles()).toEqual([]);
  });

  describe('POST /tracks', () => {
    // Guards reject before the body is read, so Node may reset the socket while a large body
    // is still being sent. A tiny attachment lets the client observe the status code.
    const tinyBody = { filename: 'x.mp3', contentType: 'audio/mpeg' };

    it('401 without a session (nothing written to disk)', async () => {
      await request(server())
        .post('/tracks')
        .attach('file', Buffer.from('x'), tinyBody)
        .expect(401);
    });

    it('403 for OPERATOR (nothing written to disk)', async () => {
      await request(server())
        .post('/tracks')
        .set('Cookie', operator)
        .attach('file', Buffer.from('x'), tinyBody)
        .expect(403);
      expect(prisma.track.rows).toHaveLength(0);
    });

    it('400 when no file is sent', async () => {
      await request(server())
        .post('/tracks')
        .set('Cookie', admin)
        .field('title', 'x')
        .expect(400);
    });

    it('400 for an unknown field (temp file still cleaned up)', async () => {
      await upload(fixtures.wav, { bitrate: '320k' }).expect(400);
    });

    it('413 for a file over AUDIO_UPLOAD_MAX_MB (1 MB in tests)', async () => {
      const big = join(fixtureDir, 'big.wav');
      await writeFile(big, Buffer.alloc(1.5 * 1024 * 1024, 1));
      await upload(big).expect(413);
      expect(prisma.track.rows).toHaveLength(0);
    });

    it('422 for a text file renamed .mp3, with no row created', async () => {
      const res = await upload(fixtures.textAsMp3).expect(422);
      expect(res.body.message).toBe('The file could not be read as audio');
      expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z]:\\|\/tmp|ffprobe/);
      expect(prisma.track.rows).toHaveLength(0);
    });

    it('422 for a video file', async () => {
      await upload(fixtures.videoMp4).expect(422);
    });

    it('201: WAV -> READY MP3 in storage, correct duration, no storage key in the response', async () => {
      const res = await upload(fixtures.wav, {
        title: '  Morning   Tone ',
        artist: 'CDR Test',
      }).expect(201);

      expect(res.body).toMatchObject({
        title: 'Morning Tone',
        artist: 'CDR Test',
        status: 'READY',
        sourceFormat: 'wav',
        errorMessage: null,
      });
      expect(res.body.durationMs).toBeGreaterThan(2_900);
      expect(res.body.durationMs).toBeLessThan(3_200);
      expect(res.body).not.toHaveProperty('storageKey');
      expect(storage.objects.get(`tracks/${res.body.id}.mp3`)).toEqual({
        sizeBytes: res.body.sizeBytes,
        contentType: 'audio/mpeg',
      });
    });

    it('201: tags supply title/artist when fields are omitted', async () => {
      const res = await upload(fixtures.flacTagged).expect(201);
      expect(res.body).toMatchObject({
        title: 'Fixture Title',
        artist: 'Fixture Artist',
        sourceFormat: 'flac',
      });
    });

    it('502 when R2 fails: row FAILED with a safe message, no object stored', async () => {
      storage.state.failUploads = true;
      const before = storage.objects.size;
      const res = await upload(fixtures.m4a, {
        title: 'Storage outage',
      }).expect(502);

      expect(res.body).toMatchObject({
        message: 'Could not store the processed audio',
        trackId: expect.any(String),
      });
      const row = prisma.track.rows.find((r) => r.id === res.body.trackId);
      expect(row).toMatchObject({ status: 'FAILED', storageKey: null });
      expect(row?.errorMessage).not.toMatch(/simulated|outage/);
      expect(storage.objects.size).toBe(before);
    });
  });

  describe('GET /tracks', () => {
    it('lets OPERATOR list with pagination, search and status filter', async () => {
      const page1 = await request(server())
        .get('/tracks?page=1&pageSize=2')
        .set('Cookie', operator)
        .expect(200);
      expect(page1.body).toMatchObject({
        page: 1,
        pageSize: 2,
        total: 3,
        totalPages: 2,
      });
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0]).not.toHaveProperty('storageKey');

      const page2 = await request(server())
        .get('/tracks?page=2&pageSize=2')
        .set('Cookie', operator)
        .expect(200);
      expect(page2.body.items).toHaveLength(1);

      const search = await request(server())
        .get('/tracks?search=FIXTURE')
        .set('Cookie', operator)
        .expect(200);
      expect(search.body.items.map((t: { title: string }) => t.title)).toEqual([
        'Fixture Title',
      ]);

      const failed = await request(server())
        .get('/tracks?status=FAILED')
        .set('Cookie', operator)
        .expect(200);
      expect(failed.body.total).toBe(1);
    });

    it('400 for invalid query parameters', async () => {
      await request(server())
        .get('/tracks?pageSize=1000')
        .set('Cookie', admin)
        .expect(400);
      await request(server())
        .get('/tracks?page=0')
        .set('Cookie', admin)
        .expect(400);
      await request(server())
        .get('/tracks?status=DONE')
        .set('Cookie', admin)
        .expect(400);
    });

    it('401 without a session', async () => {
      await request(server()).get('/tracks').expect(401);
    });

    it('GET /tracks/:id returns metadata; 400 bad id; 404 unknown id', async () => {
      const id = prisma.track.rows[0].id;
      const res = await request(server())
        .get(`/tracks/${id}`)
        .set('Cookie', operator)
        .expect(200);
      expect(res.body.id).toBe(id);
      expect(res.body).not.toHaveProperty('storageKey');
      await request(server())
        .get('/tracks/not-a-uuid')
        .set('Cookie', operator)
        .expect(400);
      await request(server())
        .get('/tracks/00000000-0000-4000-8000-000000000000')
        .set('Cookie', operator)
        .expect(404);
    });
  });

  describe('PATCH /tracks/:id', () => {
    it('ADMIN edits title and clears artist', async () => {
      const id = prisma.track.rows[0].id;
      const res = await request(server())
        .patch(`/tracks/${id}`)
        .set('Cookie', admin)
        .send({ title: 'Renamed', artist: '' })
        .expect(200);
      expect(res.body).toMatchObject({ title: 'Renamed', artist: null });
    });

    it('rejects empty, oversized, unknown or server-managed fields; OPERATOR gets 403', async () => {
      const id = prisma.track.rows[0].id;
      const patch = (body: object, cookie = admin) =>
        request(server())
          .patch(`/tracks/${id}`)
          .set('Cookie', cookie)
          .send(body);
      await patch({}).expect(400);
      await patch({ title: '   ' }).expect(400);
      await patch({ title: 'x'.repeat(201) }).expect(400);
      await patch({ status: 'READY' }).expect(400);
      await patch({ storageKey: 'tracks/other.mp3' }).expect(400);
      await patch({ title: 'Nope' }, operator).expect(403);
    });
  });

  describe('DELETE /tracks/:id', () => {
    it('OPERATOR gets 403; ADMIN deletes the R2 object and the row; repeat is 404', async () => {
      const ready = prisma.track.rows.find((r) => r.status === 'READY')!;
      const key = `tracks/${ready.id}.mp3`;
      expect(storage.objects.has(key)).toBe(true);

      await request(server())
        .delete(`/tracks/${ready.id}`)
        .set('Cookie', operator)
        .expect(403);
      await request(server())
        .delete(`/tracks/${ready.id}`)
        .set('Cookie', admin)
        .expect(204);

      expect(storage.objects.has(key)).toBe(false);
      expect(prisma.track.rows.some((r) => r.id === ready.id)).toBe(false);
      await request(server())
        .delete(`/tracks/${ready.id}`)
        .set('Cookie', admin)
        .expect(404);
    });

    it('deletes a FAILED track (no stored object)', async () => {
      const failed = prisma.track.rows.find((r) => r.status === 'FAILED')!;
      await request(server())
        .delete(`/tracks/${failed.id}`)
        .set('Cookie', admin)
        .expect(204);
    });

    it('409 while a track is PROCESSING', async () => {
      const row = await prisma.track.create({
        data: { title: 'busy', status: 'PROCESSING' },
      });
      await request(server())
        .delete(`/tracks/${row.id}`)
        .set('Cookie', admin)
        .expect(409);
    });
  });
});

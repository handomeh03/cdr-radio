/**
 * Real-time metadata over a real HTTP server and real Socket.IO clients. The Icecast status
 * document is served by a local fake; PostgreSQL, R2 and Liquidsoap are in-memory fakes.
 */
import './support/e2e-env.js'; // must stay first: sets env before AppModule loads
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { seedStation } from '../prisma/seed-station.js';
import type { User } from '../src/generated/prisma/client.js';
import { createFakePrisma } from './support/fake-track-store.js';

const INTERNAL = `Bearer ${process.env.STREAM_INTERNAL_TOKEN}`;
const FRONTEND = process.env.FRONTEND_URL!;

type IcecastMode = 'live' | 'offline' | 'http-error' | 'garbage';

describe('Real-time metadata (e2e)', () => {
  let app: NestExpressApplication;
  let users: User[];
  let db: ReturnType<typeof createFakePrisma>;
  let admin: string;
  let port: number;
  let icecast: http.Server;
  let icecastMode: IcecastMode = 'live';
  let icecastHits = 0;
  let listeners = 7;
  let itemId: string;
  let trackId: string;
  const control = {
    skip: vi.fn(),
    reload: vi.fn(),
  };
  const sockets: Socket[] = [];

  const url = () => `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    icecast = http.createServer((req, res) => {
      if (req.url !== '/status-json.xsl') {
        res.writeHead(404).end();
        return;
      }
      icecastHits++;
      if (icecastMode === 'http-error') return void res.writeHead(500).end('nope');
      if (icecastMode === 'garbage') return void res.writeHead(200).end('<html>not json</html>');
      const body =
        icecastMode === 'offline'
          ? { icestats: {} }
          : { icestats: { source: { listenurl: 'http://127.0.0.1:8000/radio.mp3', listeners } } };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => icecast.listen(0, '127.0.0.1', resolve));
    const icecastPort = (icecast.address() as AddressInfo).port;
    // Read by ConfigModule when AppModule is first imported (below).
    process.env.ICECAST_PUBLIC_URL = `http://127.0.0.1:${icecastPort}/radio.mp3`;
    process.env.STREAM_STATUS_POLL_MS = '2000';
    process.env.SOCKET_ALLOWED_ORIGINS = `${FRONTEND},http://192.0.2.10:3000`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => icecast.close(() => resolve()));
  });

  beforeEach(async () => {
    const { createTestApp, makeUsers, ADMIN, sessionFor } = await import('./support/e2e-app.js');
    users = await makeUsers();
    db = createFakePrisma();
    await seedStation(db as never);
    const track = (await db.track.create({
      data: { title: 'Evening Groove', artist: 'The Band', status: 'READY', durationMs: 30_000 },
    })) as { id: string };
    await db.track.update({ where: { id: track.id }, data: { storageKey: `tracks/${track.id}.mp3` } });
    const playlist = (await db.playlist.create({ data: { name: 'P' } })) as { id: string };
    const item = (await db.playlistTrack.create({
      data: { playlistId: playlist.id, trackId: track.id, position: 0 },
    })) as { id: string };
    trackId = track.id;
    itemId = item.id;

    icecastMode = 'live';
    icecastHits = 0;
    listeners = 7;
    control.skip.mockReset();
    control.reload.mockReset();
    app = await createTestApp({ users, prisma: db, control });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    admin = await sessionFor(app, users, ADMIN.email);
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
  });

  /** Connects and records every event, so tests can assert counts, order and contents. */
  function connect(origin: string | null = FRONTEND, transports: string[] = ['websocket']) {
    const socket = io(`${url()}/radio`, {
      transports,
      reconnection: false,
      forceNew: true,
      ...(origin ? { extraHeaders: { Origin: origin } } : {}),
    });
    sockets.push(socket);
    const events: Record<string, unknown[]> = { 'now-playing': [], 'stream-status': [] };
    for (const name of Object.keys(events)) socket.on(name, (payload: unknown) => events[name].push(payload));
    return { socket, events };
  }
  const until = async (check: () => boolean, ms = 6_000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('timed out waiting for the condition');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const trackStarted = (startedAt: number) =>
    request(app.getHttpServer())
      .post('/internal/stream/events')
      .set('Authorization', INTERNAL)
      .send({
        type: 'track_started',
        source: 'playlist',
        occurrenceId: crypto.randomUUID(),
        itemId,
        trackId,
        startedAt,
      })
      .expect(200);
  const heartbeat = (startedAt: number) =>
    request(app.getHttpServer())
      .post('/internal/stream/events')
      .set('Authorization', INTERNAL)
      .send({
        type: 'heartbeat',
        source: 'playlist',
        occurrenceId: crypto.randomUUID(),
        itemId,
        trackId,
        startedAt,
      })
      .expect(200);

  it('sends the current snapshots on connect: now-playing UNKNOWN until playout reports, then the Icecast reading', async () => {
    const { events } = connect();
    await until(() => events['now-playing'].length === 1 && events['stream-status'].length >= 1);
    expect(events['now-playing'][0]).toMatchObject({
      status: 'UNKNOWN',
      confirmed: false,
      track: null,
      startedAt: null,
      desiredStatus: 'OFF_AIR',
    });
    // The first stream-status is honest about not knowing yet; the reading follows.
    expect(events['stream-status'][0]).toMatchObject({ status: 'UNKNOWN', listeners: null });
    await until(() => events['stream-status'].some((e) => (e as { status: string }).status === 'LIVE'));
    expect(events['stream-status'].at(-1)).toMatchObject({ status: 'LIVE', listeners: 7 });
    expect(typeof (events['stream-status'].at(-1) as { checkedAt: string }).checkedAt).toBe('string');
  });

  it('publishes a confirmed track start to every client, equal to what REST reports', async () => {
    const a = connect();
    const b = connect();
    await until(() => a.events['now-playing'].length === 1 && b.events['now-playing'].length === 1);

    await trackStarted(Date.now() / 1000 - 1);
    await until(() => a.events['now-playing'].length === 2 && b.events['now-playing'].length === 2);

    const rest = (await request(app.getHttpServer()).get('/stations/main/now-playing').expect(200)).body;
    for (const received of [a.events['now-playing'][1], b.events['now-playing'][1]]) {
      const { emittedAt, ...payload } = received as Record<string, unknown>;
      expect(typeof emittedAt).toBe('string');
      expect(payload).toEqual(rest); // same fields, same meaning, ISO dates: sockets and REST agree
      expect(payload).toMatchObject({ status: 'PLAYING', confirmed: true, track: { title: 'Evening Groove', artist: 'The Band' } });
    }
  });

  it('a repeat report (heartbeat) does not produce an update; each client gets each change exactly once', async () => {
    const { events } = connect();
    await until(() => events['now-playing'].length === 1);
    const startedAt = Date.now() / 1000 - 1;
    await trackStarted(startedAt);
    await until(() => events['now-playing'].length === 2);
    await heartbeat(startedAt);
    await heartbeat(startedAt);
    await sleep(600);
    expect(events['now-playing']).toHaveLength(2);
  });

  it('a reconnecting client gets the current state immediately, with no duplicate delivery', async () => {
    await trackStarted(Date.now() / 1000 - 1);
    const first = connect();
    await until(() => first.events['now-playing'].length === 1);
    expect(first.events['now-playing'][0]).toMatchObject({ status: 'PLAYING' });

    first.socket.disconnect();
    await sleep(150);
    first.socket.connect(); // reconnect
    await until(() => first.events['now-playing'].length === 2);
    expect(first.events['now-playing'][1]).toMatchObject({ status: 'PLAYING', track: { title: 'Evening Groove' } });

    // A change after the reconnect arrives once on that socket (no listener was doubled).
    await trackStarted(Date.now() / 1000);
    await until(() => first.events['now-playing'].length === 3);
    await sleep(300);
    expect(first.events['now-playing']).toHaveLength(3);
  });

  it('polls Icecast once per interval for all clients and stops when the last one leaves', async () => {
    const clients = [connect(), connect(), connect(), connect()];
    await until(() => clients.every((c) => c.events['stream-status'].some((e) => (e as { status: string }).status === 'LIVE')));
    await sleep(4_300); // two more poll ticks at 2 s
    expect(icecastHits).toBeGreaterThanOrEqual(3);
    expect(icecastHits).toBeLessThanOrEqual(4); // not 4 clients x 3 reads

    for (const c of clients) c.socket.disconnect();
    await sleep(500);
    const hits = icecastHits;
    await sleep(4_500);
    expect(icecastHits).toBe(hits); // nobody connected, nothing polled
  }, 30_000);

  it('reports listener changes and unavailable Icecast honestly (UNKNOWN, never zero listeners)', async () => {
    const { events } = connect();
    await until(() => events['stream-status'].some((e) => (e as { status: string }).status === 'LIVE'));

    listeners = 9;
    await until(() => (events['stream-status'].at(-1) as { listeners: number | null }).listeners === 9);

    icecastMode = 'http-error';
    await until(() => (events['stream-status'].at(-1) as { status: string }).status === 'UNKNOWN');
    expect(events['stream-status'].at(-1)).toMatchObject({ status: 'UNKNOWN', listeners: null });

    icecastMode = 'live';
    await until(() => (events['stream-status'].at(-1) as { status: string }).status === 'LIVE');
    icecastMode = 'garbage';
    await until(() => (events['stream-status'].at(-1) as { status: string }).status === 'UNKNOWN');
    expect(events['stream-status'].at(-1)).toMatchObject({ listeners: null });

    icecastMode = 'offline';
    await until(() => (events['stream-status'].at(-1) as { status: string }).status === 'OFFLINE');
    expect(events['stream-status'].at(-1)).toMatchObject({ status: 'OFFLINE', listeners: null });
  }, 30_000);

  it('a saved settings change reaches clients as the request, without claiming playback', async () => {
    const { events } = connect();
    await until(() => events['now-playing'].length === 1);
    await request(app.getHttpServer())
      .patch('/stations/main')
      .set('Cookie', admin)
      .set('Origin', FRONTEND)
      .send({ desiredStatus: 'ON_AIR' })
      .expect(200);
    await until(() => events['now-playing'].length === 2);
    expect(events['now-playing'][1]).toMatchObject({ status: 'UNKNOWN', confirmed: false, track: null, desiredStatus: 'ON_AIR' });
  });

  it('payloads are public-safe: fixed keys only, no storage key, URL, token or internal id', async () => {
    const { events } = connect();
    await trackStarted(Date.now() / 1000 - 1);
    await until(() => events['now-playing'].some((e) => (e as { status: string }).status === 'PLAYING'));
    await until(() => events['stream-status'].some((e) => (e as { status: string }).status === 'LIVE'));

    const playing = events['now-playing'].find((e) => (e as { status: string }).status === 'PLAYING') as Record<string, unknown>;
    expect(Object.keys(playing).sort()).toEqual(
      ['confirmed', 'desiredStatus', 'emittedAt', 'startOffsetMs', 'startedAt', 'status', 'track'].sort(),
    );
    expect(Object.keys(playing.track as object).sort()).toEqual(['artist', 'durationMs', 'id', 'title']);
    const live = events['stream-status'].at(-1) as Record<string, unknown>;
    expect(Object.keys(live).sort()).toEqual(['checkedAt', 'emittedAt', 'listeners', 'status']);

    const text = JSON.stringify(events);
    for (const secret of ['storageKey', 'tracks/', 'X-Amz', 'r2.', 'token', 'secret', 'password', 'passwordHash', 'occurrenceId', 'itemId', process.env.STREAM_INTERNAL_TOKEN!, process.env.LIQUIDSOAP_CONTROL_TOKEN!, process.env.JWT_SECRET!]) {
      expect(text).not.toContain(secret);
    }
  });

  it('is read-only: nothing a client sends changes the station or reaches the playout controls', async () => {
    const { socket, events } = connect();
    await until(() => events['now-playing'].length === 1);
    const before = (await request(app.getHttpServer()).get('/stations/main').expect(200)).body;
    for (const name of ['apply', 'skip', 'playback:apply', 'now-playing', 'update']) {
      socket.emit(name, { desiredStatus: 'ON_AIR', immediate: true, activePlaylistId: null });
    }
    await sleep(500);
    expect((await request(app.getHttpServer()).get('/stations/main').expect(200)).body).toEqual(before);
    expect(control.skip).not.toHaveBeenCalled();
    expect(control.reload).not.toHaveBeenCalled();
    expect(events['now-playing']).toHaveLength(1);
  });

  describe('origins', () => {
    it('accepts the configured origins and clients without an Origin header', async () => {
      for (const origin of [FRONTEND, 'http://192.0.2.10:3000', null]) {
        const { socket, events } = connect(origin);
        await until(() => events['now-playing'].length === 1);
        expect(socket.connected).toBe(true);
      }
    });

    it('rejects any other origin, for websocket and for polling', async () => {
      for (const transports of [['websocket'], ['polling']]) {
        const { socket, events } = connect('http://evil.example', transports);
        await new Promise<void>((resolve) => socket.once('connect_error', () => resolve()));
        expect(socket.connected).toBe(false);
        expect(events['now-playing']).toHaveLength(0);
      }
      const res = await request(app.getHttpServer())
        .get('/socket.io/?EIO=4&transport=polling')
        .set('Origin', 'http://evil.example');
      expect(res.status).toBe(403);
    });

    it('leaves the REST CSRF protection exactly as it was', async () => {
      await request(app.getHttpServer())
        .patch('/stations/main')
        .set('Cookie', admin)
        .set('Origin', 'http://192.0.2.10:3000') // allowed for sockets, but REST only trusts FRONTEND_URL
        .send({ desiredStatus: 'ON_AIR' })
        .expect(403);
    });
  });
});

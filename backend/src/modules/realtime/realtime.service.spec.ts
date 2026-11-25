import type { PlaybackReport } from '../playback/playback.service.js';
import type { NowPlayingDto } from '../stations/stations.service.js';
import type { IcecastReading } from './icecast-status.service.js';
import { RealtimeService } from './realtime.service.js';
import type { NowPlayingEvent, StreamStatusEvent } from './realtime.types.js';

const T0 = new Date('2026-11-24T12:00:00.000Z');

const playing = (title = 'A', startedAt = T0): NowPlayingDto => ({
  status: 'PLAYING',
  confirmed: true,
  track: { id: `id-${title}`, title, artist: null, durationMs: 30_000 },
  startedAt,
  startOffsetMs: 0,
  desiredStatus: 'ON_AIR',
});
const fallback = (desiredStatus: 'ON_AIR' | 'OFF_AIR' = 'OFF_AIR'): NowPlayingDto => ({
  status: 'FALLBACK',
  confirmed: false,
  track: null,
  startedAt: T0,
  startOffsetMs: 0,
  desiredStatus,
});

function setup() {
  let report: NowPlayingDto = fallback();
  let reportedAt: Date | null = T0;
  const reads = { count: 0 };
  let release: (() => void) | null = null;
  let hold = false;
  const stations = {
    getNowPlayingReport: vi.fn(async () => {
      reads.count++;
      if (hold) await new Promise<void>((resolve) => (release = resolve));
      return { nowPlaying: report, reportedAt };
    }),
    onSettingsChanged: vi.fn((fn: () => void) => {
      settings = fn;
      return () => undefined;
    }),
  };
  let settings: () => void = () => undefined;
  let reportListener: (r: PlaybackReport) => void = () => undefined;
  const playback = {
    onReport: vi.fn((fn: (r: PlaybackReport) => void) => {
      reportListener = fn;
      return () => undefined;
    }),
  };
  let reading: IcecastReading = { status: 'LIVE', listeners: 2 };
  const icecast = { read: vi.fn(async () => reading) };
  const service = new RealtimeService(
    { get: () => 5_000 } as never,
    stations as never,
    playback as never,
    icecast as never,
  );
  const published: NowPlayingEvent[] = [];
  const streams: StreamStatusEvent[] = [];
  service.onNowPlaying((e) => published.push(e));
  service.onStreamStatus((e) => streams.push(e));
  return {
    service,
    stations,
    icecast,
    published,
    streams,
    reads,
    setReport: (dto: NowPlayingDto, at: Date | null = new Date()) => {
      report = dto;
      reportedAt = at;
    },
    setReading: (r: IcecastReading) => (reading = r),
    holdReads: (on: boolean) => {
      hold = on;
      if (!on) release?.();
    },
    fireReport: (changed: boolean) => reportListener({ changed }),
    fireSettings: () => settings(),
  };
}

describe('RealtimeService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  describe('now-playing', () => {
    it('primes the snapshot at startup and serves it with ISO dates and only public fields', async () => {
      const s = setup();
      s.setReport(playing('A'), T0);
      s.service.onModuleInit();
      const snap = await s.service.getNowPlaying();
      expect(Object.keys(snap!).sort()).toEqual(
        ['confirmed', 'desiredStatus', 'emittedAt', 'startOffsetMs', 'startedAt', 'status', 'track'].sort(),
      );
      expect(Object.keys(snap!.track!).sort()).toEqual(['artist', 'durationMs', 'id', 'title']);
      expect(snap).toMatchObject({ status: 'PLAYING', confirmed: true, startedAt: T0.toISOString() });
      s.service.onModuleDestroy();
    });

    it('publishes a confirmed change once; an identical re-read publishes nothing', async () => {
      const s = setup();
      s.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.published).toHaveLength(1); // the primed snapshot (FALLBACK)

      s.setReport(playing('B', new Date(T0.getTime() + 1000)));
      s.fireReport(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.published).toHaveLength(2);
      expect(s.published[1]).toMatchObject({ status: 'PLAYING', track: { title: 'B' } });

      s.fireReport(true); // same state again
      await vi.advanceTimersByTimeAsync(0);
      expect(s.published).toHaveLength(2);
      s.service.onModuleDestroy();
    });

    it('a repeat report (heartbeat) costs no query and keeps the state fresh; silence turns it UNKNOWN', async () => {
      const s = setup();
      s.setReport(playing('A'), T0);
      s.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(0);
      const readsAfterPrime = s.reads.count;

      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(15_000);
        s.fireReport(false); // heartbeat every 15 s
      }
      expect(s.reads.count).toBe(readsAfterPrime); // no database reads for heartbeats
      expect(s.published).toHaveLength(1);
      expect((await s.service.getNowPlaying())!.status).toBe('PLAYING'); // 60 s later, still fresh

      await vi.advanceTimersByTimeAsync(50_000); // playout went quiet
      expect(s.published).toHaveLength(2);
      expect(s.published[1]).toMatchObject({
        status: 'UNKNOWN',
        confirmed: false,
        track: null,
        startedAt: null,
        desiredStatus: 'ON_AIR', // the request is kept, but it is not claimed as playing
      });
      s.service.onModuleDestroy();
    });

    it('a report after UNKNOWN re-reads the confirmed state', async () => {
      const s = setup();
      s.setReport(playing('A'), new Date(T0.getTime() - 120_000)); // already stale when read
      s.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(5_000);
      s.setReport(playing('A'), new Date());
      s.fireReport(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.reads.count).toBeGreaterThanOrEqual(2);
      s.service.onModuleDestroy();
    });

    it('a saved settings change publishes the new request without claiming playback', async () => {
      const s = setup();
      s.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(0);
      s.setReport(fallback('ON_AIR'));
      s.fireSettings();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.published.at(-1)).toMatchObject({ status: 'FALLBACK', confirmed: false, desiredStatus: 'ON_AIR' });
      s.service.onModuleDestroy();
    });

    it('overlapping triggers never overlap reads and the newest state wins', async () => {
      const s = setup();
      s.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(0);
      s.holdReads(true);
      s.setReport(playing('B', new Date(T0.getTime() + 1000)));
      s.fireReport(true);
      await vi.advanceTimersByTimeAsync(0);
      s.setReport(playing('C', new Date(T0.getTime() + 2000)));
      s.fireReport(true); // arrives while the read is in flight
      s.fireReport(true);
      const readsDuring = s.reads.count;
      s.holdReads(false);
      await vi.advanceTimersByTimeAsync(0);
      s.holdReads(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.reads.count).toBe(readsDuring + 1); // exactly one follow-up read for the burst
      expect(s.published.at(-1)).toMatchObject({ track: { title: 'C' } });
      s.service.onModuleDestroy();
    });

    it('returns null (clients use REST) when the state cannot be read', async () => {
      const s = setup();
      s.stations.getNowPlayingReport.mockRejectedValue(new Error('db down'));
      expect(await s.service.getNowPlaying()).toBeNull();
    });
  });

  describe('stream status (one shared poll)', () => {
    it('does not poll without clients', async () => {
      const s = setup();
      s.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(s.icecast.read).not.toHaveBeenCalled();
      s.service.onModuleDestroy();
    });

    it('polls once at the first client, then once per interval however many clients connect', async () => {
      const s = setup();
      s.service.setClientCount(1);
      s.service.setClientCount(5);
      s.service.setClientCount(20);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.icecast.read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000 * 4);
      expect(s.icecast.read).toHaveBeenCalledTimes(5);
      expect(s.streams[0]).toMatchObject({ status: 'LIVE', listeners: 2 });
      expect(s.streams).toHaveLength(1); // unchanged readings are not re-sent
      s.service.setClientCount(0);
    });

    it('publishes changes in listeners and in health', async () => {
      const s = setup();
      s.service.setClientCount(1);
      await vi.advanceTimersByTimeAsync(0);
      s.setReading({ status: 'LIVE', listeners: 3 });
      await vi.advanceTimersByTimeAsync(5_000);
      s.setReading({ status: 'OFFLINE', listeners: null });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(s.streams.map((e) => [e.status, e.listeners])).toEqual([
        ['LIVE', 2],
        ['LIVE', 3],
        ['OFFLINE', null],
      ]);
      s.service.setClientCount(0);
    });

    it('an unreachable Icecast is UNKNOWN with no listener count, never zero or healthy', async () => {
      const s = setup();
      s.service.setClientCount(1);
      await vi.advanceTimersByTimeAsync(0);
      s.setReading({ status: 'UNKNOWN', listeners: null });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(s.streams.at(-1)).toMatchObject({ status: 'UNKNOWN', listeners: null });
      expect(s.service.getStreamStatus()).toMatchObject({ status: 'UNKNOWN', listeners: null });
      s.service.setClientCount(0);
    });

    it('never runs two reads at once', async () => {
      const s = setup();
      let resolveRead: (r: IcecastReading) => void = () => undefined;
      s.icecast.read.mockImplementation(() => new Promise<IcecastReading>((resolve) => (resolveRead = resolve)));
      s.service.setClientCount(1);
      await vi.advanceTimersByTimeAsync(5_000 * 5); // five ticks while the first read is still pending
      expect(s.icecast.read).toHaveBeenCalledTimes(1);
      resolveRead({ status: 'LIVE', listeners: 1 });
      await vi.advanceTimersByTimeAsync(0);
      s.service.setClientCount(0);
    });

    it('stops polling at zero clients and forgets the reading, so a new client never sees an old one', async () => {
      const s = setup();
      s.service.setClientCount(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.service.getStreamStatus().status).toBe('LIVE');
      s.service.setClientCount(0);
      expect(s.service.getStreamStatus()).toMatchObject({ status: 'UNKNOWN', listeners: null, checkedAt: null });
      const calls = s.icecast.read.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(s.icecast.read.mock.calls.length).toBe(calls);
    });

    it('shutdown clears every timer and subscription', async () => {
      const s = setup();
      s.service.onModuleInit();
      s.service.setClientCount(2);
      await vi.advanceTimersByTimeAsync(0);
      s.service.onModuleDestroy();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

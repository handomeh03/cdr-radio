/**
 * In-memory stand-ins for the Prisma tables (tracks, playlists, playlist items, stations,
 * station playback) and for R2, used by the HTTP e2e tests and the service tests.
 * No PostgreSQL or Cloudflare.
 *
 * It deliberately enforces the rules the real database enforces, so tests fail where production
 * would: the unique (playlist, position) index is checked row by row, deleting a track used by a
 * playlist is rejected (RESTRICT, P2003), deleting a playlist cascades to its items but is
 * rejected while a station selects it (RESTRICT, P2003), a station cannot select a missing
 * playlist (P2003), and a failed transaction is rolled back. Callback transactions run one at a time (a stricter stand-in for
 * the per-playlist row lock); real concurrent behaviour depends on PostgreSQL and is not tested.
 */
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { Prisma } from '../../src/generated/prisma/client.js';
import type {
  Playlist,
  PlaylistTrack,
  Station,
  StationPlayback,
  Track,
} from '../../src/generated/prisma/client.js';
import { StorageError } from '../../src/storage/r2-storage.service.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Where = Record<string, any>;
type Select = Record<string, any> | undefined;
type Row = Record<string, any>;

const prismaError = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'fake',
  });
const notFound = () => prismaError('P2025', 'Record not found');

/** Copies the selected scalar fields (no select = every field). */
function pickScalars(row: Row, select: Select): Row {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => select[key] === true),
  );
}

function matchesText(
  value: string | null | undefined,
  contains: string,
): boolean {
  return (value ?? '').toLowerCase().includes(contains.toLowerCase());
}

function matchesTrack(row: Track, where: Where = {}): boolean {
  if (where.id && row.id !== where.id) return false;
  if (where.status && row.status !== where.status) return false;
  if (where.OR) {
    return where.OR.some((cond: Where) =>
      Object.entries(cond).some(([field, { contains }]: [string, any]) =>
        matchesText(row[field as 'title' | 'artist'], contains),
      ),
    );
  }
  return true;
}

function matchesItem(row: PlaylistTrack, where: Where = {}): boolean {
  if (where.id !== undefined) {
    const ids: string[] = where.id.in ?? [where.id];
    if (!ids.includes(row.id)) return false;
  }
  if (where.playlistId && row.playlistId !== where.playlistId) return false;
  if (where.trackId && row.trackId !== where.trackId) return false;
  return true;
}

export function createFakePrisma() {
  const trackRows: Track[] = [];
  const playlistRows: Playlist[] = [];
  const itemRows: PlaylistTrack[] = [];
  const stationRows: Station[] = [];
  const playbackRows: StationPlayback[] = [];
  let clock = Date.now();
  const tick = () => new Date(clock++);

  // ---- tracks -------------------------------------------------------------------------------
  const track = {
    rows: trackRows,
    create: async ({ data, select }: { data: Row; select?: Select }) => {
      const now = tick();
      const row = {
        id: randomUUID(),
        title: '',
        artist: null,
        status: 'PROCESSING',
        durationMs: null,
        sourceFormat: null,
        sizeBytes: null,
        storageKey: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      } as Track;
      trackRows.push(row);
      return pickScalars(row, select);
    },
    update: async ({
      where,
      data,
      select,
    }: {
      where: Where;
      data: Row;
      select?: Select;
    }) => {
      const row = trackRows.find((r) => r.id === where.id);
      if (!row) throw notFound();
      Object.assign(row, data, { updatedAt: tick() });
      return pickScalars(row, select);
    },
    updateMany: async ({ where, data }: { where: Where; data: Row }) => {
      const hit = trackRows.filter((r) => matchesTrack(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    findUnique: async ({
      where,
      select,
    }: {
      where: Where;
      select?: Select;
    }) => {
      const row = trackRows.find((r) => r.id === where.id);
      return row ? pickScalars(row, select) : null;
    },
    findMany: async ({
      where,
      select,
      skip = 0,
      take,
    }: {
      where?: Where;
      select?: Select;
      skip?: number;
      take?: number;
    }) =>
      trackRows
        .filter((r) => matchesTrack(r, where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(skip, take === undefined ? undefined : skip + take)
        .map((r) => pickScalars(r, select)),
    count: async ({ where }: { where?: Where }) =>
      trackRows.filter((r) => matchesTrack(r, where)).length,
    /** RESTRICT: a track used by a playlist item cannot be deleted. */
    delete: async ({ where }: { where: Where }) => {
      const index = trackRows.findIndex((r) => r.id === where.id);
      if (index < 0) throw notFound();
      if (itemRows.some((item) => item.trackId === where.id)) {
        throw prismaError('P2003', 'Foreign key constraint violated');
      }
      return trackRows.splice(index, 1)[0];
    },
  };

  // ---- playlist items -----------------------------------------------------------------------
  const positionTaken = (item: PlaylistTrack, position: number) =>
    itemRows.some(
      (other) =>
        other.id !== item.id &&
        other.playlistId === item.playlistId &&
        other.position === position,
    );

  /** Applies a position change with PostgreSQL's immediate (per-row) unique check. */
  const setPosition = (item: PlaylistTrack, position: number) => {
    if (positionTaken(item, position)) {
      throw prismaError(
        'P2002',
        'Unique constraint failed on (playlist_id, position)',
      );
    }
    item.position = position;
  };

  const projectItem = (row: PlaylistTrack, select: Select): Row => {
    const out = pickScalars(row, select);
    if (select?.track) {
      const parent = trackRows.find((t) => t.id === row.trackId)!;
      out.track = pickScalars(parent, select.track.select);
    }
    return out;
  };

  /** Relation filter used for "playable" items: track: { status, storageKey: { not: null } }. */
  const matchesItemTrack = (row: PlaylistTrack, where: Where = {}) => {
    if (!matchesItem(row, where)) return false;
    if (!where.track) return true;
    const parent = trackRows.find((t) => t.id === row.trackId);
    if (!parent) return false;
    if (where.track.status && parent.status !== where.track.status)
      return false;
    if (where.track.storageKey?.not === null && parent.storageKey === null)
      return false;
    return true;
  };

  const playlistTrack = {
    rows: itemRows,
    findUnique: async ({
      where,
      select,
    }: {
      where: Where;
      select?: Select;
    }) => {
      const row = itemRows.find((r) => r.id === where.id);
      return row ? projectItem(row, select) : null;
    },
    create: async ({ data, select }: { data: Row; select?: Select }) => {
      if (!trackRows.some((t) => t.id === data.trackId)) {
        throw prismaError('P2003', 'Foreign key constraint violated');
      }
      const row = {
        id: randomUUID(),
        createdAt: tick(),
        ...data,
        position: -1,
      } as PlaylistTrack;
      itemRows.push(row);
      try {
        setPosition(row, data.position);
      } catch (error) {
        itemRows.pop();
        throw error;
      }
      return projectItem(row, select);
    },
    update: async ({
      where,
      data,
      select,
    }: {
      where: Where;
      data: Row;
      select?: Select;
    }) => {
      const row = itemRows.find((r) => r.id === where.id);
      if (!row) throw notFound();
      if (data.position !== undefined) setPosition(row, data.position);
      return projectItem(row, select);
    },
    updateMany: async ({ where, data }: { where: Where; data: Row }) => {
      const hit = itemRows.filter((r) => matchesItem(r, where));
      for (const row of hit) {
        const next = data.position?.increment
          ? row.position + data.position.increment
          : data.position;
        setPosition(row, next);
      }
      return { count: hit.length };
    },
    findMany: async ({
      where,
      select,
      orderBy,
    }: {
      where?: Where;
      select?: Select;
      orderBy?: Row;
    }) =>
      itemRows
        .filter((r) => matchesItemTrack(r, where))
        .sort((a, b) =>
          orderBy?.position === 'asc' ? a.position - b.position : 0,
        )
        .map((r) => projectItem(r, select)),
    count: async ({ where }: { where?: Where }) =>
      itemRows.filter((r) => matchesItem(r, where)).length,
    aggregate: async ({ where }: { where?: Where }) => {
      const hit = itemRows.filter((r) => matchesItem(r, where));
      return {
        _max: {
          position: hit.length ? Math.max(...hit.map((r) => r.position)) : null,
        },
        _count: { _all: hit.length },
      };
    },
    delete: async ({ where }: { where: Where }) => {
      const index = itemRows.findIndex((r) => r.id === where.id);
      if (index < 0) throw notFound();
      return itemRows.splice(index, 1)[0];
    },
  };

  // ---- playlists ----------------------------------------------------------------------------
  const matchesPlaylist = (row: Playlist, where: Where = {}) =>
    (!where.id || row.id === where.id) &&
    (!where.name?.contains || matchesText(row.name, where.name.contains));

  const itemsOf = (playlistId: string) =>
    itemRows
      .filter((i) => i.playlistId === playlistId)
      .sort((a, b) => a.position - b.position);

  const projectPlaylist = (row: Playlist, select: Select): Row => {
    const out = pickScalars(row, select);
    if (select?._count) {
      out._count = { items: itemsOf(row.id).length };
    }
    if (select?.items) {
      out.items = itemsOf(row.id).map((i) =>
        projectItem(i, select.items.select),
      );
    }
    return out;
  };

  const playlist = {
    rows: playlistRows,
    create: async ({ data, select }: { data: Row; select?: Select }) => {
      const now = tick();
      const row = {
        id: randomUUID(),
        description: null,
        createdById: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      } as Playlist;
      playlistRows.push(row);
      return projectPlaylist(row, select);
    },
    findUnique: async ({
      where,
      select,
    }: {
      where: Where;
      select?: Select;
    }) => {
      const row = playlistRows.find((r) => r.id === where.id);
      return row ? projectPlaylist(row, select) : null;
    },
    findMany: async ({
      where,
      select,
      skip = 0,
      take,
    }: {
      where?: Where;
      select?: Select;
      skip?: number;
      take?: number;
    }) =>
      playlistRows
        .filter((r) => matchesPlaylist(r, where))
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .slice(skip, take === undefined ? undefined : skip + take)
        .map((r) => projectPlaylist(r, select)),
    count: async ({ where }: { where?: Where }) =>
      playlistRows.filter((r) => matchesPlaylist(r, where)).length,
    update: async ({
      where,
      data,
      select,
    }: {
      where: Where;
      data: Row;
      select?: Select;
    }) => {
      const row = playlistRows.find((r) => r.id === where.id);
      if (!row) throw notFound();
      Object.assign(row, data, { updatedAt: tick() });
      return projectPlaylist(row, select);
    },
    /**
     * CASCADE: deleting a playlist deletes its items (never the tracks).
     * RESTRICT: not while a station selects it.
     */
    delete: async ({ where }: { where: Where }) => {
      const index = playlistRows.findIndex((r) => r.id === where.id);
      if (index < 0) throw notFound();
      if (stationRows.some((s) => s.activePlaylistId === where.id)) {
        throw prismaError('P2003', 'Foreign key constraint violated');
      }
      for (let i = itemRows.length - 1; i >= 0; i--) {
        if (itemRows[i].playlistId === where.id) itemRows.splice(i, 1);
      }
      return playlistRows.splice(index, 1)[0];
    },
  };

  // ---- stations -----------------------------------------------------------------------------
  const projectStation = (row: Station, select: Select): Row => {
    const out = pickScalars(row, select);
    if (select?.activePlaylist) {
      const chosen = playlistRows.find((p) => p.id === row.activePlaylistId);
      out.activePlaylist = chosen
        ? projectPlaylist(chosen, select.activePlaylist.select)
        : null;
    }
    if (select?.playback) {
      const state = playbackRows.find((p) => p.stationId === row.id);
      const wanted = select.playback.select;
      if (!state) {
        out.playback = null;
      } else {
        const projected = pickScalars(state, wanted);
        if (wanted.currentTrack) {
          const current = trackRows.find((t) => t.id === state.currentTrackId);
          projected.currentTrack = current
            ? pickScalars(current, wanted.currentTrack.select)
            : null;
        }
        out.playback = projected;
      }
    }
    return out;
  };

  const findStation = (where: Where) =>
    stationRows.find(
      (s) =>
        (where.id === undefined || s.id === where.id) &&
        (where.slug === undefined || s.slug === where.slug),
    );

  const station = {
    rows: stationRows,
    create: async ({ data, select }: { data: Row; select?: Select }) => {
      if (stationRows.some((s) => s.slug === data.slug)) {
        throw prismaError('P2002', 'Unique constraint failed on slug');
      }
      const now = tick();
      const row = {
        id: randomUUID(),
        activePlaylistId: null,
        desiredStatus: 'OFF_AIR',
        createdAt: now,
        updatedAt: now,
        ...data,
      } as Station;
      stationRows.push(row);
      return projectStation(row, select);
    },
    findUnique: async ({
      where,
      select,
    }: {
      where: Where;
      select?: Select;
    }) => {
      const row = findStation(where);
      return row ? projectStation(row, select) : null;
    },
    /** FK: activePlaylistId must reference an existing playlist. */
    update: async ({
      where,
      data,
      select,
    }: {
      where: Where;
      data: Row;
      select?: Select;
    }) => {
      const row = findStation(where);
      if (!row) throw notFound();
      if (
        data.activePlaylistId &&
        !playlistRows.some((p) => p.id === data.activePlaylistId)
      ) {
        throw prismaError('P2003', 'Foreign key constraint violated');
      }
      Object.assign(row, data, { updatedAt: tick() });
      return projectStation(row, select);
    },
    count: async ({ where }: { where?: Where }) =>
      stationRows.filter(
        (s) =>
          where?.activePlaylistId === undefined ||
          s.activePlaylistId === where.activePlaylistId,
      ).length,
  };

  const matchesPlayback = (row: StationPlayback, where: Where = {}) => {
    if (where.stationId && row.stationId !== where.stationId) return false;
    if (where.OR) {
      return where.OR.some((cond: Where) => {
        if ('startedAt' in cond && cond.startedAt === null)
          return row.startedAt === null;
        if (cond.startedAt?.lte) {
          return (
            row.startedAt !== null &&
            row.startedAt.getTime() <= cond.startedAt.lte.getTime()
          );
        }
        return false;
      });
    }
    return true;
  };

  const stationPlayback = {
    rows: playbackRows,
    update: async ({ where, data }: { where: Where; data: Row }) => {
      const row = playbackRows.find((p) => p.stationId === where.stationId);
      if (!row) throw notFound();
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Where; data: Row }) => {
      const hit = playbackRows.filter((p) => matchesPlayback(p, where));
      hit.forEach((p) => Object.assign(p, data));
      return { count: hit.length };
    },
    findUnique: async ({ where }: { where: Where }) => {
      const row = playbackRows.find((p) => p.stationId === where.stationId);
      return row ? { ...row } : null;
    },
    create: async ({ data }: { data: Row }) => {
      if (playbackRows.some((p) => p.stationId === data.stationId)) {
        throw prismaError('P2002', 'Unique constraint failed on station_id');
      }
      const row = {
        id: randomUUID(),
        currentTrackId: null,
        currentPlaylistTrackId: null,
        startedAt: null,
        startOffsetMs: 0,
        updatedAt: tick(),
        ...data,
      } as StationPlayback;
      playbackRows.push(row);
      return { ...row };
    },
  };

  // ---- transactions ---------------------------------------------------------------------------
  let queue: Promise<unknown> = Promise.resolve();
  const snapshot = () => ({
    tracks: structuredClone(trackRows),
    playlists: structuredClone(playlistRows),
    items: structuredClone(itemRows),
    stations: structuredClone(stationRows),
    playback: structuredClone(playbackRows),
  });
  const restore = (saved: ReturnType<typeof snapshot>) => {
    trackRows.splice(0, trackRows.length, ...saved.tracks);
    playlistRows.splice(0, playlistRows.length, ...saved.playlists);
    itemRows.splice(0, itemRows.length, ...saved.items);
    stationRows.splice(0, stationRows.length, ...saved.stations);
    playbackRows.splice(0, playbackRows.length, ...saved.playback);
  };

  const db = {
    track,
    playlist,
    playlistTrack,
    station,
    stationPlayback,
    $queryRaw: async () => [1],
    /** Array form: run together. Callback form: one at a time, rolled back if it throws. */
    $transaction: (arg: unknown, _options?: unknown) => {
      if (typeof arg !== 'function') {
        return Promise.all(arg as Promise<unknown>[]);
      }
      const run = async () => {
        const saved = snapshot();
        try {
          return await (arg as (tx: unknown) => Promise<unknown>)(db);
        } catch (error) {
          restore(saved);
          throw error;
        }
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
  return db;
}

export function createFakeStorage() {
  const objects = new Map<string, { sizeBytes: number; contentType: string }>();
  const state = { failUploads: false, failDeletes: false };
  return {
    objects,
    state,
    uploadFile: async (
      key: string,
      filePath: string,
      contentType: string,
      sizeBytes: number,
    ) => {
      if (state.failUploads)
        throw new StorageError('upload', 'simulated outage');
      const { size } = await stat(filePath); // the processed file must exist when uploaded
      if (size !== sizeBytes) throw new Error('size mismatch');
      objects.set(key, { sizeBytes, contentType });
    },
    deleteObject: async (key: string) => {
      if (state.failDeletes)
        throw new StorageError('delete', 'simulated outage');
      objects.delete(key);
    },
    headObject: async (key: string) => objects.get(key) ?? null,
    getPresignedGetUrl: async () => {
      throw new Error('not used in these tests');
    },
  };
}

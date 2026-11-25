import { parseAllowedOrigins } from './radio-io.adapter.js';
import { parseIcecastStatus } from './icecast-status.service.js';

const MOUNT = '/radio.mp3';
const source = (listenurl: string, listeners: unknown) => ({
  listenurl,
  listeners,
  server_name: 'x',
});

describe('parseIcecastStatus', () => {
  it('LIVE with the listener count when the mount is present (object form)', () => {
    const json = { icestats: { source: source('http://localhost:8000/radio.mp3', 3) } };
    expect(parseIcecastStatus(json, MOUNT)).toEqual({ status: 'LIVE', listeners: 3 });
  });

  it('LIVE: zero listeners is a real zero when the mount is present', () => {
    const json = { icestats: { source: source('http://localhost:8000/radio.mp3', 0) } };
    expect(parseIcecastStatus(json, MOUNT)).toEqual({ status: 'LIVE', listeners: 0 });
  });

  it('finds the mount among several sources (array form)', () => {
    const json = {
      icestats: {
        source: [
          source('http://localhost:8000/other.mp3', 9),
          source('http://localhost:8000/radio.mp3', 2),
        ],
      },
    };
    expect(parseIcecastStatus(json, MOUNT)).toEqual({ status: 'LIVE', listeners: 2 });
  });

  it('OFFLINE when Icecast answers but the mount is missing (no listeners claimed)', () => {
    expect(parseIcecastStatus({ icestats: {} }, MOUNT)).toEqual({ status: 'OFFLINE', listeners: null });
    const other = { icestats: { source: source('http://localhost:8000/other.mp3', 4) } };
    expect(parseIcecastStatus(other, MOUNT)).toEqual({ status: 'OFFLINE', listeners: null });
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['no icestats', {}],
    ['icestats not an object', { icestats: 5 }],
  ])('UNKNOWN for an unreadable document (%s)', (_name, json) => {
    expect(parseIcecastStatus(json, MOUNT)).toEqual({ status: 'UNKNOWN', listeners: null });
  });

  it.each([
    ['a missing count', undefined],
    ['a string count', '3'],
    ['a negative count', -1],
    ['a fractional count', 1.5],
  ])('UNKNOWN when the mount is present but the listener count is bad (%s)', (_name, listeners) => {
    const json = { icestats: { source: source('http://localhost:8000/radio.mp3', listeners) } };
    expect(parseIcecastStatus(json, MOUNT)).toEqual({ status: 'UNKNOWN', listeners: null });
  });

  it('ignores sources with a malformed listenurl instead of throwing', () => {
    const json = { icestats: { source: [source('not a url', 1), 5, null] } };
    expect(parseIcecastStatus(json, MOUNT)).toEqual({ status: 'OFFLINE', listeners: null });
  });
});

describe('parseAllowedOrigins', () => {
  it('defaults to the frontend origin (path and trailing slash dropped)', () => {
    expect(parseAllowedOrigins(undefined, 'http://localhost:3000/')).toEqual(['http://localhost:3000']);
    expect(parseAllowedOrigins('  ', 'http://localhost:3000')).toEqual(['http://localhost:3000']);
  });

  it('uses the configured list, normalised and de-duplicated', () => {
    expect(
      parseAllowedOrigins('http://localhost:3000, http://192.0.2.10:3000/ ,http://localhost:3000', 'http://x:1'),
    ).toEqual(['http://localhost:3000', 'http://192.0.2.10:3000']);
  });
});

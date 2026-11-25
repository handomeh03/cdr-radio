import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { StreamHealth } from './realtime.types.js';

export interface IcecastReading {
  status: StreamHealth;
  listeners: number | null;
}

const REQUEST_TIMEOUT_MS = 3_000;
/** The status document is a few hundred bytes; refuse anything absurd. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Reduces Icecast's status-json.xsl to this station's mount. `icestats.source` is absent with no
 * source, an object with one, and an array with several. Anything unexpected is UNKNOWN: a
 * document that cannot be understood must not be reported as an empty or healthy stream.
 */
export function parseIcecastStatus(
  json: unknown,
  mountPath: string,
): IcecastReading {
  const unknown: IcecastReading = { status: 'UNKNOWN', listeners: null };
  if (typeof json !== 'object' || json === null) return unknown;
  const stats = (json as { icestats?: unknown }).icestats;
  if (typeof stats !== 'object' || stats === null) return unknown;

  const raw = (stats as { source?: unknown }).source;
  const sources: unknown[] = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  for (const source of sources) {
    if (typeof source !== 'object' || source === null) continue;
    const { listenurl, listeners } = source as {
      listenurl?: unknown;
      listeners?: unknown;
    };
    if (typeof listenurl !== 'string' || !isMount(listenurl, mountPath)) continue;
    if (typeof listeners !== 'number' || !Number.isInteger(listeners) || listeners < 0) {
      return unknown;
    }
    return { status: 'LIVE', listeners };
  }
  return { status: 'OFFLINE', listeners: null };
}

function isMount(listenUrl: string, mountPath: string): boolean {
  try {
    return new URL(listenUrl).pathname === mountPath;
  } catch {
    return false;
  }
}

/**
 * Reads Icecast's public status document. The address comes from ICECAST_PUBLIC_URL (the same
 * value used for the public stream), so no new setting or credential is involved.
 */
@Injectable()
export class IcecastStatusService {
  private readonly statusUrl: string;
  private readonly mountPath: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const stream = new URL(config.get('ICECAST_PUBLIC_URL', { infer: true }));
    this.mountPath = stream.pathname;
    this.statusUrl = new URL('/status-json.xsl', stream.origin).toString();
  }

  /** One bounded read. Never throws: any failure is UNKNOWN. */
  async read(): Promise<IcecastReading> {
    try {
      const response = await fetch(this.statusUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return { status: 'UNKNOWN', listeners: null };
      const text = await response.text();
      if (text.length > MAX_BODY_BYTES) return { status: 'UNKNOWN', listeners: null };
      return parseIcecastStatus(JSON.parse(text) as unknown, this.mountPath);
    } catch {
      return { status: 'UNKNOWN', listeners: null };
    }
  }
}

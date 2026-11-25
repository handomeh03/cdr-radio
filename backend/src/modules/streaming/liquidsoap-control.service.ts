import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';

/** What Liquidsoap reports back for a control command (see streaming/liquidsoap/radio.liq). */
export interface ControlResult {
  ok: boolean;
  /** Source on air when the command ran: the playlist queue or the safety fallback. */
  source: 'playlist' | 'fallback';
  skipped?: boolean;
  flushed?: number;
  queued?: boolean;
}

/** Covers a reload that fetches + downloads the next track (Liquidsoap bounds those at 5 s + 30 s). */
const DEFAULT_TIMEOUT_MS = 40_000;

/**
 * Client for Liquidsoap's private, token-protected HTTP control interface
 * (published on 127.0.0.1 only). Never reports success unless Liquidsoap confirmed it.
 */
@Injectable()
export class LiquidsoapControlService {
  /** Per-command timeout (overridable in tests). */
  static timeoutMs = DEFAULT_TIMEOUT_MS;
  private readonly logger = new Logger(LiquidsoapControlService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const host = config.get('LIQUIDSOAP_CONTROL_HOST', { infer: true });
    const port = config.get('LIQUIDSOAP_CONTROL_PORT', { infer: true });
    this.baseUrl = `http://${host}:${port}`;
    this.token = config.get('LIQUIDSOAP_CONTROL_TOKEN', { infer: true });
  }

  /** Skips the track on air (only meaningful while the playlist queue is on air). */
  skip(): Promise<ControlResult> {
    return this.send('/control/skip');
  }

  /**
   * Drops prefetched requests so the next track is chosen from the current settings, and
   * queues it right away. With `skip`, also ends the current track so the change is immediate.
   */
  reload(options: { skip: boolean }): Promise<ControlResult> {
    return this.send(`/control/reload${options.skip ? '?skip=1' : ''}`);
  }

  private async send(path: string): Promise<ControlResult> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(LiquidsoapControlService.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'error';
      this.logger.warn(`Playout control ${path} got no reply (${reason})`);
      // A timeout is ambiguous: Liquidsoap may still have applied the command.
      if (reason === 'TimeoutError') {
        throw new GatewayTimeoutException(
          'The playout engine did not confirm in time; the change may still take effect',
        );
      }
      throw new ServiceUnavailableException(
        'The playout engine is not reachable; nothing was changed on air',
      );
    }

    const body = (await response
      .json()
      .catch(() => null)) as ControlResult | null;
    if (!response.ok || !body?.ok) {
      this.logger.warn(
        `Playout control ${path} failed (HTTP ${response.status})`,
      );
      throw new BadGatewayException('The playout engine rejected the command');
    }
    return body;
  }
}

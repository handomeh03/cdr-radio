import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * The exact origins allowed to connect: SOCKET_ALLOWED_ORIGINS (comma-separated) or, when unset,
 * the frontend's own origin. Entries are normalised (`new URL(...).origin`); wildcards are
 * rejected by env validation and would never match anyway.
 */
export function parseAllowedOrigins(
  raw: string | undefined,
  frontendUrl: string,
): string[] {
  const entries = raw?.trim() ? raw.split(',') : [frontendUrl];
  return [...new Set(entries.map((entry) => new URL(entry.trim()).origin))];
}

/**
 * Socket.IO server options for the public read-only radio namespace.
 *
 * CORS headers only protect polling requests; a WebSocket upgrade ignores CORS, so the Origin
 * header is also checked in `allowRequest`. A request without an Origin is not a browser page
 * (curl, tests, other servers): the data is public and read-only, so it is let through.
 */
export class RadioIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: readonly string[],
  ) {
    super(app);
  }

  override createIOServer(port: number | undefined, options?: ServerOptions) {
    const allowed = new Set(this.allowedOrigins);
    const secured = {
      ...options,
      serveClient: false,
      // Clients never send data; this only bounds what a hostile one could make us buffer.
      maxHttpBufferSize: 1_024,
      cors: { origin: [...allowed], methods: ['GET', 'POST'], credentials: false },
      allowRequest: (
        req: { headers: { origin?: string } },
        callback: (error: string | null | undefined, success: boolean) => void,
      ) => {
        const origin = req.headers.origin;
        if (origin === undefined || allowed.has(origin)) return callback(null, true);
        callback('Origin not allowed', false);
      },
    } as ServerOptions;
    return super.createIOServer(port, secured);
  }
}

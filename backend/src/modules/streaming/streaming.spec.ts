import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { InternalTokenGuard } from './internal-token.guard.js';
import { LiquidsoapControlService } from './liquidsoap-control.service.js';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<
    never,
    true
  >;

const TOKEN = 'internal-token-0123456789-abcdefghijklmnop';
const contextWith = (authorization?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  }) as unknown as ExecutionContext;

describe('InternalTokenGuard', () => {
  const guard = new InternalTokenGuard(
    config({ STREAM_INTERNAL_TOKEN: TOKEN }),
  );

  it('accepts the exact bearer token', () => {
    expect(guard.canActivate(contextWith(`Bearer ${TOKEN}`))).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['wrong token', 'Bearer not-the-token'],
    ['token with extra characters', `Bearer ${TOKEN}x`],
    ['other scheme', `Basic ${TOKEN}`],
    ['empty bearer', 'Bearer '],
  ])('rejects %s with 401', (_label, header) => {
    expect(() => guard.canActivate(contextWith(header))).toThrow(
      UnauthorizedException,
    );
  });
});

describe('LiquidsoapControlService (against a local stand-in server)', () => {
  let server: Server;
  let port: number;
  let reply: (
    path: string,
    auth: string | undefined,
  ) => { status: number; body: string; delayMs?: number };
  const seen: Array<{ path: string; auth?: string; method?: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({
        path: req.url ?? '',
        auth: req.headers.authorization,
        method: req.method,
      });
      const {
        status,
        body,
        delayMs = 0,
      } = reply(req.url ?? '', req.headers.authorization);
      setTimeout(
        () =>
          res
            .writeHead(status, { 'content-type': 'application/json' })
            .end(body),
        delayMs,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => {
    seen.length = 0;
  });

  const client = (overridePort = port) =>
    new LiquidsoapControlService(
      config({
        LIQUIDSOAP_CONTROL_HOST: '127.0.0.1',
        LIQUIDSOAP_CONTROL_PORT: overridePort,
        LIQUIDSOAP_CONTROL_TOKEN: 'control-token-xyz',
      }),
    );

  it('sends authenticated POSTs and returns what Liquidsoap confirmed', async () => {
    reply = (path) => ({
      status: 200,
      body: JSON.stringify(
        path.startsWith('/control/reload')
          ? {
              ok: true,
              source: 'playlist',
              flushed: 1,
              queued: true,
              skipped: path.endsWith('skip=1'),
            }
          : { ok: true, source: 'playlist', skipped: true },
      ),
    });

    expect(await client().skip()).toMatchObject({ skipped: true });
    expect(await client().reload({ skip: false })).toMatchObject({
      flushed: 1,
      skipped: false,
    });
    expect(await client().reload({ skip: true })).toMatchObject({
      skipped: true,
    });
    expect(seen.map((r) => r.path)).toEqual([
      '/control/skip',
      '/control/reload',
      '/control/reload?skip=1',
    ]);
    expect(
      seen.every(
        (r) => r.method === 'POST' && r.auth === 'Bearer control-token-xyz',
      ),
    ).toBe(true);
  });

  it('never reports success when Liquidsoap refuses (401) or answers ok:false', async () => {
    reply = () => ({
      status: 401,
      body: JSON.stringify({ ok: false, error: 'unauthorized' }),
    });
    await expect(client().skip()).rejects.toBeInstanceOf(BadGatewayException);

    reply = () => ({ status: 200, body: JSON.stringify({ ok: false }) });
    await expect(client().skip()).rejects.toBeInstanceOf(BadGatewayException);

    reply = () => ({ status: 200, body: 'not json' });
    await expect(client().skip()).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('LIQUIDSOAP_CONTROL_URL replaces host/port, keeps a path prefix, and still sends the token', async () => {
    reply = () => ({ status: 200, body: JSON.stringify({ ok: true, source: 'fallback', skipped: false }) });
    const viaUrl = new LiquidsoapControlService(
      config({
        // The host/port pair points nowhere: the URL must win.
        LIQUIDSOAP_CONTROL_HOST: '203.0.113.1',
        LIQUIDSOAP_CONTROL_PORT: 9,
        LIQUIDSOAP_CONTROL_URL: `http://127.0.0.1:${port}/gateway/`,
        LIQUIDSOAP_CONTROL_TOKEN: 'control-token-xyz',
      }),
    );
    await viaUrl.skip();
    await viaUrl.reload({ skip: true });
    expect(seen.map((r) => r.path)).toEqual(['/gateway/control/skip', '/gateway/control/reload?skip=1']);
    expect(seen.every((r) => r.method === 'POST' && r.auth === 'Bearer control-token-xyz')).toBe(true);
  });

  it('does not follow a redirect (the token must not be sent elsewhere): 503', async () => {
    const target = createServer((_req, res) => res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' }).end());
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const redirectPort = (target.address() as AddressInfo).port;
    await expect(client(redirectPort).skip()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await new Promise((resolve) => target.close(resolve));
  });

  it('an https URL that does not speak TLS fails safely as 503, without leaking the URL or token', async () => {
    const service = new LiquidsoapControlService(
      config({
        LIQUIDSOAP_CONTROL_URL: `https://127.0.0.1:${port}`,
        LIQUIDSOAP_CONTROL_TOKEN: 'control-token-xyz',
      }),
    );
    const error = await service.skip().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toMatch(/127\.0\.0\.1|control-token|https/);
  });

  it('503 when the control interface is unreachable', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    await expect(client(deadPort).skip()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('LiquidsoapControlService timeouts', () => {
  it('reports a missing reply as 504 "may still take effect", not as "nothing changed"', async () => {
    const slow = createServer((_req, res) => {
      setTimeout(() => res.end('{"ok":true}'), 1_000);
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    const port = (slow.address() as AddressInfo).port;
    const previous = LiquidsoapControlService.timeoutMs;
    LiquidsoapControlService.timeoutMs = 100;
    try {
      const error = await new LiquidsoapControlService(
        config({
          LIQUIDSOAP_CONTROL_HOST: '127.0.0.1',
          LIQUIDSOAP_CONTROL_PORT: port,
          LIQUIDSOAP_CONTROL_TOKEN: 't',
        }),
      )
        .reload({ skip: false })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GatewayTimeoutException);
      expect((error as Error).message).toMatch(/may still take effect/);
    } finally {
      LiquidsoapControlService.timeoutMs = previous;
      slow.closeAllConnections();
      await new Promise((resolve) => slow.close(resolve));
    }
  });
});

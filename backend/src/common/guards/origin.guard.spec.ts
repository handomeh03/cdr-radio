import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { OriginGuard } from './origin.guard.js';

const guard = new OriginGuard({
  get: () => 'http://localhost:3000',
} as unknown as ConfigService<never, true>);

const ctx = (method: string, headers: Record<string, string> = {}) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
  }) as unknown as ExecutionContext;

describe('OriginGuard (CSRF)', () => {
  it('lets safe methods through regardless of Origin', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(
        guard.canActivate(ctx(method, { origin: 'https://evil.example' })),
      ).toBe(true);
    }
  });

  it('allows state-changing requests from the frontend origin (also via the /api rewrite)', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        guard.canActivate(ctx(method, { origin: 'http://localhost:3000' })),
      ).toBe(true);
    }
  });

  it('rejects state-changing requests from any other origin, including "null"', () => {
    for (const origin of [
      'https://evil.example',
      'http://localhost:3001',
      'null',
    ]) {
      expect(() => guard.canActivate(ctx('POST', { origin }))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('rejects a browser-reported cross-site request without Origin', () => {
    expect(() =>
      guard.canActivate(ctx('DELETE', { 'sec-fetch-site': 'cross-site' })),
    ).toThrow(ForbiddenException);
  });

  it('allows non-browser clients without Origin (they still need their own auth)', () => {
    expect(guard.canActivate(ctx('POST'))).toBe(true);
    expect(
      guard.canActivate(ctx('POST', { 'sec-fetch-site': 'same-origin' })),
    ).toBe(true);
  });
});

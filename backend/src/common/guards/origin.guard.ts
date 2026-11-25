import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated, state-changing requests (on top of SameSite=Lax).
 * Browsers send `Origin` on POST/PUT/PATCH/DELETE, so a foreign Origin, or a browser-reported
 * cross-site request (`Sec-Fetch-Site: cross-site`), is rejected. The Next.js /api rewrite
 * forwards the frontend's Origin, which equals FRONTEND_URL. Requests without either header are
 * not from a browser page (e.g. curl, Liquidsoap) and still need their normal authentication.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.allowedOrigin = new URL(
      config.get('FRONTEND_URL', { infer: true }),
    ).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (origin !== this.allowedOrigin) throw rejected();
      return true;
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') throw rejected();
    return true;
  }
}

const rejected = () => new ForbiddenException('Cross-origin request rejected');

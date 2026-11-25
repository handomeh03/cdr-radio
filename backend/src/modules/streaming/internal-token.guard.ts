import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Protects service-to-service routes called by Liquidsoap. Requires
 * `Authorization: Bearer <STREAM_INTERNAL_TOKEN>`; admin browser sessions are not accepted.
 * Routes using it are marked @Public() so the JWT guard does not apply.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.expected = digest(
      config.get('STREAM_INTERNAL_TOKEN', { infer: true }),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    // Compare fixed-length digests so the check takes the same time for any input.
    if (!token || !timingSafeEqual(digest(token), this.expected)) {
      throw new UnauthorizedException('Invalid internal token');
    }
    return true;
  }
}

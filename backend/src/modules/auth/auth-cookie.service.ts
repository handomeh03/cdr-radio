import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import {
  NodeEnvironment,
  type EnvironmentVariables,
} from '../../config/env.validation.js';

/**
 * Owns the auth cookie so set and clear always use identical options.
 * HttpOnly (no JS access), SameSite=Lax (not sent on cross-site POSTs), host-only (no Domain).
 */
@Injectable()
export class AuthCookieService {
  readonly name: string;
  private readonly options: CookieOptions;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.name = config.get('AUTH_COOKIE_NAME', { infer: true });
    const secure =
      config.get('AUTH_COOKIE_SECURE', { infer: true }) ??
      config.get('NODE_ENV', { infer: true }) === NodeEnvironment.Production;
    this.options = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  }

  set(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.name, token, { ...this.options, expires: expiresAt });
  }

  clear(res: Response): void {
    res.clearCookie(this.name, this.options);
  }

  read(req: Request): string | undefined {
    const value: unknown = req.cookies?.[this.name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

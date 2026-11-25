import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import {
  JwtTokenService,
  type JwtPayload,
} from '../../../security/jwt.service.js';
import { UsersService } from '../../users/users.service.js';
import { AuthCookieService } from '../auth-cookie.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

/**
 * Global guard: every route needs a valid auth cookie unless marked @Public().
 * The user is re-loaded from the database so deleted accounts and role changes apply immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cookies: AuthCookieService,
    private readonly tokens: JwtTokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.cookies.read(request);
    if (!token) throw new UnauthorizedException('Authentication required');

    let payload: JwtPayload;
    try {
      payload = await this.tokens.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
    if (!isUUID(payload.sub))
      throw new UnauthorizedException('Invalid or expired session');

    // Database errors propagate as 500 rather than masquerading as a logout.
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid or expired session');

    request.user = user;
    return true;
  }
}

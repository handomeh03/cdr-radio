import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { SafeUser } from '../users/users.service.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';

/** Login attempts allowed per client IP per minute. */
export const LOGIN_RATE_LIMIT = { limit: 5, ttl: 60_000 };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
  ) {}

  @Public()
  @Throttle({ default: LOGIN_RATE_LIMIT })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SafeUser; expiresAt: string }> {
    const { user, token, expiresAt } = await this.auth.login(
      dto.email,
      dto.password,
    );
    this.cookies.set(res, token, expiresAt);
    return { user, expiresAt: expiresAt.toISOString() };
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: SafeUser): { user: SafeUser } {
    return { user };
  }

  /** Public so an expired session can still clear its cookie. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    this.cookies.clear(res);
  }
}

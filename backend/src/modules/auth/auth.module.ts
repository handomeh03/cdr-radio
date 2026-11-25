import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SecurityModule } from '../../security/security.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

@Module({
  imports: [SecurityModule, UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}

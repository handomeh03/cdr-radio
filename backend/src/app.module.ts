import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { OriginGuard } from './common/guards/origin.guard.js';
import { validateEnv } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PlaybackModule } from './modules/playback/playback.module.js';
import { PlaylistsModule } from './modules/playlists/playlists.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { StationsModule } from './modules/stations/stations.module.js';
import { TracksModule } from './modules/tracks/tracks.module.js';
import { UsersModule } from './modules/users/users.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // Default per-IP limit for every route; stricter limits are set per route (e.g. login).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    TracksModule,
    PlaylistsModule,
    StationsModule,
    PlaybackModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // CSRF: reject cross-origin state-changing requests before anything else runs.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

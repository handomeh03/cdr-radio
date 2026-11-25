import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { HashService } from './hash.service.js';
import { JwtTokenService } from './jwt.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_EXPIRES_IN', {
            infer: true,
          }) as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [HashService, JwtTokenService],
  exports: [HashService, JwtTokenService],
})
export class SecurityModule {}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { EnvironmentVariables } from '../config/env.validation.js';

/** The single Prisma client for the app (Prisma 7 + node-postgres driver adapter). */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      // With driver adapters $connect() is lazy, so run a real round trip to verify.
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Connected to PostgreSQL');
    } catch (error) {
      // Keep the API up so /health can report the outage; never log the connection string.
      const reason = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `Could not connect to PostgreSQL at startup (${reason})`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

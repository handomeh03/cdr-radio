import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Imported once in AppModule; PrismaService is injectable everywhere. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}

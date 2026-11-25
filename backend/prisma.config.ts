import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env by itself; load it for CLI commands.
// On hosted environments the variables come from the platform instead.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  // Folder searched recursively for *.prisma files (schema.prisma + models/).
  schema: 'prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Only needed by commands that talk to the database; `prisma generate` works without it.
  datasource: { url: process.env.DATABASE_URL },
});

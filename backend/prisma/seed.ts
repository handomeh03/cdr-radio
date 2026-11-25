/**
 * Idempotent, create-only seed:
 *  1. the initial ADMIN from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (an existing user, and its
 *     password, are never touched);
 *  2. the "main" station and its empty playback row (existing settings are never overwritten).
 * Run with `npm run db:seed` (prisma db seed) only after the migrations have been applied.
 */
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { PrismaClient, Role } from '../src/generated/prisma/client.js';
import { seedStation } from './seed-station.js';

if (existsSync('.env')) process.loadEnvFile('.env');

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const email = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SEED_ADMIN_PASSWORD');
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SEED_ADMIN_EMAIL is not a valid email address');
  }
  if (password.length < 12 || password.includes('CHANGE_ME')) {
    throw new Error(
      'SEED_ADMIN_PASSWORD must be at least 12 characters and not a placeholder',
    );
  }
  if (!Number.isInteger(saltRounds) || saltRounds < 10 || saltRounds > 14) {
    throw new Error('BCRYPT_SALT_ROUNDS must be an integer between 10 and 14');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
  });

  try {
    await seedAdmin(prisma, email, password, saltRounds);
    console.log(
      (await seedStation(prisma)) === 'created'
        ? 'Seed: station "main" created (OFF_AIR, no playlist).'
        : 'Seed: station "main" already exists; settings left unchanged.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function seedAdmin(
  prisma: PrismaClient,
  email: string,
  password: string,
  saltRounds: number,
): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });
  if (existing) {
    console.log(
      `Seed: admin user already exists (role ${existing.role}); left unchanged.`,
    );
    return;
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, saltRounds),
      role: Role.ADMIN,
    },
  });
  console.log('Seed: admin user created.');
}

main().catch((error: unknown) => {
  // Message only: never print the environment or connection string.
  console.error(
    `Seed failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});

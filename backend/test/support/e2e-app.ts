import { randomUUID } from 'node:crypto';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import type request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import type { User } from '../../src/generated/prisma/client.js';
import { Role } from '../../src/generated/prisma/enums.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { JwtTokenService } from '../../src/security/jwt.service.js';
import { LiquidsoapControlService } from '../../src/modules/streaming/liquidsoap-control.service.js';
import { R2StorageService } from '../../src/storage/r2-storage.service.js';

export const ADMIN = {
  email: 'admin@example.test',
  password: 'admin-password-123',
};
export const OPERATOR = {
  email: 'operator@example.test',
  password: 'operator-password-123',
};

export async function makeUsers(): Promise<User[]> {
  const make = async (
    email: string,
    password: string,
    role: Role,
  ): Promise<User> => ({
    id: randomUUID(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return [
    await make(ADMIN.email, ADMIN.password, Role.ADMIN),
    await make(OPERATOR.email, OPERATOR.password, Role.OPERATOR),
  ];
}

export interface TestAppOptions {
  users: User[];
  /** Replaces PrismaService (default: health check only, no tracks). */
  prisma?: object;
  /** Replaces R2StorageService (default: throws if used). */
  storage?: object;
  controllers?: Type[];
  /** Replaces the Liquidsoap control client (default: the real one, pointed at a closed port). */
  control?: object;
}

/** Real AppModule + configureApp with in-memory users; no PostgreSQL or R2. */
export async function createTestApp(
  options: TestAppOptions,
): Promise<NestExpressApplication> {
  const { users } = options;
  const fakeUsers = {
    findByEmailWithPassword: async (email: string) =>
      users.find((u) => u.email === UsersService.normalizeEmail(email)) ?? null,
    findById: async (id: string) => {
      const user = users.find((u) => u.id === id);
      return user ? UsersService.toSafeUser(user) : null;
    },
  };
  const notExpected = () => Promise.reject(new Error('storage not expected'));
  const unusedStorage = {
    uploadFile: notExpected,
    deleteObject: notExpected,
    headObject: notExpected,
    getPresignedGetUrl: notExpected,
  };

  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(PrismaService)
    .useValue(
      options.prisma ?? {
        $queryRaw: async () => [1],
        track: { updateMany: async () => ({ count: 0 }) },
      },
    )
    .overrideProvider(UsersService)
    .useValue(fakeUsers)
    .overrideProvider(R2StorageService)
    .useValue(options.storage ?? unusedStorage);
  if (options.control) {
    builder = builder
      .overrideProvider(LiquidsoapControlService)
      .useValue(options.control);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: ['error'],
  });
  configureApp(app);
  await app.init();
  return app;
}

/** "cdr_auth=<jwt>; ..." from a Set-Cookie header. */
export function authCookie(res: request.Response): string {
  const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = header.find((c) => c.startsWith('cdr_auth='));
  if (!cookie) throw new Error('no auth cookie set');
  return cookie;
}

/**
 * A session cookie signed by the app's own JwtTokenService, for tests that need a
 * logged-in user without spending one of the 5 login attempts per minute.
 */
export async function sessionFor(
  app: NestExpressApplication,
  users: User[],
  email: string,
) {
  const user = users.find((u) => u.email === email);
  if (!user) throw new Error(`no test user ${email}`);
  const { token } = await app
    .get(JwtTokenService, { strict: false })
    .sign({ sub: user.id, role: user.role });
  return `cdr_auth=${token}`;
}

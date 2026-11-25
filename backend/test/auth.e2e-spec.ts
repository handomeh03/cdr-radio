/**
 * Auth over HTTP with the real AppModule (guards, cookies, CORS, throttling),
 * but in-memory users instead of PostgreSQL. No database is touched.
 */
import './support/e2e-env.js'; // must stay first: sets env before AppModule loads
import { randomBytes } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { User } from '../src/generated/prisma/client.js';
import { Role } from '../src/generated/prisma/enums.js';
import { Roles } from '../src/modules/auth/decorators/roles.decorator.js';
import {
  ADMIN,
  OPERATOR,
  authCookie,
  createTestApp,
  makeUsers,
  sessionFor,
} from './support/e2e-app.js';

@Controller('test-probe')
class RoleProbeController {
  @Get('any-user')
  anyUser() {
    return { ok: true };
  }

  @Roles(Role.ADMIN)
  @Get('admin-only')
  adminOnly() {
    return { ok: true };
  }
}

const createApp = (users: User[]) =>
  createTestApp({ users, controllers: [RoleProbeController] });

async function loginAs(app: NestExpressApplication, creds: typeof ADMIN) {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send(creds)
    .expect(200);
  return authCookie(res).split(';')[0];
}

describe('Auth (e2e, in-memory users)', () => {
  let app: NestExpressApplication;
  let users: User[];

  beforeAll(async () => {
    users = await makeUsers();
    app = await createApp(users);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps /health public and protects everything else by default', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer()).get('/test-probe/any-user').expect(401);
  });

  it('rejects malformed login bodies with 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'not-an-email', password: '', extra: 'field' })
      .expect(400);
  });

  it('rejects a wrong password with 401 and sets no cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN.email, password: 'wrong-password' })
      .expect(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('logs in, sets a secure-by-design cookie and never returns the hash', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: '  Admin@Example.TEST ', password: ADMIN.password })
      .expect(200);

    const cookie = authCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Expires=/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.user).toMatchObject({
      email: ADMIN.email,
      role: Role.ADMIN,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('login -> me -> logout', async () => {
    const cookie = await loginAs(app, ADMIN);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.user).toMatchObject({
      email: ADMIN.email,
      role: Role.ADMIN,
    });
    expect(me.body.user).not.toHaveProperty('passwordHash');

    const out = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    const cleared = authCookie(out);
    expect(cleared).toMatch(/^cdr_auth=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/SameSite=Lax/i);
  });

  it('logout works without a session (expired cookie cleanup)', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(204);
  });

  it('rejects tampered, garbage and deleted-user tokens with 401', async () => {
    const cookie = await sessionFor(app, users, OPERATOR.email);
    // Sanity check: the untampered cookie is accepted.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    const tampered =
      cookie.slice(0, -3) + (cookie.endsWith('aaa') ? 'bbb' : 'aaa');

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', tampered)
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', 'cdr_auth=not.a.jwt')
      .expect(401);

    const removed = users.splice(
      users.findIndex((u) => u.email === OPERATOR.email),
      1,
    );
    try {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie)
        .expect(401);
    } finally {
      users.push(...removed);
    }
  });

  it('enforces roles: ADMIN 200, OPERATOR 403 on an ADMIN-only route', async () => {
    const admin = await sessionFor(app, users, ADMIN.email);
    const operator = await sessionFor(app, users, OPERATOR.email);
    const server = app.getHttpServer();

    await request(server)
      .get('/test-probe/admin-only')
      .set('Cookie', admin)
      .expect(200);
    await request(server)
      .get('/test-probe/admin-only')
      .set('Cookie', operator)
      .expect(403);
    await request(server)
      .get('/test-probe/any-user')
      .set('Cookie', operator)
      .expect(200);
  });

  it('allows CORS with credentials only for FRONTEND_URL', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).not.toBe(
      'https://evil.example',
    );
  });

  it('does not expose the X-Powered-By header', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('Login rate limiting (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp(await makeUsers());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after 5 login attempts per minute from one IP', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: ADMIN.email,
          password: `wrong-${randomBytes(4).toString('hex')}`,
        });

    for (let i = 0; i < 5; i++) {
      await attempt().expect(401);
    }
    await attempt().expect(429);
  });
});

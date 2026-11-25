import { JwtService } from '@nestjs/jwt';
import { Role } from '../generated/prisma/enums.js';
import { JwtTokenService } from './jwt.service.js';

const SECRET = 'test-secret-'.padEnd(48, 'x');
const USER_ID = '6f1c1f0e-5d5a-4f63-9a51-2a9b5c0e7a10';

function makeService(secret = SECRET) {
  return new JwtTokenService(
    new JwtService({
      secret,
      signOptions: { algorithm: 'HS256', expiresIn: '15m' },
      verifyOptions: { algorithms: ['HS256'] },
    }),
  );
}

describe('JwtTokenService', () => {
  const service = makeService();

  it('signs a token that verifies back to the same claims, with its expiry', async () => {
    const before = Date.now();
    const { token, expiresAt } = await service.sign({
      sub: USER_ID,
      role: Role.ADMIN,
    });

    await expect(service.verify(token)).resolves.toEqual({
      sub: USER_ID,
      role: Role.ADMIN,
    });
    const lifetimeMs = expiresAt.getTime() - before;
    expect(lifetimeMs).toBeGreaterThan(14 * 60_000);
    expect(lifetimeMs).toBeLessThanOrEqual(15 * 60_000 + 1_000);
  });

  it('rejects a token signed with another secret', async () => {
    const { token } = await makeService('other-secret-'.padEnd(48, 'y')).sign({
      sub: USER_ID,
      role: Role.ADMIN,
    });
    await expect(service.verify(token)).rejects.toThrow();
  });

  it('rejects a tampered payload (e.g. role escalation)', async () => {
    const { token } = await service.sign({ sub: USER_ID, role: Role.OPERATOR });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: USER_ID, role: Role.ADMIN }),
    ).toString('base64url');
    await expect(
      service.verify(`${header}.${forged}.${signature}`),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const raw = new JwtService({ secret: SECRET });
    const expired = await raw.signAsync({
      sub: USER_ID,
      role: Role.ADMIN,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    await expect(service.verify(expired)).rejects.toThrow(/expired/);
  });

  it('rejects an unsigned (alg "none") token', async () => {
    const encode = (part: object) =>
      Buffer.from(JSON.stringify(part)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: USER_ID, role: Role.ADMIN })}.`;
    await expect(service.verify(unsigned)).rejects.toThrow();
  });
});

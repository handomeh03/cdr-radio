import { UnauthorizedException } from '@nestjs/common';
import type { HashService } from '../../security/hash.service.js';
import type { JwtTokenService } from '../../security/jwt.service.js';
import { Role } from '../../generated/prisma/enums.js';
import type { User } from '../../generated/prisma/client.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

const storedUser: User = {
  id: '6f1c1f0e-5d5a-4f63-9a51-2a9b5c0e7a10',
  email: 'admin@example.test',
  passwordHash: '$2b$10$stored-hash',
  role: Role.ADMIN,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  const users = { findByEmailWithPassword: vi.fn() };
  const hash = { hash: vi.fn(), verify: vi.fn() };
  const tokens = { sign: vi.fn() };
  let service: AuthService;

  beforeEach(async () => {
    vi.resetAllMocks();
    hash.hash.mockResolvedValue('$2b$10$dummy-hash');
    tokens.sign.mockResolvedValue({
      token: 'signed.jwt.token',
      expiresAt: new Date(0),
    });
    service = new AuthService(
      users as unknown as UsersService,
      hash as unknown as HashService,
      tokens as unknown as JwtTokenService,
    );
    await service.onModuleInit();
  });

  it('returns a token and the user without the password hash on valid credentials', async () => {
    users.findByEmailWithPassword.mockResolvedValue(storedUser);
    hash.verify.mockResolvedValue(true);

    const result = await service.login('admin@example.test', 'right-password');

    expect(tokens.sign).toHaveBeenCalledWith({
      sub: storedUser.id,
      role: Role.ADMIN,
    });
    expect(result.token).toBe('signed.jwt.token');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).toMatchObject({
      id: storedUser.id,
      email: storedUser.email,
    });
  });

  it('rejects a wrong password with a generic 401', async () => {
    users.findByEmailWithPassword.mockResolvedValue(storedUser);
    hash.verify.mockResolvedValue(false);

    await expect(service.login('admin@example.test', 'wrong')).rejects.toThrow(
      new UnauthorizedException('Invalid email or password'),
    );
    expect(tokens.sign).not.toHaveBeenCalled();
  });

  it('rejects an unknown email with the same 401 and still runs a bcrypt comparison', async () => {
    users.findByEmailWithPassword.mockResolvedValue(null);
    hash.verify.mockResolvedValue(false);

    await expect(
      service.login('nobody@example.test', 'whatever'),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    expect(hash.verify).toHaveBeenCalledWith('whatever', '$2b$10$dummy-hash');
    expect(tokens.sign).not.toHaveBeenCalled();
  });
});

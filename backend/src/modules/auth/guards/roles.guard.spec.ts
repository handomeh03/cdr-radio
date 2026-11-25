import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../../generated/prisma/enums.js';
import type { SafeUser } from '../../users/users.service.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(user: SafeUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const user = (role: Role): SafeUser => ({
  id: '6f1c1f0e-5d5a-4f63-9a51-2a9b5c0e7a10',
  email: 'someone@example.test',
  role,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const requireRoles = (roles: Role[] | undefined) =>
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  afterEach(() => vi.restoreAllMocks());

  it('allows routes without @Roles()', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextFor(user(Role.OPERATOR)))).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    requireRoles([Role.ADMIN]);
    expect(guard.canActivate(contextFor(user(Role.ADMIN)))).toBe(true);
  });

  it('allows any of several listed roles', () => {
    requireRoles([Role.ADMIN, Role.OPERATOR]);
    expect(guard.canActivate(contextFor(user(Role.OPERATOR)))).toBe(true);
  });

  it('forbids a user whose role is not listed', () => {
    requireRoles([Role.ADMIN]);
    expect(() => guard.canActivate(contextFor(user(Role.OPERATOR)))).toThrow(
      ForbiddenException,
    );
  });

  it('forbids when no user is attached', () => {
    requireRoles([Role.ADMIN]);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});

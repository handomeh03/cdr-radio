import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/enums.js';

export const ROLES_KEY = 'auth:roles';

/** Restricts a route to the given roles (checked by RolesGuard after authentication). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

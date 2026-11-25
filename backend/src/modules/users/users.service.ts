import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { User } from '../../generated/prisma/client.js';

/** A user as it may leave the API: never includes the password hash. */
export type SafeUser = Omit<User, 'passwordHash'>;

const safeUserSelect = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Normalised form used for storage and lookups. */
  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Includes the hash: only for credential checks inside AuthService. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: UsersService.normalizeEmail(email) },
    });
  }

  findById(id: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    });
  }

  static toSafeUser({ passwordHash: _passwordHash, ...user }: User): SafeUser {
    return user;
  }
}

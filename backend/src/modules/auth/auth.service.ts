import { randomUUID } from 'node:crypto';
import {
  Injectable,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { HashService } from '../../security/hash.service.js';
import { JwtTokenService } from '../../security/jwt.service.js';
import { UsersService, type SafeUser } from '../users/users.service.js';

export interface LoginResult {
  user: SafeUser;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Compared against when the email is unknown, so both cases take the same time. */
  private dummyHash = '';

  constructor(
    private readonly users: UsersService,
    private readonly hash: HashService,
    private readonly tokens: JwtTokenService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash.hash(randomUUID());
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmailWithPassword(email);
    const passwordMatches = await this.hash.verify(
      password,
      user?.passwordHash ?? this.dummyHash,
    );

    if (!user || !passwordMatches) {
      // Same message for unknown email and wrong password (no account enumeration).
      throw new UnauthorizedException('Invalid email or password');
    }

    const { token, expiresAt } = await this.tokens.sign({
      sub: user.id,
      role: user.role,
    });
    return { user: UsersService.toSafeUser(user), token, expiresAt };
  }
}

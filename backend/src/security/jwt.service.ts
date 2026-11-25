import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '../generated/prisma/enums.js';

/** Claims carried by the auth token. The user is re-loaded from the DB on every request. */
export interface JwtPayload {
  sub: string;
  role: Role;
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

/** Thin wrapper over @nestjs/jwt so token rules live in one place (HS256, secret/expiry from env). */
@Injectable()
export class JwtTokenService {
  constructor(private readonly jwt: JwtService) {}

  async sign(payload: JwtPayload): Promise<SignedToken> {
    const token = await this.jwt.signAsync({
      sub: payload.sub,
      role: payload.role,
    });
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /** Throws if the token is malformed, tampered with, or expired. */
  async verify(token: string): Promise<JwtPayload> {
    const { sub, role } = await this.jwt.verifyAsync<JwtPayload>(token);
    return { sub, role };
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import type { EnvironmentVariables } from '../config/env.validation.js';

/** Password hashing with bcrypt; the work factor comes from BCRYPT_SALT_ROUNDS. */
@Injectable()
export class HashService {
  private readonly saltRounds: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.saltRounds = config.get('BCRYPT_SALT_ROUNDS', { infer: true });
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.saltRounds);
  }

  /** Returns false (never throws) for a wrong password or a malformed hash. */
  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }
}

/**
 * Import this FIRST in in-memory e2e specs (before AppModule): ESM evaluates imports in order,
 * so ConfigModule validates these values. They override backend/.env; no real DB or R2 is used.
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  FRONTEND_URL: 'http://localhost:3000',
  JWT_SECRET: 'e2e-only-secret-0123456789-abcdefghijklmnop',
  JWT_EXPIRES_IN: '15m',
  BCRYPT_SALT_ROUNDS: '10',
  AUTH_COOKIE_NAME: 'cdr_auth',
  AUTH_COOKIE_SECURE: 'false',
  TRUST_PROXY_HOPS: '0',
  R2_ACCOUNT_ID: 'e2e-account',
  R2_ACCESS_KEY_ID: 'e2e-access-key',
  R2_SECRET_ACCESS_KEY: 'e2e-secret-key',
  R2_BUCKET_NAME: 'e2e-bucket',
  R2_ENDPOINT: 'https://e2e-account.r2.cloudflarestorage.com',
  // Small limit so the oversize test stays fast; a per-process dir so parallel specs don't collide.
  AUDIO_UPLOAD_MAX_MB: '1',
  FFMPEG_TIMEOUT_MS: '60000',
  STREAM_INTERNAL_TOKEN: 'e2e-internal-token-0123456789-abcdefghijklmnop',
  LIQUIDSOAP_CONTROL_TOKEN: 'e2e-control-token-0123456789-abcdefghijklmnop',
  LIQUIDSOAP_CONTROL_HOST: '127.0.0.1',
  // Nothing listens here: the real control client fails fast unless a test replaces it.
  LIQUIDSOAP_CONTROL_PORT: '9',
  AUDIO_TMP_DIR: join(tmpdir(), `cdr-radio-e2e-${process.pid}`),
});

/** The dir AudioProcessingService and Multer actually use. */
export const E2E_AUDIO_WORK_DIR = join(
  process.env.AUDIO_TMP_DIR!,
  'cdr-radio-audio',
);

// The app creates this folder on startup; remove it when the test process ends.
process.once('exit', () => {
  rmSync(process.env.AUDIO_TMP_DIR!, { recursive: true, force: true });
});

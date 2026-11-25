import { NodeEnvironment, validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:secret-value@db.example.test:5432/app',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_SECRET: 'x'.repeat(48),
    R2_ACCOUNT_ID: 'account123',
    R2_ACCESS_KEY_ID: 'access-key-id',
    R2_SECRET_ACCESS_KEY: 'r2-secret-value',
    R2_BUCKET_NAME: 'cdr-radio-tracks',
    R2_ENDPOINT: 'https://account123.r2.cloudflarestorage.com',
    STREAM_INTERNAL_TOKEN: 's'.repeat(40),
    LIQUIDSOAP_CONTROL_TOKEN: 'c'.repeat(40),
  };

  it('applies defaults and converts numbers', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env).toMatchObject({
      PORT: 4000,
      NODE_ENV: NodeEnvironment.Development,
      JWT_EXPIRES_IN: '15m',
      BCRYPT_SALT_ROUNDS: 12,
      AUTH_COOKIE_NAME: 'cdr_access_token',
      TRUST_PROXY_HOPS: 0,
      R2_PRESIGN_TTL_SECONDS: 300,
      FFMPEG_PATH: 'ffmpeg',
      FFPROBE_PATH: 'ffprobe',
      FFMPEG_TIMEOUT_MS: 120_000,
      AUDIO_UPLOAD_MAX_MB: 25,
      LIQUIDSOAP_CONTROL_HOST: '127.0.0.1',
      LIQUIDSOAP_CONTROL_PORT: 1234,
    });
    expect(env.AUTH_COOKIE_SECURE).toBeUndefined();
    expect(env.AUDIO_TMP_DIR).toBeUndefined();
  });

  it('rejects placeholder or malformed R2 settings', () => {
    expect(() =>
      validateEnv({ ...base, R2_ACCESS_KEY_ID: 'YOUR_ACCESS_KEY_ID' }),
    ).toThrow(/R2_ACCESS_KEY_ID must not be a placeholder/);
    expect(() =>
      validateEnv({ ...base, R2_ENDPOINT: 'http://insecure.example.com' }),
    ).toThrow(/R2_ENDPOINT/);
    expect(() =>
      validateEnv({ ...base, R2_BUCKET_NAME: 'Bad_Bucket' }),
    ).toThrow(/R2_BUCKET_NAME/);
  });

  it('bounds audio limits', () => {
    expect(() => validateEnv({ ...base, AUDIO_UPLOAD_MAX_MB: '0' })).toThrow(
      /AUDIO_UPLOAD_MAX_MB/,
    );
    expect(() => validateEnv({ ...base, FFMPEG_TIMEOUT_MS: '10' })).toThrow(
      /FFMPEG_TIMEOUT_MS/,
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ ...base, PORT: '99999' })).toThrow(/PORT/);
  });

  it('rejects a short or placeholder JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
    expect(() =>
      validateEnv({
        ...base,
        JWT_SECRET: 'CHANGE_ME_LONG_RANDOM_VALUE_PADDING_1234',
      }),
    ).toThrow(/JWT_SECRET must not be a placeholder/);
  });

  it('rejects a malformed JWT_EXPIRES_IN and out-of-range BCRYPT_SALT_ROUNDS', () => {
    expect(() =>
      validateEnv({ ...base, JWT_EXPIRES_IN: '15 minutes' }),
    ).toThrow(/JWT_EXPIRES_IN/);
    expect(() => validateEnv({ ...base, BCRYPT_SALT_ROUNDS: '4' })).toThrow(
      /BCRYPT_SALT_ROUNDS/,
    );
  });

  it('parses AUTH_COOKIE_SECURE strings strictly', () => {
    expect(
      validateEnv({ ...base, AUTH_COOKIE_SECURE: 'false' }).AUTH_COOKIE_SECURE,
    ).toBe(false);
    expect(
      validateEnv({ ...base, AUTH_COOKIE_SECURE: 'true' }).AUTH_COOKIE_SECURE,
    ).toBe(true);
    expect(() => validateEnv({ ...base, AUTH_COOKIE_SECURE: 'yes' })).toThrow(
      /AUTH_COOKIE_SECURE/,
    );
  });

  it('never includes values in the error message', () => {
    const run = () =>
      validateEnv({
        ...base,
        DATABASE_URL: 'mysql://user:secret-value@db.example.test/app',
        JWT_SECRET: 'tiny-secret-value',
      });
    expect(run).toThrow(
      expect.objectContaining({
        message: expect.not.stringMatching(/secret-value/),
      }),
    );
  });
});

describe('validateEnv: streaming settings and placeholders', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:pw@db.example.test:5432/app',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_SECRET: 'x'.repeat(48),
    R2_ACCOUNT_ID: 'account123',
    R2_ACCESS_KEY_ID: 'access-key-id',
    R2_SECRET_ACCESS_KEY: 'r2-secret-value',
    R2_BUCKET_NAME: 'cdr-radio-tracks',
    R2_ENDPOINT: 'https://account123.r2.cloudflarestorage.com',
    STREAM_INTERNAL_TOKEN: 's'.repeat(40),
    LIQUIDSOAP_CONTROL_TOKEN: 'c'.repeat(40),
  };

  it('requires both streaming tokens with at least 32 characters', () => {
    expect(() =>
      validateEnv({ ...base, STREAM_INTERNAL_TOKEN: undefined }),
    ).toThrow(/STREAM_INTERNAL_TOKEN/);
    expect(() =>
      validateEnv({ ...base, LIQUIDSOAP_CONTROL_TOKEN: 'short' }),
    ).toThrow(/LIQUIDSOAP_CONTROL_TOKEN/);
  });

  it('rejects the REPLACE_WITH_... placeholders from the CLAUDE.md examples', () => {
    expect(() =>
      validateEnv({
        ...base,
        STREAM_INTERNAL_TOKEN: 'REPLACE_WITH_SAME_SECRET_AS_ROOT_0000000000',
      }),
    ).toThrow(/STREAM_INTERNAL_TOKEN must not be a placeholder/);
    expect(() =>
      validateEnv({
        ...base,
        JWT_SECRET: 'REPLACE_WITH_LONG_RANDOM_SECRET_00000000000000',
      }),
    ).toThrow(/JWT_SECRET must not be a placeholder/);
  });
});

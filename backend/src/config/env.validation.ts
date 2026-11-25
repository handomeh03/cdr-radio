import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/** "true"/"1" -> true, "false"/"0" -> false, unset -> undefined, anything else stays invalid. */
const toOptionalBoolean = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}) => {
  const raw = obj[key];
  if (raw === undefined || raw === '') return undefined;
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === '0') return false;
  return raw;
};

/** Rejects the placeholder values used in the .env.example files. */
const NOT_PLACEHOLDER = /^(?!.*(CHANGE_ME|YOUR_|REPLACE_WITH))/;

export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/** Environment variables the backend needs at startup. Others are added with their features. */
export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 4000;

  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  })
  DATABASE_URL: string;

  /** Allowed CORS origin (the Next.js app). */
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  FRONTEND_URL: string;

  /**
   * Origins allowed to open the real-time (Socket.IO) connection: a comma-separated list of exact
   * origins such as http://localhost:3000,http://<LAN-IP>:3000. No wildcards. Defaults to FRONTEND_URL.
   */
  @IsOptional()
  @Matches(/^https?:\/\/[^\s,*/]+(\s*,\s*https?:\/\/[^\s,*/]+)*$/, {
    message:
      'SOCKET_ALLOWED_ORIGINS must be a comma-separated list of exact http(s) origins (no paths, no wildcards)',
  })
  SOCKET_ALLOWED_ORIGINS?: string;

  /** The public Icecast mount. Its host is also where the server reads stream status and listener count. */
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  ICECAST_PUBLIC_URL: string = 'http://localhost:8000/radio.mp3';

  /** How often the (single, shared) Icecast status read runs while real-time clients are connected. */
  @IsInt()
  @Min(2_000)
  @Max(60_000)
  STREAM_STATUS_POLL_MS: number = 5_000;

  /** Number of reverse proxies in front of the API (for real client IPs in rate limiting). */
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS: number = 0;

  @IsString()
  @MinLength(32)
  @Matches(NOT_PLACEHOLDER, {
    message: 'JWT_SECRET must not be a placeholder',
  })
  JWT_SECRET: string;

  /** Lifetime of the auth token and cookie, e.g. 15m, 8h, 1d. */
  @Matches(/^\d+[smhd]$/, {
    message: 'JWT_EXPIRES_IN must look like 900s, 15m, 8h or 1d',
  })
  JWT_EXPIRES_IN: string = '15m';

  @IsInt()
  @Min(10)
  @Max(14)
  BCRYPT_SALT_ROUNDS: number = 12;

  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'AUTH_COOKIE_NAME may contain letters, digits, _ and - only',
  })
  AUTH_COOKIE_NAME: string = 'cdr_access_token';

  /** Defaults to true when NODE_ENV=production. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  AUTH_COOKIE_SECURE?: boolean;

  // --- Cloudflare R2 (private bucket, S3-compatible API) ---
  @IsString()
  @IsNotEmpty()
  @Matches(NOT_PLACEHOLDER, {
    message: 'R2_ACCOUNT_ID must not be a placeholder',
  })
  R2_ACCOUNT_ID: string;

  @IsString()
  @IsNotEmpty()
  @Matches(NOT_PLACEHOLDER, {
    message: 'R2_ACCESS_KEY_ID must not be a placeholder',
  })
  R2_ACCESS_KEY_ID: string;

  @IsString()
  @IsNotEmpty()
  @Matches(NOT_PLACEHOLDER, {
    message: 'R2_SECRET_ACCESS_KEY must not be a placeholder',
  })
  R2_SECRET_ACCESS_KEY: string;

  @Matches(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, {
    message: 'R2_BUCKET_NAME must be a valid bucket name',
  })
  R2_BUCKET_NAME: string;

  @IsUrl({ require_tld: true, require_protocol: true, protocols: ['https'] })
  @Matches(NOT_PLACEHOLDER, {
    message: 'R2_ENDPOINT must not be a placeholder',
  })
  R2_ENDPOINT: string;

  /** Lifetime of presigned GET URLs. */
  @IsInt()
  @Min(30)
  @Max(3600)
  R2_PRESIGN_TTL_SECONDS: number = 300;

  // --- Audio processing (host-installed FFmpeg) ---
  @IsString()
  @IsNotEmpty()
  FFMPEG_PATH: string = 'ffmpeg';

  @IsString()
  @IsNotEmpty()
  FFPROBE_PATH: string = 'ffprobe';

  /** Hard limit per ffmpeg/ffprobe run; the process is killed when exceeded. */
  @IsInt()
  @Min(1_000)
  @Max(900_000)
  FFMPEG_TIMEOUT_MS: number = 120_000;

  @IsInt()
  @Min(1)
  @Max(200)
  AUDIO_UPLOAD_MAX_MB: number = 25;

  /** Parent folder for temporary audio files (default: the OS temp dir). A cdr-radio-audio subfolder is used. */
  @IsOptional()
  @IsString()
  AUDIO_TMP_DIR?: string;

  // --- Streaming integration (Liquidsoap <-> NestJS) ---
  /** Bearer token Liquidsoap sends to the internal /internal/stream/* routes. */
  @IsString()
  @MinLength(32)
  @Matches(NOT_PLACEHOLDER, {
    message: 'STREAM_INTERNAL_TOKEN must not be a placeholder',
  })
  STREAM_INTERNAL_TOKEN: string;

  /** Where NestJS reaches Liquidsoap's control interface (published on loopback only). */
  @IsString()
  @IsNotEmpty()
  LIQUIDSOAP_CONTROL_HOST: string = '127.0.0.1';

  @IsInt()
  @Min(1)
  @Max(65535)
  LIQUIDSOAP_CONTROL_PORT: number = 1234;

  /** Bearer token NestJS sends to Liquidsoap's control interface. */
  @IsString()
  @MinLength(32)
  @Matches(NOT_PLACEHOLDER, {
    message: 'LIQUIDSOAP_CONTROL_TOKEN must not be a placeholder',
  })
  LIQUIDSOAP_CONTROL_TOKEN: string;
}

/**
 * Used by ConfigModule to validate process.env at startup.
 * Error messages name the variable and the rule only, never the value.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          `- ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return env;
}

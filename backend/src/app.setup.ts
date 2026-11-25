import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { EnvironmentVariables } from './config/env.validation.js';
import {
  RadioIoAdapter,
  parseAllowedOrigins,
} from './modules/realtime/radio-io.adapter.js';

/** HTTP-level setup shared by main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication): void {
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.disable('x-powered-by');
  app.use(cookieParser());

  // Browsers reach the API through the Next.js /api rewrite (same origin), so CORS
  // only matters for direct calls from the frontend origin; credentials allow the cookie.
  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
  });

  // Real-time metadata (Socket.IO): only the configured origins may connect. Separate from the REST
  // cookie/CSRF rules above, which are unchanged.
  const socketOrigins = parseAllowedOrigins(
    config.get('SOCKET_ALLOWED_ORIGINS', { infer: true }),
    config.get('FRONTEND_URL', { infer: true }),
  );
  app.useWebSocketAdapter(new RadioIoAdapter(app, socketOrigins));

  // Behind Render / the Next.js proxy, use X-Forwarded-For for the real client IP (rate limiting).
  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) app.set('trust proxy', proxyHops);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}

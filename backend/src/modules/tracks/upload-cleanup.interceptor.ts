import { rm } from 'node:fs/promises';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { finalize, type Observable } from 'rxjs';

/**
 * Runs inside FileInterceptor: deletes Multer's temp file once the request finishes,
 * including when validation fails before the controller runs.
 */
@Injectable()
export class UploadCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { file?: { path?: string } }>();
    return next.handle().pipe(
      finalize(() => {
        const path = request.file?.path;
        if (path) void rm(path, { force: true }).catch(() => {});
      }),
    );
  }
}

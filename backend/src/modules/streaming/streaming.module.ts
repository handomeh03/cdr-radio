import { Module } from '@nestjs/common';
import { InternalTokenGuard } from './internal-token.guard.js';
import { LiquidsoapControlService } from './liquidsoap-control.service.js';

/** The boundary to Liquidsoap: its private control client and the guard for its callbacks. */
@Module({
  providers: [InternalTokenGuard, LiquidsoapControlService],
  exports: [InternalTokenGuard, LiquidsoapControlService],
})
export class StreamingModule {}

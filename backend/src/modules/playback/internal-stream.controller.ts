import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { InternalTokenGuard } from '../streaming/internal-token.guard.js';
import { NextQueryDto } from './dto/next-query.dto.js';
import { StreamEventDto } from './dto/stream-event.dto.js';
import {
  PlaybackService,
  type EventResult,
  type NextItemDto,
} from './playback.service.js';

/**
 * Service-to-service routes for Liquidsoap only. No admin session: they require the
 * STREAM_INTERNAL_TOKEN bearer token (and are not rate limited).
 */
@Public()
@SkipThrottle()
@UseGuards(InternalTokenGuard)
@Controller('internal/stream')
export class InternalStreamController {
  constructor(private readonly playback: PlaybackService) {}

  /** 200 with the next item, or 204 when nothing should play (Liquidsoap keeps the fallback). */
  @Get('next')
  async next(
    @Query() query: NextQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<NextItemDto | undefined> {
    res.setHeader('Cache-Control', 'no-store');
    const item = await this.playback.next(query.after);
    if (!item) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return item;
  }

  @Post('events')
  @HttpCode(HttpStatus.OK)
  event(@Body() event: StreamEventDto): Promise<EventResult> {
    return this.playback.recordEvent(event);
  }
}

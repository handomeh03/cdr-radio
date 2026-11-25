import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ApplyPlaybackDto } from './dto/apply-playback.dto.js';
import { PlaybackService, type ApplyResult } from './playback.service.js';

/** Live playback controls for the main station (ADMIN only, like every other change). */
@Controller('stations/main/playback')
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}

  /** Skips the current playlist track. Now-playing changes once the next start is confirmed. */
  @Post('skip')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  skip(): Promise<{ skipped: true }> {
    return this.playback.skip();
  }

  /** Changes the playlist and/or desired status and applies it to the live stream. */
  @Post('apply')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  apply(@Body() dto: ApplyPlaybackDto): Promise<ApplyResult> {
    return this.playback.apply(dto);
  }
}

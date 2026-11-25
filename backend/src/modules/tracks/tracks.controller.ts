import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '../../generated/prisma/enums.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ListTracksQueryDto } from './dto/list-tracks-query.dto.js';
import { UpdateTrackDto } from './dto/update-track.dto.js';
import { UploadTrackDto } from './dto/upload-track.dto.js';
import {
  TracksService,
  type TrackDto,
  type TrackPage,
  type UploadedAudioFile,
} from './tracks.service.js';
import { UploadCleanupInterceptor } from './upload-cleanup.interceptor.js';

/** Guards run before the file interceptor, so unauthenticated uploads are never written to disk. */
@Controller('tracks')
export class TracksController {
  constructor(private readonly tracks: TracksService) {}

  /** multipart/form-data: file (required), title, artist (optional). */
  @Post()
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'), UploadCleanupInterceptor)
  upload(
    @UploadedFile() file: UploadedAudioFile | undefined,
    @Body() dto: UploadTrackDto,
  ): Promise<TrackDto> {
    if (!file)
      throw new BadRequestException(
        'An audio file is required in the "file" field',
      );
    return this.tracks.upload(file, dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.OPERATOR)
  list(@Query() query: ListTracksQueryDto): Promise<TrackPage> {
    return this.tracks.list(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.OPERATOR)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TrackDto> {
    return this.tracks.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrackDto,
  ): Promise<TrackDto> {
    return this.tracks.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tracks.remove(id);
  }
}

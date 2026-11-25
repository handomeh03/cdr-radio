import {
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
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { SafeUser } from '../users/users.service.js';
import { AddPlaylistTrackDto } from './dto/add-playlist-track.dto.js';
import { CreatePlaylistDto } from './dto/create-playlist.dto.js';
import { ListPlaylistsQueryDto } from './dto/list-playlists-query.dto.js';
import { ReorderPlaylistDto } from './dto/reorder-playlist.dto.js';
import { UpdatePlaylistDto } from './dto/update-playlist.dto.js';
import {
  PlaylistsService,
  type PlaylistDetailDto,
  type PlaylistItemDto,
  type PlaylistPage,
  type PlaylistSummaryDto,
} from './playlists.service.js';

/** Same policy as tracks: ADMIN manages; OPERATOR can read. */
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreatePlaylistDto,
    @CurrentUser() user: SafeUser,
  ): Promise<PlaylistSummaryDto> {
    return this.playlists.create(dto, user.id);
  }

  @Get()
  @Roles(Role.ADMIN, Role.OPERATOR)
  list(@Query() query: ListPlaylistsQueryDto): Promise<PlaylistPage> {
    return this.playlists.list(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.OPERATOR)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PlaylistDetailDto> {
    return this.playlists.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlaylistDto,
  ): Promise<PlaylistSummaryDto> {
    return this.playlists.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.playlists.remove(id);
  }

  @Post(':id/tracks')
  @Roles(Role.ADMIN)
  addTrack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPlaylistTrackDto,
  ): Promise<PlaylistItemDto> {
    return this.playlists.addTrack(id, dto);
  }

  @Delete(':id/tracks/:itemId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.playlists.removeItem(id, itemId);
  }

  @Put(':id/order')
  @Roles(Role.ADMIN)
  reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderPlaylistDto,
  ): Promise<PlaylistDetailDto> {
    return this.playlists.reorder(id, dto.itemIds);
  }
}

import { Body, Controller, Get, Header, Patch } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UpdateStationDto } from './dto/update-station.dto.js';
import {
  StationsService,
  type NowPlayingDto,
  type StationDto,
} from './stations.service.js';

/** The single station is addressed as "main". Reads are public; changes are ADMIN only. */
@Controller('stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Public()
  @Get('main')
  @Header('Cache-Control', 'no-store')
  getMain(): Promise<StationDto> {
    return this.stations.getMain();
  }

  @Public()
  @Get('main/now-playing')
  @Header('Cache-Control', 'no-store')
  getNowPlaying(): Promise<NowPlayingDto> {
    return this.stations.getNowPlaying();
  }

  /** Updates requested settings only; it does not change the live audio (Step 7). */
  @Patch('main')
  @Roles(Role.ADMIN)
  update(@Body() dto: UpdateStationDto): Promise<StationDto> {
    return this.stations.update(dto);
  }
}

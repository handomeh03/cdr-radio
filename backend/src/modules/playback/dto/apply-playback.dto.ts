import { IsBoolean, IsOptional } from 'class-validator';
import { UpdateStationDto } from '../../stations/dto/update-station.dto.js';

/**
 * Optionally changes the station settings, then makes the live stream follow them.
 * By default the change takes effect at the next track boundary; `immediate` cuts the current
 * track. An empty body just re-applies the current settings.
 */
export class ApplyPlaybackDto extends UpdateStationDto {
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}

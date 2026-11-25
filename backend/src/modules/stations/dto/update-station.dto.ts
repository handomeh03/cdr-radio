import { IsEnum, IsUUID, ValidateIf } from 'class-validator';
import { BroadcastStatus } from '../../../generated/prisma/enums.js';

/** Requested settings only. Changing them does not by itself change the live audio. */
export class UpdateStationDto {
  /** An existing playlist's id; null clears the selection. Omit to leave it unchanged. */
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  activePlaylistId?: string | null;

  /** Omit to leave it unchanged (null is rejected). */
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(BroadcastStatus)
  desiredStatus?: BroadcastStatus;
}

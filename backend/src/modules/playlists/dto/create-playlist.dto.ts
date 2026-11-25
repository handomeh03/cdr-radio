import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimmedText } from '../../tracks/dto/track-fields.js';

export const PLAYLIST_NAME_MAX = 100;
export const PLAYLIST_DESCRIPTION_MAX = 500;

export class CreatePlaylistDto {
  @TrimmedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PLAYLIST_NAME_MAX)
  name: string;

  @IsOptional()
  @TrimmedText()
  @IsString()
  @MaxLength(PLAYLIST_DESCRIPTION_MAX)
  description?: string;
}

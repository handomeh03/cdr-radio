import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TrimmedText } from '../../tracks/dto/track-fields.js';
import {
  PLAYLIST_DESCRIPTION_MAX,
  PLAYLIST_NAME_MAX,
} from './create-playlist.dto.js';

export class UpdatePlaylistDto {
  @IsOptional()
  @TrimmedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PLAYLIST_NAME_MAX)
  name?: string;

  /** null or "" clears the description. */
  @TrimmedText(null)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(PLAYLIST_DESCRIPTION_MAX)
  description?: string | null;
}

import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ARTIST_MAX, TITLE_MAX, TrimmedText } from './track-fields.js';

/** Editable metadata only; status, storage and audio properties are managed by the server. */
export class UpdateTrackDto {
  @IsOptional()
  @TrimmedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX)
  title?: string;

  /** null or "" clears the artist. */
  @TrimmedText(null)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(ARTIST_MAX)
  artist?: string | null;
}

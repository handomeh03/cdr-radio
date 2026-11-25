import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ARTIST_MAX, TITLE_MAX, TrimmedText } from './track-fields.js';

/** Optional multipart text fields sent with the audio file. Missing values fall back to the file's tags. */
export class UploadTrackDto {
  @IsOptional()
  @TrimmedText()
  @IsString()
  @MaxLength(TITLE_MAX)
  title?: string;

  @IsOptional()
  @TrimmedText()
  @IsString()
  @MaxLength(ARTIST_MAX)
  artist?: string;
}

import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimmedText } from '../../tracks/dto/track-fields.js';

export class ListPlaylistsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  /** Case-insensitive match on the playlist name. */
  @IsOptional()
  @TrimmedText()
  @IsString()
  @MaxLength(100)
  search?: string;
}

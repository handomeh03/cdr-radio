import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TrackStatus } from '../../../generated/prisma/enums.js';
import { TrimmedText } from './track-fields.js';

export class ListTracksQueryDto {
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

  /** Case-insensitive match on title or artist. */
  @IsOptional()
  @TrimmedText()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(TrackStatus)
  status?: TrackStatus;
}

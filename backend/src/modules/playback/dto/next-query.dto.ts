import { IsOptional, IsUUID } from 'class-validator';
import { TrimmedText } from '../../tracks/dto/track-fields.js';

export class NextQueryDto {
  /**
   * The playlist item Liquidsoap most recently queued successfully. The next item is the one
   * after it, so retries and flushed prefetches never advance or skip anything. Omitted after a
   * Liquidsoap restart; the last confirmed item is used instead. Empty means "none".
   */
  @IsOptional()
  @TrimmedText()
  @IsUUID()
  after?: string;
}

import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const STREAM_EVENT_TYPES = [
  /** A track (or the fallback) actually started on the output. */
  'track_started',
  /** Periodic "this is what is on air" report; repairs state after a lost event. */
  'heartbeat',
  /** Liquidsoap could not resolve an issued item (logged; it moves past it after retries). */
  'request_failed',
] as const;

const isPlaylist = (event: StreamEventDto) =>
  event.source === 'playlist' || event.type === 'request_failed';

/** Sent by Liquidsoap to POST /internal/stream/events. */
export class StreamEventDto {
  @IsIn(STREAM_EVENT_TYPES)
  type: (typeof STREAM_EVENT_TYPES)[number];

  @IsIn(['playlist', 'fallback'])
  source: 'playlist' | 'fallback';

  /** Occurrence id issued by GET /internal/stream/next (one per issued request). */
  @ValidateIf(isPlaylist)
  @IsUUID()
  occurrenceId?: string;

  @ValidateIf(isPlaylist)
  @IsUUID()
  itemId?: string;

  @ValidateIf(isPlaylist)
  @IsUUID()
  trackId?: string;

  /** When the current track started on the output, in Unix seconds (Liquidsoap's clock). */
  @IsNumber()
  @Min(1_600_000_000)
  @Max(4_102_444_800)
  startedAt: number;

  /** Short diagnostic for request_failed; never shown to listeners. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  detail?: string;
}

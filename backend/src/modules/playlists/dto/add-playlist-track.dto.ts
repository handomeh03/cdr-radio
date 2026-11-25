import { IsUUID } from 'class-validator';

export class AddPlaylistTrackDto {
  /** An existing READY track. The same track may be added more than once. */
  @IsUUID()
  trackId: string;
}

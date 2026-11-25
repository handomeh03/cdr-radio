import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { MAX_PLAYLIST_ITEMS } from '../playlists.constants.js';

export class ReorderPlaylistDto {
  /** Every current playlist-item id (not track ids), exactly once, in the new playback order. */
  @IsArray()
  @ArrayMaxSize(MAX_PLAYLIST_ITEMS)
  @IsUUID('all', { each: true })
  itemIds: string[];
}

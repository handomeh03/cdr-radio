import type { Page } from "@/types/pagination";

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One slot in a playlist. The same track can occupy several slots, each with its own id. */
export interface PlaylistItem {
  /** The playlist-item id (not the track id): what add/remove/reorder operate on. */
  id: string;
  /** Zero-based, contiguous. */
  position: number;
  track: {
    id: string;
    title: string;
    artist: string | null;
    durationMs: number | null;
  };
}

export interface PlaylistDetail extends PlaylistSummary {
  totalDurationMs: number;
  /** Ordered by position. */
  items: PlaylistItem[];
}

export type PlaylistPage = Page<PlaylistSummary>;

export interface ListPlaylistsParams {
  page: number;
  pageSize: number;
  search?: string;
}

/** An empty description is omitted on create and sent as null on update (which clears it). */
export interface CreatePlaylistInput {
  name: string;
  description?: string;
}
export interface UpdatePlaylistInput {
  name: string;
  description: string | null;
}

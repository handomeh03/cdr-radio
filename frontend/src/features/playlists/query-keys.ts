import type { ListPlaylistsParams } from "./types";

/** Query keys of the playlists feature. `all` invalidates every playlist query. */
export const playlistKeys = {
  all: ["playlists"] as const,
  list: (params: ListPlaylistsParams) => ["playlists", "list", params] as const,
  detail: (id: string) => ["playlists", "detail", id] as const,
};

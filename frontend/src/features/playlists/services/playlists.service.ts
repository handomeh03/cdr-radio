import { api } from "@/config/axios";
import type {
  CreatePlaylistInput,
  ListPlaylistsParams,
  PlaylistDetail,
  PlaylistItem,
  PlaylistPage,
  PlaylistSummary,
  UpdatePlaylistInput,
} from "../types";

export const playlistsService = {
  async list(params: ListPlaylistsParams): Promise<PlaylistPage> {
    const { data } = await api.get<PlaylistPage>("/playlists", {
      params: { ...params, search: params.search || undefined },
    });
    return data;
  },

  async get(id: string): Promise<PlaylistDetail> {
    const { data } = await api.get<PlaylistDetail>(`/playlists/${id}`);
    return data;
  },

  async create(input: CreatePlaylistInput): Promise<PlaylistSummary> {
    const { data } = await api.post<PlaylistSummary>("/playlists", input);
    return data;
  },

  async update(id: string, input: UpdatePlaylistInput): Promise<PlaylistSummary> {
    const { data } = await api.patch<PlaylistSummary>(`/playlists/${id}`, input);
    return data;
  },

  /** 204. 409 while a station has this playlist selected. Tracks and audio are never deleted. */
  async remove(id: string): Promise<void> {
    await api.delete(`/playlists/${id}`);
  },

  /** Appends a READY track as a new item (the same track may be added again). */
  async addTrack(id: string, trackId: string): Promise<PlaylistItem> {
    const { data } = await api.post<PlaylistItem>(`/playlists/${id}/tracks`, { trackId });
    return data;
  },

  /** 204. The items after it move up so positions stay contiguous. */
  async removeItem(id: string, itemId: string): Promise<void> {
    await api.delete(`/playlists/${id}/tracks/${itemId}`);
  },

  /** `itemIds` must be every current playlist-item id exactly once, in the new order. */
  async reorder(id: string, itemIds: string[]): Promise<PlaylistDetail> {
    const { data } = await api.put<PlaylistDetail>(`/playlists/${id}/order`, { itemIds });
    return data;
  },
};

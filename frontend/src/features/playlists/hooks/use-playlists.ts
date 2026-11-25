"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { stationKeys } from "@/features/stations/query-keys";
import { playlistKeys } from "../query-keys";
import { playlistsService } from "../services/playlists.service";
import type { CreatePlaylistInput, ListPlaylistsParams, PlaylistDetail, UpdatePlaylistInput } from "../types";

export function usePlaylists(params: ListPlaylistsParams) {
  return useQuery({
    queryKey: playlistKeys.list(params),
    queryFn: () => playlistsService.list(params),
    placeholderData: keepPreviousData,
  });
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: playlistKeys.detail(id),
    queryFn: () => playlistsService.get(id),
  });
}

/** Playlist changes also affect what the station shows (the active playlist's name and size). */
function useInvalidatePlaylistsAndStation() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: playlistKeys.all }),
      queryClient.invalidateQueries({ queryKey: stationKeys.all }),
    ]);
}

export function useCreatePlaylist() {
  const invalidate = useInvalidatePlaylistsAndStation();
  return useMutation({
    mutationFn: (input: CreatePlaylistInput) => playlistsService.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdatePlaylist(id: string) {
  const invalidate = useInvalidatePlaylistsAndStation();
  return useMutation({
    mutationFn: (input: UpdatePlaylistInput) => playlistsService.update(id, input),
    onSuccess: invalidate,
  });
}

export function useDeletePlaylist(id: string) {
  const invalidate = useInvalidatePlaylistsAndStation();
  return useMutation({
    mutationFn: () => playlistsService.remove(id),
    onSuccess: invalidate,
  });
}

export function useAddPlaylistTrack(id: string) {
  const invalidate = useInvalidatePlaylistsAndStation();
  return useMutation({
    mutationFn: (trackId: string) => playlistsService.addTrack(id, trackId),
    onSuccess: invalidate,
  });
}

export function useRemovePlaylistItem(id: string) {
  const invalidate = useInvalidatePlaylistsAndStation();
  return useMutation({
    mutationFn: (itemId: string) => playlistsService.removeItem(id, itemId),
    onSuccess: invalidate,
  });
}

/** The backend answers with the whole playlist in its new order, so the cache is updated from that. */
export function useReorderPlaylist(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) => playlistsService.reorder(id, itemIds),
    onSuccess: (detail) => queryClient.setQueryData<PlaylistDetail>(playlistKeys.detail(id), detail),
  });
}

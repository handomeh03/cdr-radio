"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { playlistKeys } from "@/features/playlists/query-keys";
import { trackKeys } from "../query-keys";
import { tracksService } from "../services/tracks.service";
import type { ListTracksParams, UpdateTrackInput, UploadTrackInput } from "../types";

/** How often to re-check while some track is still being processed (e.g. by another admin). */
const PROCESSING_POLL_MS = 3_000;

export function useTracks(params: ListTracksParams) {
  return useQuery({
    queryKey: trackKeys.list(params),
    queryFn: () => tracksService.list(params),
    // Keep showing the previous page while the next one loads.
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((track) => track.status === "PROCESSING") ? PROCESSING_POLL_MS : false,
  });
}

/**
 * Upload with two phases the UI can tell apart: `progress` (0-100) is the browser sending the file;
 * once it reaches 100 and the mutation is still pending, the server is validating it. The server
 * answers 202 with the track in PROCESSING and converts it in the background; the track list polls
 * until it is READY or FAILED.
 */
export function useUploadTrack() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: (input: UploadTrackInput) => {
      setProgress(0);
      return tracksService.upload(input, setProgress);
    },
    // Also after a failure: the server may have recorded a FAILED track that should show up.
    onSettled: () => {
      setProgress(null);
      return queryClient.invalidateQueries({ queryKey: trackKeys.all });
    },
  });
  return { ...mutation, progress };
}

export function useUpdateTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTrackInput }) => tracksService.update(id, input),
    onSuccess: () =>
      // Playlist items show the track's title and artist.
      Promise.all([
        queryClient.invalidateQueries({ queryKey: trackKeys.all }),
        queryClient.invalidateQueries({ queryKey: playlistKeys.all }),
      ]),
  });
}

export function useDeleteTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tracksService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trackKeys.all }),
  });
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { stationKeys } from "@/features/stations/query-keys";
import { radioRealtime } from "../lib/radio-realtime";
import { playbackKeys } from "../query-keys";
import { playbackService } from "../services/playback.service";
import type { ApplyPlaybackInput, NowPlaying } from "../types";
import { useRadioRealtime } from "./use-radio-realtime";

/** REST polling, used only while real-time updates are not healthy. Paused while the tab is hidden. */
const NOW_PLAYING_POLL_MS = 4_000;

/**
 * Confirmed now-playing state. Real-time events (Socket.IO) write straight into this query's cache;
 * REST polling every few seconds is the fallback and pauses only while the socket is connected AND
 * has delivered its snapshot. Both sources feed the same cache entry, so every screen agrees.
 */
export function useNowPlaying() {
  const queryClient = useQueryClient();
  const { healthy } = useRadioRealtime();
  return useQuery({
    queryKey: playbackKeys.nowPlaying,
    queryFn: async () => {
      const sentAt = Date.now();
      const response = await playbackService.getNowPlaying();
      // A real-time event that arrived while this request was in flight is newer than the response.
      if (radioRealtime.getLastEventAt() > sentAt) {
        const newer = queryClient.getQueryData<NowPlaying>(playbackKeys.nowPlaying);
        if (newer) return newer;
      }
      return response;
    },
    refetchInterval: healthy ? false : NOW_PLAYING_POLL_MS,
    // Always fetch fresh data on mount and focus: this is live state.
    staleTime: 0,
  });
}

/**
 * Settings are saved even when the playout engine fails to confirm (the error then carries
 * `settingsSaved: true`), so station and playback state are refetched on success AND failure
 * instead of trusting the response.
 */
export function useApplyPlayback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyPlaybackInput) => playbackService.apply(input),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: stationKeys.all }),
        queryClient.invalidateQueries({ queryKey: playbackKeys.nowPlaying }),
      ]),
  });
}

export function useSkipTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => playbackService.skip(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: playbackKeys.nowPlaying }),
  });
}

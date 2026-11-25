import { api } from "@/config/axios";
import type { ApplyPlaybackInput, ApplyPlaybackResult, NowPlaying } from "../types";

/** A reload may fetch and download the next track, so allow more than the default 15 s. */
const CONTROL_TIMEOUT_MS = 60_000;

export const playbackService = {
  /** Public. Reflects confirmed playback only. */
  async getNowPlaying(): Promise<NowPlaying> {
    const { data } = await api.get<NowPlaying>("/stations/main/now-playing");
    return data;
  },

  /**
   * ADMIN. Saves the settings and makes the live stream follow them. Fails with 502/503/504 and
   * `settingsSaved: true` when the settings were stored but the playout engine did not confirm.
   */
  async apply(input: ApplyPlaybackInput): Promise<ApplyPlaybackResult> {
    const { data } = await api.post<ApplyPlaybackResult>("/stations/main/playback/apply", input, {
      timeout: CONTROL_TIMEOUT_MS,
    });
    return data;
  },

  /** ADMIN. 409 when only the standby tone is playing; 503/504 when the playout engine is unreachable. */
  async skip(): Promise<{ skipped: true }> {
    const { data } = await api.post<{ skipped: true }>("/stations/main/playback/skip", undefined, {
      timeout: CONTROL_TIMEOUT_MS,
    });
    return data;
  },
};

"use client";

import { useQuery } from "@tanstack/react-query";
import { stationKeys } from "../query-keys";
import { stationsService } from "../services/stations.service";

/** The main station's saved settings. Playback itself is in features/playback (useNowPlaying). */
export function useStation() {
  return useQuery({ queryKey: stationKeys.main, queryFn: stationsService.getMain });
}

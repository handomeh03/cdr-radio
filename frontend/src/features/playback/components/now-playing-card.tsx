"use client";

import { ErrorState } from "@/components/shared/error-state";
import { Loader } from "@/components/shared/loader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getErrorMessage } from "@/lib/api-error";
import { formatDuration, formatTime } from "@/lib/format";
import { useRadioRealtime } from "../hooks/use-radio-realtime";
import { useNowPlaying } from "../hooks/use-playback";
import { PlaybackStatusBadge } from "./playback-status-badge";

/**
 * "On air now" as confirmed by the playout engine, with honest states: nothing is shown as playing
 * unless the backend says PLAYING, and UNKNOWN is explained instead of guessed.
 */
export function NowPlayingCard() {
  const { data, isPending, isError, error, refetch } = useNowPlaying();
  const { healthy } = useRadioRealtime();

  return (
    <Card>
      <CardHeader>
        <CardTitle>On air now</CardTitle>
        <CardDescription>
          What the stream itself reports; {healthy ? "updated live." : "refreshed every few seconds."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2" aria-live="polite">
        {isPending ? (
          <Loader label="Checking the stream…" className="py-2" />
        ) : isError && !data ? (
          <ErrorState
            title="Can't read the stream status"
            message={getErrorMessage(error, "Could not load the playback status.")}
            onRetry={() => void refetch()}
            className="py-2"
          />
        ) : (
          <>
            <PlaybackStatusBadge status={data.status} />
            {data.status === "PLAYING" && data.track ? (
              <div>
                <div className="font-medium break-words">{data.track.title}</div>
                <div className="text-sm text-muted-foreground">
                  {data.track.artist ?? "Unknown artist"} · {formatDuration(data.track.durationMs)} · started{" "}
                  {formatTime(data.startedAt)}
                </div>
              </div>
            ) : data.status === "FALLBACK" ? (
              <p className="text-sm text-muted-foreground">
                The standby tone is on air (since {formatTime(data.startedAt)}). The stream is running, but no
                playlist track is playing.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No recent report from the stream, so nothing is shown as playing. It may be starting up,
                restarting, or not running.
              </p>
            )}
            {isError && (
              <p role="alert" className="text-xs text-destructive">
                Could not refresh; showing the last known status.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

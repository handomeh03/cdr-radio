"use client";

import { useNowPlaying } from "../hooks/use-playback";
import { useRadioRealtime } from "../hooks/use-radio-realtime";

/**
 * What the station reports as on air, for listeners. This is confirmed playout metadata, not proof
 * that this device is playing audio, and a metadata problem never touches the audio stream.
 */
export function RadioNowPlaying() {
  const { data, isPending, isError } = useNowPlaying();
  const { healthy } = useRadioRealtime();

  let label: string;
  let title: string;
  let detail: string | null = null;

  if (!data) {
    label = isPending ? "Checking…" : "Unavailable";
    title = isPending ? "Checking what is on air…" : "Track information is unavailable";
    detail = isPending ? null : "The audio is not affected. We will keep trying.";
  } else if (data.status === "PLAYING" && data.track) {
    label = "Now playing";
    title = data.track.title;
    detail = data.track.artist;
  } else if (data.status === "FALLBACK") {
    label = "Standby tone";
    title = data.desiredStatus === "OFF_AIR" ? "The station is off air" : "Waiting for the next track";
    detail = "A standby tone plays so the stream stays connected.";
  } else {
    label = "Unavailable";
    title = "Track information is unavailable";
    detail = "The station has not reported what is playing. The audio is not affected.";
  }

  return (
    <div className="rounded-lg bg-muted/60 px-4 py-3 text-center" aria-live="polite" aria-atomic="true">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-lg leading-snug font-semibold break-words">{title}</p>
      {detail && <p className="mt-0.5 text-sm text-muted-foreground break-words">{detail}</p>}
      <p className="mt-1 text-[11px] text-muted-foreground">{healthy ? "Track info updates live." : "Track info refreshes every few seconds."}</p>
      {isError && data && (
        <p className="mt-1 text-xs text-muted-foreground">Track information may be out of date. Retrying.</p>
      )}
    </div>
  );
}

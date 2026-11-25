"use client";

import { useEffect } from "react";
import { Loader2Icon, PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { env } from "@/config/env";
import { cn } from "@/lib/utils";
import { useLiveAudio } from "../hooks/use-live-audio";
import { useNowPlaying } from "../hooks/use-playback";
import type { ListenPhase, LiveAudioState } from "../lib/live-audio-controller";
import { RadioNowPlaying } from "./radio-now-playing";

const STATION_NAME = "CDR Central Radio";

const PHASE_LABEL: Record<ListenPhase, string> = {
  idle: "Stopped",
  connecting: "Connecting",
  buffering: "Buffering",
  playing: "Live",
  reconnecting: "Reconnecting",
  failed: "Disconnected",
  blocked: "Ready",
};

/** Dot colour is decoration; the text label next to it carries the meaning. */
const PHASE_DOT: Record<ListenPhase, string> = {
  idle: "bg-muted-foreground/50",
  connecting: "bg-amber-500 animate-pulse",
  buffering: "bg-amber-500 animate-pulse",
  playing: "bg-emerald-500",
  reconnecting: "bg-amber-500 animate-pulse",
  failed: "bg-red-500",
  blocked: "bg-muted-foreground/50",
};

function statusText(state: LiveAudioState): string {
  switch (state.phase) {
    case "idle":
      return "Press Play to listen to the live broadcast.";
    case "connecting":
      return "Connecting to the stream…";
    case "buffering":
      return "Buffering. The audio will resume as soon as data arrives.";
    case "playing":
      return "Connected. You are listening to the live broadcast.";
    case "reconnecting":
      return `The connection was lost. Reconnecting (attempt ${state.attempt} of ${state.maxAttempts})…`;
    case "failed":
      return "Could not reach the stream after several attempts.";
    case "blocked":
      return "Your browser did not start the audio. Press Play to listen.";
  }
}

/**
 * Public live player. The single <audio> element streams the Icecast mount; Play must be pressed
 * (browsers block unprompted audio), Pause closes the connection, and the next Play rejoins live.
 */
export function RadioPlayer() {
  const { state, audioRef, play, pause, setVolume, toggleMuted } = useLiveAudio(env.streamUrl);
  const nowPlaying = useNowPlaying().data;

  const listening = state.phase === "connecting" || state.phase === "buffering" || state.phase === "playing" || state.phase === "reconnecting";
  const busy = state.phase === "connecting" || state.phase === "buffering" || state.phase === "reconnecting";

  // Lock-screen / headset controls and track info on phones.
  const title = nowPlaying?.status === "PLAYING" ? (nowPlaying.track?.title ?? null) : null;
  const artist = nowPlaying?.status === "PLAYING" ? (nowPlaying.track?.artist ?? null) : null;
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !listening) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({
        title: title ?? "Live broadcast",
        artist: artist ?? STATION_NAME,
        album: STATION_NAME,
      });
      session.setActionHandler("play", play);
      session.setActionHandler("pause", pause);
    } catch {
      // Media Session is optional; playback works without it.
    }
    return () => {
      try {
        session.setActionHandler("play", null);
        session.setActionHandler("pause", null);
        session.metadata = null;
      } catch {
        // ignore
      }
    };
  }, [listening, title, artist, play, pause]);

  if (!env.streamUrl) {
    return (
      <InlineAlert tone="error">
        The live stream is not configured on this site, so there is nothing to play yet.
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-5">
      {/* No `controls`, no seek bar: a live stream has no position to scrub. */}
      <audio ref={audioRef} preload="none" className="hidden" />

      <div className="flex items-center justify-center gap-2" role="status" aria-live="polite">
        <span className={cn("size-2.5 rounded-full", PHASE_DOT[state.phase])} aria-hidden="true" />
        <span className="text-sm font-medium">{PHASE_LABEL[state.phase]}</span>
        <span className="sr-only">{statusText(state)}</span>
      </div>

      <RadioNowPlaying />

      <div className="flex flex-col items-center gap-3">
        <Button
          type="button"
          size="lg"
          className="h-14 min-w-44 gap-2 rounded-full px-8 text-base"
          aria-label={listening ? "Pause live radio" : state.phase === "failed" ? "Try again" : "Play live radio"}
          aria-busy={busy}
          onClick={listening ? pause : play}
        >
          {busy ? (
            <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
          ) : listening ? (
            <PauseIcon className="size-5" aria-hidden="true" />
          ) : (
            <PlayIcon className="size-5" aria-hidden="true" />
          )}
          {listening ? "Pause" : state.phase === "failed" ? "Try again" : "Play"}
        </Button>
        <p className="min-h-5 text-center text-sm text-muted-foreground" aria-hidden="true">
          {statusText(state)}
        </p>
      </div>

      {state.phase === "failed" && (
        <InlineAlert tone="error">
          The stream could not be reached. Check your internet connection, then press Try again. If it keeps
          failing, the station may be down.
        </InlineAlert>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={state.muted ? "Unmute" : "Mute"}
          aria-pressed={state.muted}
          onClick={toggleMuted}
        >
          {state.muted || state.volume === 0 ? (
            <VolumeXIcon aria-hidden="true" />
          ) : (
            <Volume2Icon aria-hidden="true" />
          )}
        </Button>
        {state.volumeSupported ? (
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round((state.muted ? 0 : state.volume) * 100)}
            onChange={(event) => setVolume(Number(event.target.value) / 100)}
            aria-label="Volume"
            aria-valuetext={`${Math.round((state.muted ? 0 : state.volume) * 100)} percent`}
            className="h-8 w-full cursor-pointer accent-primary"
          />
        ) : (
          <p className="text-sm text-muted-foreground">Use your device&apos;s volume buttons to change the volume.</p>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        This is a live broadcast. Pausing disconnects, and Play rejoins the live point. Devices can be a few
        seconds apart because of network and player buffering.
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { NowPlaying, PlaybackStatus } from "@/features/playback/types";

/** How long an immediate change or a skip may take before we say it is not confirmed. */
export const CONFIRM_TIMEOUT_MS = 20_000;

/** A request we sent that the stream has not yet confirmed. */
export interface PendingChange {
  kind: "apply" | "skip";
  /** next_track: waits for the current track to end. now: should show up within seconds. */
  effective: "next_track" | "now";
  /** now-playing before the request, to recognise a new confirmed start afterwards. */
  baselineStartedAt: string | null;
  baselineStatus: PlaybackStatus;
  /** False when the result is standby audio (OFF_AIR, or no playable playlist). */
  expectsTrack: boolean;
  sentAt: number;
}

export type PendingState = "waiting" | "confirmed" | "unconfirmed";

/**
 * Decides, from confirmed playback only, whether a request has taken effect. Any new confirmed
 * start (a track or the standby tone) after the request counts: comparing `startedAt` with the
 * value seen before avoids clock arithmetic between this browser and the stream host.
 */
export function pendingState(pending: PendingChange, nowPlaying: NowPlaying | undefined, nowMs: number): PendingState {
  const newStart =
    !!nowPlaying && nowPlaying.status !== "UNKNOWN" && nowPlaying.startedAt !== pending.baselineStartedAt;
  if (newStart) return "confirmed";
  // Asked for standby while the standby tone was already on air: nothing needs to change.
  if (!pending.expectsTrack && pending.baselineStatus === "FALLBACK") return "confirmed";
  if (pending.effective === "now" && nowMs - pending.sentAt > CONFIRM_TIMEOUT_MS) return "unconfirmed";
  return "waiting";
}

export function usePendingChange(nowPlaying: NowPlaying | undefined) {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Re-evaluate once the timeout for an immediate change has passed.
  useEffect(() => {
    if (!pending || pending.effective !== "now") return;
    const timer = setTimeout(() => setNowMs(Date.now()), CONFIRM_TIMEOUT_MS + 500);
    return () => clearTimeout(timer);
  }, [pending]);

  return {
    pending,
    state: pending ? pendingState(pending, nowPlaying, nowMs) : null,
    start: (change: Omit<PendingChange, "sentAt">) => setPending({ ...change, sentAt: Date.now() }),
    clear: () => setPending(null),
  };
}

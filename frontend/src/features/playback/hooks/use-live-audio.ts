"use client";

import { useState, useSyncExternalStore } from "react";
import { LiveAudioController } from "../lib/live-audio-controller";

/**
 * React binding for the live audio controller. Put `audioRef` on exactly one `<audio>` element;
 * its cleanup (unmount) pauses, unloads and removes every listener and timer.
 */
export function useLiveAudio(streamUrl: string | null) {
  const [controller] = useState(() => new LiveAudioController({ streamUrl }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return {
    state,
    audioRef: controller.attach,
    play: controller.play,
    pause: controller.pause,
    setVolume: controller.setVolume,
    toggleMuted: controller.toggleMuted,
  };
}

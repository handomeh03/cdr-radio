"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { radioRealtime } from "../lib/radio-realtime";

/**
 * Joins the shared real-time connection for as long as the calling component is mounted and
 * returns its state. Any number of callers share one connection.
 */
export function useRadioRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => radioRealtime.acquire(queryClient), [queryClient]);
  const state = useSyncExternalStore(radioRealtime.subscribe, radioRealtime.getSnapshot, radioRealtime.getServerSnapshot);
  return {
    ...state,
    /** Real-time metadata is current: connected, and the snapshot for this connection arrived. */
    healthy: state.connected && state.snapshot,
  };
}

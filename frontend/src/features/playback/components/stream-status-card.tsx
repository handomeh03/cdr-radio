"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { useRadioRealtime } from "../hooks/use-radio-realtime";
import type { StreamHealth } from "../types/realtime";

const HEALTH: Record<StreamHealth, { label: string; style: string }> = {
  LIVE: { label: "Live", style: "border-emerald-600/30 bg-emerald-50 text-emerald-800" },
  OFFLINE: { label: "Offline", style: "border-red-600/30 bg-red-50 text-red-800" },
  UNKNOWN: { label: "Unknown", style: "border-border bg-muted text-neutral-700" },
};

/**
 * The streaming server's own view (what Icecast reports), delivered live. It is not the state of
 * any listener's player: a branch can have its audio stopped while Icecast is live. When live
 * updates are unavailable the card says so instead of showing an old number.
 */
export function StreamStatusCard() {
  const { connected, healthy, streamStatus } = useRadioRealtime();

  const status = streamStatus?.status;
  const known = healthy && !!status;

  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>Streaming server</CardDescription>
        <CardTitle className="text-base">Listeners</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2" aria-live="polite">
        <div className="text-2xl font-semibold tabular-nums" data-testid="listener-count">
          {known && status === "LIVE" && streamStatus.listeners !== null ? streamStatus.listeners : "—"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn(HEALTH[known ? status : "UNKNOWN"].style)}>
            Icecast: {HEALTH[known ? status : "UNKNOWN"].label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {known
            ? status === "LIVE"
              ? `Listeners connected to the stream, as reported by Icecast (updated ${formatTime(streamStatus.checkedAt)}). This is not the state of any branch's player.`
              : status === "OFFLINE"
                ? "Icecast is running but the stream is not on it, so there are no listeners to count."
                : "Icecast could not be read, so the listener count is unknown."
            : connected
              ? "Waiting for the first stream status…"
              : "Live updates are not connected, so the listener count is unknown."}
        </p>
      </CardContent>
    </Card>
  );
}

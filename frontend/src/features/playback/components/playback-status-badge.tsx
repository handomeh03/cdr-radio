import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PlaybackStatus } from "../types";

const LABELS: Record<PlaybackStatus, string> = {
  PLAYING: "Playing",
  FALLBACK: "Standby tone",
  UNKNOWN: "Unknown",
};

const STYLES: Record<PlaybackStatus, string> = {
  PLAYING: "border-emerald-600/30 bg-emerald-50 text-emerald-800",
  FALLBACK: "border-amber-600/30 bg-amber-50 text-amber-800",
  UNKNOWN: "border-border bg-muted text-neutral-700",
};

/** What the stream is actually doing, as confirmed by the playout engine. */
export function PlaybackStatusBadge({ status }: { status: PlaybackStatus }) {
  return (
    <Badge variant="outline" className={cn(STYLES[status])}>
      {LABELS[status]}
    </Badge>
  );
}

export function DesiredStatusBadge({ status }: { status: "ON_AIR" | "OFF_AIR" }) {
  return (
    <Badge variant="outline" className={status === "ON_AIR" ? "border-sky-600/30 bg-sky-50 text-sky-800" : undefined}>
      {status === "ON_AIR" ? "On air" : "Off air"}
    </Badge>
  );
}

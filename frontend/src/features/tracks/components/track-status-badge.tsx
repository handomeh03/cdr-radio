import { Loader2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TrackStatus } from "../types";

const LABELS: Record<TrackStatus, string> = {
  READY: "Ready",
  PROCESSING: "Processing",
  FAILED: "Failed",
};

const STYLES: Record<TrackStatus, string> = {
  READY: "border-emerald-600/30 bg-emerald-50 text-emerald-800",
  PROCESSING: "border-amber-600/30 bg-amber-50 text-amber-800",
  FAILED: "border-red-600/30 bg-red-50 text-red-800",
};

/** Status is conveyed by text as well as colour. */
export function TrackStatusBadge({ status }: { status: TrackStatus }) {
  return (
    <Badge variant="outline" className={cn(STYLES[status])}>
      {status === "PROCESSING" && <Loader2Icon className="animate-spin" aria-hidden="true" />}
      {LABELS[status]}
    </Badge>
  );
}

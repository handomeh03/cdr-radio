import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoaderProps {
  /** Text shown next to the spinner and announced to screen readers. */
  label?: string;
  /** Centers the loader in the viewport (for route-level loading). */
  fullScreen?: boolean;
  className?: string;
}

export function Loader({ label = "Loading…", fullScreen = false, className }: LoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 text-sm text-muted-foreground",
        fullScreen ? "min-h-dvh" : "py-8",
        className,
      )}
    >
      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

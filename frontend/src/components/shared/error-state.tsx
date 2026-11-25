import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  message: string;
  /** Shows a retry button when provided. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Centers the state in the viewport (for route-level errors). */
  fullScreen?: boolean;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  fullScreen = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-4 py-10 text-center",
        fullScreen && "min-h-dvh",
        className,
      )}
    >
      <TriangleAlertIcon className="size-8 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

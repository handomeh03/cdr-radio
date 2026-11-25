import { cn } from "@/lib/utils";

export type InlineAlertTone = "error" | "warning" | "info" | "success";

/**
 * Text colours are the dark -900 shades on a -50 tint (about 9:1 contrast), because the plain
 * `destructive` red on its own 10 % tint is only about 4:1, below the 4.5:1 WCAG minimum.
 */
const TONES: Record<InlineAlertTone, string> = {
  error: "border-red-600/30 bg-red-50 text-red-900",
  warning: "border-amber-600/30 bg-amber-50 text-amber-900",
  info: "border-sky-600/30 bg-sky-50 text-sky-900",
  success: "border-emerald-600/30 bg-emerald-50 text-emerald-900",
};

interface InlineAlertProps {
  tone?: InlineAlertTone;
  /** Errors and warnings are announced immediately (alert); the rest politely (status). */
  role?: "alert" | "status";
  className?: string;
  children: React.ReactNode;
}

/** A short message box for form errors, request failures and progress notices. */
export function InlineAlert({ tone = "error", role, className, children }: InlineAlertProps) {
  return (
    <div
      role={role ?? (tone === "error" || tone === "warning" ? "alert" : "status")}
      className={cn("rounded-md border px-3 py-2 text-sm", TONES[tone], className)}
    >
      {children}
    </div>
  );
}

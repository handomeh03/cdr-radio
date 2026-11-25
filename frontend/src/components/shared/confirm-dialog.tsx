"use client";

import { Loader2Icon } from "lucide-react";
import { InlineAlert } from "@/components/shared/inline-alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action (deletes, etc.). */
  destructive?: boolean;
  /** Keeps the dialog open and disables its buttons while the action runs. */
  loading?: boolean;
  /** Shown inside the dialog when the confirmed action failed (e.g. a 409 conflict). */
  error?: string | null;
  /** The caller closes the dialog (onOpenChange(false)) once the action succeeded. */
  onConfirm: () => void;
}

/** Reusable confirmation step for irreversible or disruptive actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  error = null,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {error && (
          <InlineAlert>{error}</InlineAlert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          {/* A plain Button (not AlertDialogAction) so the dialog does not close before onConfirm finishes. */}
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading && <Loader2Icon className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/api-error";
import { useDeleteTrack } from "../hooks/use-tracks";
import type { Track } from "../types";

interface DeleteTrackDialogProps {
  /** The track to delete; null keeps the dialog closed. */
  track: Track | null;
  onClose: () => void;
}

/**
 * Confirms, then deletes. A 409 (the track is used by a playlist, or still processing) keeps the
 * dialog open with the server's explanation, so the reason is clear and nothing is lost.
 */
export function DeleteTrackDialog({ track, onClose }: DeleteTrackDialogProps) {
  const remove = useDeleteTrack();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    remove.reset();
    onClose();
  }

  async function confirm() {
    if (!track) return;
    setError(null);
    try {
      await remove.mutateAsync(track.id);
      toast.success(`Deleted “${track.title}”`);
      close();
    } catch (err) {
      setError(getErrorMessage(err, "Could not delete the track."));
    }
  }

  return (
    <ConfirmDialog
      open={track !== null}
      onOpenChange={(open) => !open && close()}
      title="Delete this track?"
      description={
        track
          ? `“${track.title}” and its stored audio will be permanently deleted. A track that is used in a playlist cannot be deleted.`
          : undefined
      }
      confirmLabel="Delete"
      destructive
      loading={remove.isPending}
      error={error}
      onConfirm={confirm}
    />
  );
}

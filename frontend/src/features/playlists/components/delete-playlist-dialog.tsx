"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/api-error";
import { useDeletePlaylist } from "../hooks/use-playlists";
import type { PlaylistSummary } from "../types";

interface DeletePlaylistDialogProps {
  playlist: PlaylistSummary;
  open: boolean;
  onClose: () => void;
  /** Called after a successful delete (e.g. to leave the now-missing page). */
  onDeleted: () => void;
}

/**
 * Deleting removes the playlist and its slots, never the tracks or their audio. While a station
 * has the playlist selected the backend answers 409, which is shown here with its explanation.
 */
export function DeletePlaylistDialog({ playlist, open, onClose, onDeleted }: DeletePlaylistDialogProps) {
  const remove = useDeletePlaylist(playlist.id);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    remove.reset();
    onClose();
  }

  async function confirm() {
    setError(null);
    try {
      await remove.mutateAsync();
      toast.success(`Deleted “${playlist.name}”`);
      onDeleted();
    } catch (err) {
      setError(getErrorMessage(err, "Could not delete the playlist."));
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Delete this playlist?"
      description={`“${playlist.name}” will be deleted. Its tracks stay in the library. A playlist that is selected on the station cannot be deleted.`}
      confirmLabel="Delete"
      destructive
      loading={remove.isPending}
      error={error}
      onConfirm={confirm}
    />
  );
}

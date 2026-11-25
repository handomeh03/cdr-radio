"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/api-error";
import { useUpdateTrack } from "../hooks/use-tracks";
import { editTrackSchema, type EditTrackFormValues } from "../schemas/track.schema";
import type { Track } from "../types";

interface EditTrackDialogProps {
  /** The track being edited; null keeps the dialog closed. */
  track: Track | null;
  onClose: () => void;
}

/** Keep mounted; the form follows the selected track (`values`). */
export function EditTrackDialog({ track, onClose: onCloseDialog }: EditTrackDialogProps) {
  const update = useUpdateTrack();
  const [error, setError] = useState<string | null>(null);
  const onClose = () => {
    setError(null);
    onCloseDialog();
  };
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditTrackFormValues>({
    resolver: zodResolver(editTrackSchema),
    values: { title: track?.title ?? "", artist: track?.artist ?? "" },
    mode: "onTouched",
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!track || update.isPending) return;
    setError(null);
    try {
      await update.mutateAsync({
        id: track.id,
        input: { title: values.title, artist: values.artist || null },
      });
      toast.success("Track updated");
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Could not update the track."));
    }
  });

  return (
    <Dialog open={track !== null} onOpenChange={(open) => !open && !update.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit track</DialogTitle>
          <DialogDescription>Only the title and artist can be changed.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {error && (
              <InlineAlert>{error}</InlineAlert>
            )}
            <Field data-invalid={!!errors.title}>
              <FieldLabel htmlFor="edit-title">Title</FieldLabel>
              <Input id="edit-title" aria-invalid={!!errors.title} {...register("title")} />
              <FieldError errors={[errors.title]} />
            </Field>
            <Field data-invalid={!!errors.artist}>
              <FieldLabel htmlFor="edit-artist">Artist</FieldLabel>
              <Input id="edit-artist" aria-invalid={!!errors.artist} {...register("artist")} />
              <FieldError errors={[errors.artist]} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" disabled={update.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2Icon className="animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

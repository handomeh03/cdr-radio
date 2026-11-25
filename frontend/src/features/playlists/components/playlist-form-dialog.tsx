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
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/lib/api-error";
import { useCreatePlaylist, useUpdatePlaylist } from "../hooks/use-playlists";
import { playlistSchema, type PlaylistFormValues } from "../schemas/playlist.schema";
import type { PlaylistSummary } from "../types";

interface PlaylistFormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  submitLabel: string;
  initial: PlaylistFormValues;
  onSubmit: (values: PlaylistFormValues) => Promise<void>;
}

/** Name + description form shared by "create" and "edit". Closing is blocked while saving. */
function PlaylistFormDialog({ open, onClose, title, description, submitLabel, initial, onSubmit }: PlaylistFormDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PlaylistFormValues>({
    resolver: zodResolver(playlistSchema),
    values: initial,
    mode: "onTouched",
  });

  function close() {
    if (isSubmitting) return;
    setError(null);
    reset();
    onClose();
  }

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await onSubmit(values);
      reset();
    } catch (err) {
      setError(getErrorMessage(err, "Could not save the playlist."));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            {error && (
              <InlineAlert>{error}</InlineAlert>
            )}
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="playlist-name">Name</FieldLabel>
              <Input id="playlist-name" aria-invalid={!!errors.name} {...register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor="playlist-description">Description (optional)</FieldLabel>
              <Textarea id="playlist-description" rows={3} aria-invalid={!!errors.description} {...register("description")} />
              <FieldError errors={[errors.description]} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="animate-spin" aria-hidden="true" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY: PlaylistFormValues = { name: "", description: "" };

export function CreatePlaylistDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (playlist: PlaylistSummary) => void;
}) {
  const create = useCreatePlaylist();
  return (
    <PlaylistFormDialog
      open={open}
      onClose={onClose}
      title="New playlist"
      description="Create an empty playlist, then add tracks to it."
      submitLabel="Create"
      initial={EMPTY}
      onSubmit={async (values) => {
        const playlist = await create.mutateAsync({
          name: values.name,
          description: values.description || undefined,
        });
        toast.success(`Created “${playlist.name}”`);
        onCreated(playlist);
      }}
    />
  );
}

export function EditPlaylistDialog({
  playlist,
  open,
  onClose,
}: {
  playlist: PlaylistSummary;
  open: boolean;
  onClose: () => void;
}) {
  const update = useUpdatePlaylist(playlist.id);
  return (
    <PlaylistFormDialog
      open={open}
      onClose={onClose}
      title="Edit playlist"
      description="Change the name or description. The tracks are not affected."
      submitLabel="Save"
      initial={{ name: playlist.name, description: playlist.description ?? "" }}
      onSubmit={async (values) => {
        await update.mutateAsync({ name: values.name, description: values.description || null });
        toast.success("Playlist updated");
        onClose();
      }}
    />
  );
}

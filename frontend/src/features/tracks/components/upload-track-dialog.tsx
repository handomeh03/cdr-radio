"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { env } from "@/config/env";
import { getErrorField, getErrorMessage, isApiError } from "@/lib/api-error";
import { useUploadTrack } from "../hooks/use-tracks";
import { AUDIO_ACCEPT, uploadTrackSchema, type UploadTrackFormValues } from "../schemas/track.schema";

function uploadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.status === 413) {
    return `The file is larger than the server's limit (${env.audioUploadMaxMb} MB).`;
  }
  return getErrorMessage(error, "The upload failed. Please try again.");
}

interface UploadTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadTrackDialog({ open, onOpenChange }: UploadTrackDialogProps) {
  const upload = useUploadTrack();
  const [failure, setFailure] = useState<{ message: string; recorded: boolean } | null>(null);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UploadTrackFormValues>({
    resolver: zodResolver(uploadTrackSchema),
    defaultValues: { title: "", artist: "" },
    mode: "onTouched",
  });

  const busy = upload.isPending;
  // 0-99 %: the browser is still sending the file. At 100 % the server is converting and storing it.
  const sending = busy && (upload.progress ?? 0) < 100;
  const processing = busy && !sending;

  function handleOpenChange(next: boolean) {
    if (busy) return; // never close mid-upload: the request would continue unseen
    if (!next) {
      reset();
      setFailure(null);
    }
    onOpenChange(next);
  }

  const onSubmit = handleSubmit(async (values) => {
    if (busy) return; // guards against a double submit (Enter key + click)
    setFailure(null);
    try {
      const track = await upload.mutateAsync({
        file: values.file,
        title: values.title || undefined,
        artist: values.artist || undefined,
      });
      toast.success(`Uploaded “${track.title}”`);
      reset();
      onOpenChange(false);
    } catch (error) {
      setFailure({ message: uploadErrorMessage(error), recorded: getErrorField(error, "trackId") !== null });
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!busy}
        onInteractOutside={(event) => busy && event.preventDefault()}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Upload a track</DialogTitle>
          <DialogDescription>
            MP3, WAV, M4A/AAC, OGG or FLAC, up to {env.audioUploadMaxMb} MB. The server converts it to MP3
            before it can be used in a playlist.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {failure && (
              <InlineAlert className="space-y-1">
                <p>{failure.message}</p>
                {failure.recorded && (
                  <p className="text-xs">
                    A failed entry was recorded in the track list; you can delete it there.
                  </p>
                )}
              </InlineAlert>
            )}

            <Field data-invalid={!!errors.file}>
              <FieldLabel htmlFor="upload-file">Audio file</FieldLabel>
              <Controller
                control={control}
                name="file"
                render={({ field }) => (
                  <Input
                    id="upload-file"
                    type="file"
                    accept={AUDIO_ACCEPT}
                    disabled={busy}
                    aria-invalid={!!errors.file}
                    onBlur={field.onBlur}
                    onChange={(event) => field.onChange(event.target.files?.[0])}
                  />
                )}
              />
              <FieldError errors={[errors.file]} />
            </Field>

            <Field data-invalid={!!errors.title}>
              <FieldLabel htmlFor="upload-title">Title (optional)</FieldLabel>
              <Input id="upload-title" disabled={busy} aria-invalid={!!errors.title} {...register("title")} />
              <FieldDescription>Left empty, the file&apos;s own tag or its name is used.</FieldDescription>
              <FieldError errors={[errors.title]} />
            </Field>

            <Field data-invalid={!!errors.artist}>
              <FieldLabel htmlFor="upload-artist">Artist (optional)</FieldLabel>
              <Input id="upload-artist" disabled={busy} aria-invalid={!!errors.artist} {...register("artist")} />
              <FieldError errors={[errors.artist]} />
            </Field>

            {busy && (
              <div role="status" aria-live="polite" className="space-y-2">
                {sending ? (
                  <>
                    <p className="text-sm">Uploading… {upload.progress ?? 0}%</p>
                    <Progress value={upload.progress ?? 0} aria-label="Upload progress" />
                  </>
                ) : (
                  <>
                    <p className="text-sm">
                      Upload complete. Processing on the server: converting to MP3 and storing it. Longer
                      files take longer.
                    </p>
                    <Progress value={100} className="animate-pulse" aria-label="Server processing" />
                  </>
                )}
              </div>
            )}
          </FieldGroup>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
              {sending ? "Uploading…" : processing ? "Processing…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, SkipForwardIcon } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApplyPlayback, useSkipTrack } from "@/features/playback/hooks/use-playback";
import type { ApplyPlaybackInput, NowPlaying } from "@/features/playback/types";
import { usePlaylists } from "@/features/playlists/hooks/use-playlists";
import { getErrorField, getErrorMessage } from "@/lib/api-error";
import { usePendingChange } from "../hooks/use-pending-change";
import { stationControlSchema, type StationControlValues } from "../schemas/station-control.schema";
import type { Station } from "../types";
import { PendingChangeNotice } from "./pending-change-notice";

const NONE = "none";
const PLAYLIST_LIMIT = 100;

interface StationControlPanelProps {
  station: Station;
  nowPlaying: NowPlaying | undefined;
}

/**
 * ADMIN controls. Every action goes through POST /stations/main/playback/apply or /skip, which
 * change what is actually on air; the result is shown as "requested" until the stream confirms it
 * (see usePendingChange), never as an optimistic success.
 */
export function StationControlPanel({ station, nowPlaying }: StationControlPanelProps) {
  const playlists = usePlaylists({ page: 1, pageSize: PLAYLIST_LIMIT });
  const apply = useApplyPlayback();
  const skip = useSkipTrack();
  const { pending, state, start, clear } = usePendingChange(nowPlaying);
  const [failure, setFailure] = useState<{ message: string; settingsSaved: boolean } | null>(null);
  const [confirmNowOpen, setConfirmNowOpen] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<StationControlValues>({
    resolver: zodResolver(stationControlSchema),
    values: { activePlaylistId: station.activePlaylist?.id ?? null, desiredStatus: station.desiredStatus },
  });
  const chosen = useWatch({ control });
  const busy = apply.isPending || skip.isPending;
  const canSkip = nowPlaying?.status === "PLAYING";

  // Offer the saved playlist even if it is beyond the first page of results.
  const options = [...(playlists.data?.items.map(({ id, name }) => ({ id, name })) ?? [])];
  if (station.activePlaylist && !options.some((option) => option.id === station.activePlaylist?.id)) {
    options.unshift({ id: station.activePlaylist.id, name: station.activePlaylist.name });
  }

  const baseline = () => ({
    baselineStartedAt: nowPlaying?.startedAt ?? null,
    baselineStatus: nowPlaying?.status ?? ("UNKNOWN" as const),
  });

  async function send(input: ApplyPlaybackInput, expectsTrack: boolean) {
    setFailure(null);
    clear();
    try {
      const result = await apply.mutateAsync(input);
      start({ kind: "apply", effective: result.effective, expectsTrack, ...baseline() });
      toast.info(
        result.effective === "now"
          ? "Request sent. Waiting for the stream to confirm."
          : "Saved. The stream switches when the current track ends.",
      );
    } catch (error) {
      // The backend stores the settings first; only the on-air part can fail afterwards.
      setFailure({
        message: getErrorMessage(error, "Could not apply the change."),
        settingsSaved: getErrorField(error, "settingsSaved") === true,
      });
    }
  }

  /** Will this choice put a playlist track on air (rather than only the standby tone)? */
  function expectsTrackFor(values: StationControlValues): boolean {
    if (values.desiredStatus !== "ON_AIR" || values.activePlaylistId === null) return false;
    const known = playlists.data?.items.find((playlist) => playlist.id === values.activePlaylistId);
    const trackCount = known?.trackCount ?? station.activePlaylist?.trackCount ?? 0;
    return trackCount > 0;
  }

  const applyAtNextTrack = handleSubmit((values) =>
    send({ activePlaylistId: values.activePlaylistId, desiredStatus: values.desiredStatus }, expectsTrackFor(values)),
  );
  const applyNow = handleSubmit(async (values) => {
    await send(
      { activePlaylistId: values.activePlaylistId, desiredStatus: values.desiredStatus, immediate: true },
      expectsTrackFor(values),
    );
    setConfirmNowOpen(false);
  });

  function retrySaved() {
    return send(
      {},
      station.desiredStatus === "ON_AIR" && (station.activePlaylist?.trackCount ?? 0) > 0,
    );
  }

  async function skipTrack() {
    setFailure(null);
    clear();
    try {
      await skip.mutateAsync();
      start({ kind: "skip", effective: "now", expectsTrack: true, ...baseline() });
      toast.info("Skip sent. Waiting for the stream to confirm the next track.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not skip the track."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Station controls</CardTitle>
        <CardDescription>
          Choose what the station should play, then apply it. Changes affect every listener.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={applyAtNextTrack} noValidate>
          <FieldGroup>
            <Field data-invalid={!!errors.activePlaylistId}>
              <FieldLabel htmlFor="station-playlist">Active playlist</FieldLabel>
              <Controller
                control={control}
                name="activePlaylistId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                    disabled={busy}
                  >
                    <SelectTrigger id="station-playlist" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No playlist (standby tone only)</SelectItem>
                      {options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {playlists.isError && (
                <FieldError>Could not load the playlist list. {getErrorMessage(playlists.error, "")}</FieldError>
              )}
              {(playlists.data?.total ?? 0) > PLAYLIST_LIMIT && (
                <FieldDescription>Showing the {PLAYLIST_LIMIT} most recent playlists.</FieldDescription>
              )}
              <FieldError errors={[errors.activePlaylistId]} />
            </Field>

            <Field data-invalid={!!errors.desiredStatus}>
              <FieldLabel htmlFor="station-status">Broadcast</FieldLabel>
              <Controller
                control={control}
                name="desiredStatus"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                    <SelectTrigger id="station-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ON_AIR">On air: play the selected playlist</SelectItem>
                      <SelectItem value="OFF_AIR">Off air: standby tone only</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>
                Off air does not stop the stream: listeners stay connected and hear a standby tone until the
                station goes on air again.
              </FieldDescription>
              <FieldError errors={[errors.desiredStatus]} />
            </Field>

            {chosen.desiredStatus === "ON_AIR" && !chosen.activePlaylistId && (
              <p role="note" className="text-sm text-muted-foreground">
                On air without a playlist plays only the standby tone.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {apply.isPending && <Loader2Icon className="animate-spin" aria-hidden="true" />}
                Apply at next track
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmNowOpen(true)}>
                Apply now…
              </Button>
              <Button type="button" variant="outline" disabled={busy || !canSkip} onClick={skipTrack}>
                {skip.isPending ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <SkipForwardIcon aria-hidden="true" />
                )}
                Skip current track
              </Button>
            </div>
            {!canSkip && (
              <FieldDescription>Skipping is available while a playlist track is playing.</FieldDescription>
            )}
          </FieldGroup>
        </form>

        {failure && (
          <InlineAlert className="space-y-2">
            <p>{failure.message}</p>
            {failure.settingsSaved && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs">
                  Your settings are saved, but the stream was not confirmed to follow them.
                </p>
                <Button size="sm" variant="outline" disabled={busy} onClick={retrySaved}>
                  Retry applying
                </Button>
              </div>
            )}
          </InlineAlert>
        )}

        {pending && state && <PendingChangeNotice pending={pending} state={state} nowPlaying={nowPlaying} />}
      </CardContent>

      <ConfirmDialog
        open={confirmNowOpen}
        onOpenChange={setConfirmNowOpen}
        title="Apply now?"
        description="The track that is playing right now will be cut off for every listener, and the new settings take over immediately."
        confirmLabel="Apply now"
        loading={apply.isPending}
        onConfirm={() => void applyNow()}
      />
    </Card>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Loader } from "@/components/shared/loader";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useIsAdmin } from "@/features/auth/hooks/use-is-admin";
import { useStation } from "@/features/stations/hooks/use-station";
import { getErrorMessage, isApiError } from "@/lib/api-error";
import { formatDuration, pluralize } from "@/lib/format";
import { useRemovePlaylistItem, usePlaylist, useReorderPlaylist } from "../hooks/use-playlists";
import type { PlaylistItem } from "../types";
import { AddTracksDialog } from "./add-tracks-dialog";
import { DeletePlaylistDialog } from "./delete-playlist-dialog";
import { EditPlaylistDialog } from "./playlist-form-dialog";
import { PlaylistItemsList } from "./playlist-items-list";

const BackLink = () => (
  <Link href="/dashboard/playlists" className={buttonVariants({ variant: "ghost", size: "sm" })}>
    <ArrowLeftIcon aria-hidden="true" />
    All playlists
  </Link>
);

export function PlaylistDetailScreen({ playlistId }: { playlistId: string }) {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const playlist = usePlaylist(playlistId);
  const station = useStation();
  const reorder = useReorderPlaylist(playlistId);
  const removeItem = useRemovePlaylistItem(playlistId);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Read out by screen readers after a change (focus stays on the control that was used).
  const [announcement, setAnnouncement] = useState("");

  // One change at a time, so edits never overlap and the full-order payload is always current.
  const busy = reorder.isPending || removeItem.isPending;

  if (playlist.isPending) return <Loader label="Loading the playlist…" />;
  if (playlist.isError && !playlist.data) {
    if (isApiError(playlist.error) && playlist.error.status === 404) {
      return (
        <div className="space-y-4">
          <BackLink />
          <EmptyState title="Playlist not found" description="It may have been deleted." />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState
          message={getErrorMessage(playlist.error, "Could not load the playlist.")}
          onRetry={() => void playlist.refetch()}
        />
      </div>
    );
  }

  const detail = playlist.data;
  const isActive = station.data?.activePlaylist?.id === detail.id;

  /** Sends the full new order (playlist-item ids). A 409 means the playlist changed elsewhere. */
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (busy || target < 0 || target >= detail.items.length) return;
    const ids = detail.items.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorder.mutateAsync(ids);
      setAnnouncement(`Moved “${detail.items[index].track.title}” to position ${target + 1} of ${ids.length}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not change the order."));
      void playlist.refetch(); // show the playlist as it really is now
    }
  }

  async function remove(item: PlaylistItem) {
    if (busy) return;
    try {
      await removeItem.mutateAsync(item.id);
      toast.success(`Removed “${item.track.title}”`);
      setAnnouncement(`Removed “${item.track.title}”. ${pluralize(detail.items.length - 1, "track")} left.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not remove the track."));
      void playlist.refetch();
    }
  }

  return (
    <div className="space-y-4">
      <BackLink />
      <PageHeader
        title={detail.name}
        description={detail.description ?? undefined}
        actions={
          isAdmin && (
            <>
              <Button onClick={() => setAddOpen(true)}>
                <PlusIcon aria-hidden="true" />
                Add tracks
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon aria-hidden="true" />
                Edit
              </Button>
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2Icon aria-hidden="true" />
                Delete
              </Button>
            </>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          {pluralize(detail.trackCount, "track")} · {formatDuration(detail.totalDurationMs)} total
        </span>
        {isActive && <Badge variant="outline">Selected on the station</Badge>}
      </div>
      {isActive && (
        <p role="note" className="text-sm text-muted-foreground">
          This playlist is selected on the station. Edits are picked up as tracks are queued, so the track
          that is already queued next may still play before a change is heard. It cannot be deleted while
          it is selected.
        </p>
      )}
      {!isAdmin && (
        <p role="note" className="text-sm text-muted-foreground">
          View only: changing playlists requires an admin account.
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {detail.items.length === 0 ? (
        <EmptyState
          title="This playlist is empty"
          description={isAdmin ? "Add Ready tracks to build the play order." : "An admin needs to add tracks."}
          action={
            isAdmin ? (
              <Button onClick={() => setAddOpen(true)}>
                <PlusIcon aria-hidden="true" />
                Add tracks
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {playlist.isError && (
            <p role="alert" className="text-sm text-destructive">
              Could not refresh; showing the last loaded order.
            </p>
          )}
          <PlaylistItemsList items={detail.items} canManage={isAdmin} busy={busy} onMove={move} onRemove={remove} />
        </>
      )}

      {isAdmin && (
        <>
          <AddTracksDialog
            playlistId={detail.id}
            itemCount={detail.items.length}
            open={addOpen}
            onClose={() => setAddOpen(false)}
          />
          <EditPlaylistDialog playlist={detail} open={editOpen} onClose={() => setEditOpen(false)} />
          <DeletePlaylistDialog
            playlist={detail}
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onDeleted={() => {
              setDeleteOpen(false);
              router.replace("/dashboard/playlists");
            }}
          />
        </>
      )}
    </div>
  );
}

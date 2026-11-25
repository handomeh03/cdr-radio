"use client";

import { useState } from "react";
import { PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Loader } from "@/components/shared/loader";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTracks } from "@/features/tracks/hooks/use-tracks";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getErrorMessage } from "@/lib/api-error";
import { formatDuration, pluralize } from "@/lib/format";
import { useAddPlaylistTrack } from "../hooks/use-playlists";

const PAGE_SIZE = 6;
/** Mirrors the backend's MAX_PLAYLIST_ITEMS. */
const MAX_ITEMS = 1000;

interface AddTracksDialogProps {
  playlistId: string;
  itemCount: number;
  open: boolean;
  onClose: () => void;
}

/**
 * Picks from READY tracks only (the backend rejects anything else). Each click appends one new
 * item at the end; the same track can be added again. The dialog stays open to add several.
 */
export function AddTracksDialog({ playlistId, itemCount, open, onClose }: AddTracksDialogProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search.trim(), 300);
  const tracks = useTracks({ page, pageSize: PAGE_SIZE, search: debounced || undefined, status: "READY" });
  const add = useAddPlaylistTrack(playlistId);
  const full = itemCount >= MAX_ITEMS;

  async function addTrack(trackId: string, title: string) {
    try {
      await add.mutateAsync(trackId);
      toast.success(`Added “${title}” to the end of the playlist`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not add the track."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add tracks</DialogTitle>
          <DialogDescription>
            Only Ready tracks are listed. Each track is added at the end, and the same track can be added
            more than once. The playlist has {pluralize(itemCount, "track")}.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search ready tracks"
            placeholder="Search title or artist"
            className="pl-8"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>

        {full && (
          <p role="alert" className="text-sm text-destructive">
            This playlist is full ({MAX_ITEMS} tracks).
          </p>
        )}

        {tracks.isPending ? (
          <Loader label="Loading tracks…" />
        ) : tracks.isError && !tracks.data ? (
          <ErrorState message={getErrorMessage(tracks.error, "Could not load tracks.")} onRetry={() => void tracks.refetch()} />
        ) : tracks.data.items.length === 0 ? (
          <EmptyState
            title={debounced ? "No ready tracks match" : "No ready tracks"}
            description={debounced ? "Try a different search." : "Upload a track on the Tracks page first."}
          />
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {tracks.data.items.map((track) => (
                <li key={track.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{track.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{track.artist ?? "Unknown artist"}</div>
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums">{formatDuration(track.durationMs)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={add.isPending || full}
                    aria-label={`Add “${track.title}” to the playlist`}
                    onClick={() => addTrack(track.id, track.title)}
                  >
                    <PlusIcon aria-hidden="true" />
                    Add
                  </Button>
                </li>
              ))}
            </ul>
            <Pagination
              page={tracks.data.page}
              totalPages={tracks.data.totalPages}
              total={tracks.data.total}
              onPageChange={setPage}
              disabled={tracks.isPlaceholderData}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

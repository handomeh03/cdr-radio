"use client";

import { useState } from "react";
import { SearchIcon, UploadIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Loader } from "@/components/shared/loader";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsAdmin } from "@/features/auth/hooks/use-is-admin";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getErrorMessage } from "@/lib/api-error";
import { useTracks } from "../hooks/use-tracks";
import type { Track, TrackStatus } from "../types";
import { DeleteTrackDialog } from "./delete-track-dialog";
import { EditTrackDialog } from "./edit-track-dialog";
import { TracksTable } from "./tracks-table";
import { UploadTrackDialog } from "./upload-track-dialog";

const PAGE_SIZE = 10;
const ALL = "all";

export function TracksScreen() {
  const isAdmin = useIsAdmin();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TrackStatus | typeof ALL>(ALL);
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [deleting, setDeleting] = useState<Track | null>(null);

  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const tracks = useTracks({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status === ALL ? undefined : status,
  });
  const filtered = Boolean(debouncedSearch) || status !== ALL;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tracks"
        description="Audio uploaded to the library. Only tracks that are Ready can be added to playlists."
        actions={
          isAdmin && (
            <Button onClick={() => setUploadOpen(true)}>
              <UploadIcon aria-hidden="true" />
              Upload track
            </Button>
          )
        }
      />
      {!isAdmin && (
        <p role="note" className="text-sm text-muted-foreground">
          View only: uploading, editing and deleting tracks requires an admin account.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search tracks by title or artist"
            placeholder="Search title or artist"
            className="pl-8"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as TrackStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="READY">Ready</SelectItem>
            <SelectItem value="PROCESSING">Processing</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {tracks.isPending ? (
        <Loader label="Loading tracks…" />
      ) : tracks.isError && !tracks.data ? (
        <ErrorState
          message={getErrorMessage(tracks.error, "Could not load the tracks.")}
          onRetry={() => void tracks.refetch()}
        />
      ) : tracks.data.items.length === 0 ? (
        <EmptyState
          title={filtered ? "No tracks match your search" : "No tracks yet"}
          description={
            filtered
              ? "Try a different search or status filter."
              : isAdmin
                ? "Upload your first track to get started."
                : "An admin needs to upload tracks first."
          }
          action={
            !filtered && isAdmin ? (
              <Button onClick={() => setUploadOpen(true)}>
                <UploadIcon aria-hidden="true" />
                Upload track
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {tracks.isError && (
            <p role="alert" className="text-sm text-destructive">
              Could not refresh the list; showing the last loaded data.
            </p>
          )}
          <div className={tracks.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
            <TracksTable
              tracks={tracks.data.items}
              canManage={isAdmin}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          </div>
          <Pagination
            page={tracks.data.page}
            totalPages={tracks.data.totalPages}
            total={tracks.data.total}
            onPageChange={setPage}
            disabled={tracks.isPlaceholderData}
          />
        </>
      )}

      {isAdmin && (
        <>
          <UploadTrackDialog open={uploadOpen} onOpenChange={setUploadOpen} />
          <EditTrackDialog track={editing} onClose={() => setEditing(null)} />
          <DeleteTrackDialog track={deleting} onClose={() => setDeleting(null)} />
        </>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon, SearchIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Loader } from "@/components/shared/loader";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsAdmin } from "@/features/auth/hooks/use-is-admin";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getErrorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { usePlaylists } from "../hooks/use-playlists";
import { CreatePlaylistDialog } from "./playlist-form-dialog";

const PAGE_SIZE = 10;

export function PlaylistsScreen() {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const debounced = useDebouncedValue(search.trim(), 300);
  const playlists = usePlaylists({ page, pageSize: PAGE_SIZE, search: debounced || undefined });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Playlists"
        description="Ordered lists of tracks. The station plays the playlist selected on the Station page."
        actions={
          isAdmin && (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon aria-hidden="true" />
              New playlist
            </Button>
          )
        }
      />
      {!isAdmin && (
        <p role="note" className="text-sm text-muted-foreground">
          View only: creating and changing playlists requires an admin account.
        </p>
      )}

      <div className="relative max-w-sm">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search playlists by name"
          placeholder="Search by name"
          className="pl-8"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {playlists.isPending ? (
        <Loader label="Loading playlists…" />
      ) : playlists.isError && !playlists.data ? (
        <ErrorState
          message={getErrorMessage(playlists.error, "Could not load the playlists.")}
          onRetry={() => void playlists.refetch()}
        />
      ) : playlists.data.items.length === 0 ? (
        <EmptyState
          title={debounced ? "No playlists match your search" : "No playlists yet"}
          description={debounced ? "Try a different name." : isAdmin ? "Create a playlist, then add tracks to it." : "An admin needs to create one."}
          action={
            !debounced && isAdmin ? (
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon aria-hidden="true" />
                New playlist
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className={playlists.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Playlist</TableHead>
                  <TableHead className="text-right">Tracks</TableHead>
                  <TableHead className="hidden md:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {playlists.data.items.map((playlist) => (
                  <TableRow key={playlist.id}>
                    <TableCell className="max-w-72 whitespace-normal">
                      <Link
                        href={`/dashboard/playlists/${playlist.id}`}
                        className="font-medium break-words underline-offset-4 hover:underline"
                      >
                        {playlist.name}
                      </Link>
                      {playlist.description && (
                        <div className="line-clamp-2 text-xs text-muted-foreground">{playlist.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{playlist.trackCount}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatDateTime(playlist.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={playlists.data.page}
            totalPages={playlists.data.totalPages}
            total={playlists.data.total}
            onPageChange={setPage}
            disabled={playlists.isPlaceholderData}
          />
        </>
      )}

      {isAdmin && (
        <CreatePlaylistDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(playlist) => {
            // Close first: this page stays mounted (hidden) after navigating, so an open dialog would reappear.
            setCreateOpen(false);
            router.push(`/dashboard/playlists/${playlist.id}`);
          }}
        />
      )}
    </div>
  );
}

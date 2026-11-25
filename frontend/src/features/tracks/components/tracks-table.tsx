import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import type { Track } from "../types";
import { TrackStatusBadge } from "./track-status-badge";

interface TracksTableProps {
  tracks: Track[];
  /** Management controls are shown to admins only (the backend enforces it as well). */
  canManage: boolean;
  onEdit: (track: Track) => void;
  onDelete: (track: Track) => void;
}

export function TracksTable({ tracks, canManage, onEdit, onDelete }: TracksTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Track</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead className="hidden md:table-cell">Source</TableHead>
          <TableHead className="hidden text-right md:table-cell">Size</TableHead>
          <TableHead className="hidden lg:table-cell">Added</TableHead>
          {canManage && (
            <TableHead className="w-24 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tracks.map((track) => (
          <TableRow key={track.id}>
            <TableCell className="max-w-64 whitespace-normal">
              <div className="font-medium break-words">{track.title}</div>
              <div className="text-xs break-words text-muted-foreground">{track.artist ?? "Unknown artist"}</div>
              {track.status === "FAILED" && track.errorMessage && (
                <div className="mt-1 text-xs text-destructive">{track.errorMessage}</div>
              )}
            </TableCell>
            <TableCell>
              <TrackStatusBadge status={track.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatDuration(track.durationMs)}</TableCell>
            <TableCell className="hidden uppercase md:table-cell">{track.sourceFormat ?? "—"}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">
              {formatBytes(track.sizeBytes)}
            </TableCell>
            <TableCell className="hidden lg:table-cell">{formatDateTime(track.createdAt)}</TableCell>
            {canManage && (
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit “${track.title}”`}
                    onClick={() => onEdit(track)}
                  >
                    <PencilIcon aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete “${track.title}”`}
                    onClick={() => onDelete(track)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

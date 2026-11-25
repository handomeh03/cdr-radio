import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import type { PlaylistItem } from "../types";

interface PlaylistItemsListProps {
  items: PlaylistItem[];
  canManage: boolean;
  /** Disables every control while a change is being saved, so edits never overlap. */
  busy: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (item: PlaylistItem) => void;
}

/**
 * Items in stored play order. Rows are keyed by playlist-item id, so a track that appears several
 * times stays distinguishable. Reordering uses buttons (not drag and drop) so it works by keyboard.
 */
export function PlaylistItemsList({ items, canManage, busy, onMove, onRemove }: PlaylistItemsListProps) {
  return (
    <ol aria-label="Tracks in play order" className="divide-y rounded-lg border">
      {items.map((item, index) => (
        <li key={item.id} className="flex items-center gap-3 p-3">
          <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums" aria-hidden="true">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{item.track.title}</div>
            <div className="truncate text-xs text-muted-foreground">{item.track.artist ?? "Unknown artist"}</div>
          </div>
          <span className="text-sm text-muted-foreground tabular-nums">{formatDuration(item.track.durationMs)}</span>
          {canManage && (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon"
                disabled={busy || index === 0}
                aria-label={`Move “${item.track.title}” up, currently position ${index + 1}`}
                onClick={() => onMove(index, -1)}
              >
                <ArrowUpIcon aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy || index === items.length - 1}
                aria-label={`Move “${item.track.title}” down, currently position ${index + 1}`}
                onClick={() => onMove(index, 1)}
              >
                <ArrowDownIcon aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label={`Remove “${item.track.title}” from the playlist`}
                onClick={() => onRemove(item)}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

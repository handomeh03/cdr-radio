import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DesiredStatusBadge } from "@/features/playback/components/playback-status-badge";
import { formatDateTime, pluralize } from "@/lib/format";
import type { Station } from "../types";

/** The saved settings: what has been requested. Whether it is on air is shown by the playback card. */
export function StationSettingsCard({ station }: { station: Station }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requested</CardTitle>
        <CardDescription>Saved settings for {station.name}. These are requests, not proof of what is on air.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Broadcast</span>
          <DesiredStatusBadge status={station.desiredStatus} />
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-muted-foreground">Active playlist</span>
          {station.activePlaylist ? (
            <span className="text-right">
              <Link
                href={`/dashboard/playlists/${station.activePlaylist.id}`}
                className="font-medium break-words underline-offset-4 hover:underline"
              >
                {station.activePlaylist.name}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {pluralize(station.activePlaylist.trackCount, "track")}
              </span>
            </span>
          ) : (
            <span>None</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Settings saved</span>
          <span>{formatDateTime(station.updatedAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

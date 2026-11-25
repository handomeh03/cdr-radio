"use client";

import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";
import { ErrorState } from "@/components/shared/error-state";
import { Loader } from "@/components/shared/loader";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/config/env";
import { NowPlayingCard } from "@/features/playback/components/now-playing-card";
import { StreamStatusCard } from "@/features/playback/components/stream-status-card";
import { usePlaylists } from "@/features/playlists/hooks/use-playlists";
import { useTracks } from "@/features/tracks/hooks/use-tracks";
import { getErrorMessage } from "@/lib/api-error";
import { useStation } from "../hooks/use-station";
import { StationSettingsCard } from "./station-settings-card";

/** A count straight from the API's `total`; shows a dash instead of inventing a number. */
function CountCard({
  title,
  href,
  query,
}: {
  title: string;
  href: string;
  query: { isPending: boolean; isError: boolean; data?: { total: number } };
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {query.isPending ? "…" : query.isError && !query.data ? "—" : query.data?.total}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Link href={href} className="text-sm underline-offset-4 hover:underline">
          Manage
        </Link>
        {query.isError && <span className="ml-2 text-xs text-destructive">Could not load</span>}
      </CardContent>
    </Card>
  );
}

export function OverviewScreen() {
  const station = useStation();
  const tracks = useTracks({ page: 1, pageSize: 1 });
  const playlists = usePlaylists({ page: 1, pageSize: 1 });

  return (
    <div className="space-y-4">
      <PageHeader title="Overview" description="The station at a glance." />

      <div className="grid gap-4 md:grid-cols-2">
        {station.isPending ? (
          <Card>
            <CardContent>
              <Loader label="Loading the station…" className="py-2" />
            </CardContent>
          </Card>
        ) : station.isError && !station.data ? (
          <Card>
            <CardContent>
              <ErrorState
                title="Can't load the station"
                message={getErrorMessage(station.error, "Could not load the station settings.")}
                onRetry={() => void station.refetch()}
                className="py-2"
              />
            </CardContent>
          </Card>
        ) : (
          <StationSettingsCard station={station.data} />
        )}
        <NowPlayingCard />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CountCard title="Tracks" href="/dashboard/tracks" query={tracks} />
        <CountCard title="Playlists" href="/dashboard/playlists" query={playlists} />
        <StreamStatusCard />
        <Card size="sm">
          <CardHeader>
            <CardDescription>Live stream</CardDescription>
            <CardTitle className="text-base">Listening links</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {/* The public player is what branches should open; the raw stream is for diagnostics. */}
            <a
              href="/radio"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "default", size: "sm" })}
            >
              Open the public player
              <ExternalLinkIcon aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {env.streamUrl ? (
              <a
                href={env.streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open the raw stream
                <ExternalLinkIcon aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No stream URL is configured.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

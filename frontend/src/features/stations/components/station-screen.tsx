"use client";

import { ErrorState } from "@/components/shared/error-state";
import { Loader } from "@/components/shared/loader";
import { PageHeader } from "@/components/shared/page-header";
import { NowPlayingCard } from "@/features/playback/components/now-playing-card";
import { useNowPlaying } from "@/features/playback/hooks/use-playback";
import { useIsAdmin } from "@/features/auth/hooks/use-is-admin";
import { getErrorMessage } from "@/lib/api-error";
import { useStation } from "../hooks/use-station";
import { StationControlPanel } from "./station-control-panel";
import { StationSettingsCard } from "./station-settings-card";

/** The single main station: what was requested next to what is actually on air. */
export function StationScreen() {
  const isAdmin = useIsAdmin();
  const station = useStation();
  const nowPlaying = useNowPlaying();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Station"
        description="The main station: the settings you requested next to what the stream confirms is on air."
      />

      {station.isPending ? (
        <Loader label="Loading the station…" />
      ) : station.isError && !station.data ? (
        <ErrorState
          title="Can't load the station"
          message={getErrorMessage(station.error, "Could not load the station settings.")}
          onRetry={() => void station.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <StationSettingsCard station={station.data} />
            <NowPlayingCard />
          </div>

          {isAdmin ? (
            // The Off air = standby explanation is shown next to the Broadcast setting itself.
            <StationControlPanel station={station.data} nowPlaying={nowPlaying.data} />
          ) : (
            <>
              <p role="note" className="text-sm text-muted-foreground">
                Off air does not stop the stream. Listeners stay connected and hear a standby tone, so the
                stream link always works.
              </p>
              <p role="note" className="text-sm text-muted-foreground">
                View only: changing the station or skipping tracks requires an admin account.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

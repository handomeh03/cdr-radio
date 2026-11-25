import { InlineAlert } from "@/components/shared/inline-alert";
import { formatTime } from "@/lib/format";
import type { NowPlaying } from "@/features/playback/types";
import type { PendingChange, PendingState } from "../hooks/use-pending-change";

interface PendingChangeNoticeProps {
  pending: PendingChange;
  state: PendingState;
  nowPlaying: NowPlaying | undefined;
}

/** Shows the gap between "request sent" and "confirmed by the stream", without claiming success early. */
export function PendingChangeNotice({ pending, state, nowPlaying }: PendingChangeNoticeProps) {
  if (state === "confirmed") {
    const detail =
      nowPlaying?.status === "PLAYING" && nowPlaying.track
        ? `now playing “${nowPlaying.track.title}” (started ${formatTime(nowPlaying.startedAt)})`
        : nowPlaying?.status === "FALLBACK"
          ? "the standby tone is on air"
          : "the stream is on standby";
    return <InlineAlert tone="success">Confirmed by the stream: {detail}.</InlineAlert>;
  }

  if (state === "unconfirmed") {
    return (
      <InlineAlert tone="warning">
        The stream has not confirmed the change after 20 seconds. Check that the streaming services (Liquidsoap and
        Icecast) are running. The status above shows what is actually on air.
      </InlineAlert>
    );
  }

  const message =
    pending.effective === "next_track"
      ? "Request sent. The change takes effect when the current track ends. It is not on air yet."
      : pending.kind === "skip"
        ? "Skip sent. Waiting for the stream to confirm the next track…"
        : "Request sent. Waiting for the stream to confirm the change…";
  return <InlineAlert tone="info">{message}</InlineAlert>;
}

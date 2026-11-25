import type { Metadata } from "next";
import { Suspense } from "react";
import { Loader } from "@/components/shared/loader";
import { PlaylistDetailScreen } from "@/features/playlists/components/playlist-detail-screen";

export const metadata: Metadata = { title: "Playlist" };

/**
 * `params` is a dynamic value, so it is awaited inside a Suspense boundary (not at the top of the
 * page): the page shell can still be prerendered while the id resolves per request.
 */
export default function PlaylistPage({ params }: PageProps<"/dashboard/playlists/[id]">) {
  return (
    <Suspense fallback={<Loader label="Loading the playlist…" />}>
      <PlaylistRoute params={params} />
    </Suspense>
  );
}

async function PlaylistRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaylistDetailScreen playlistId={id} />;
}

import type { Metadata } from "next";
import { PlaylistsScreen } from "@/features/playlists/components/playlists-screen";

export const metadata: Metadata = { title: "Playlists" };

export default function PlaylistsPage() {
  return <PlaylistsScreen />;
}

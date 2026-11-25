import type { Metadata } from "next";
import { TracksScreen } from "@/features/tracks/components/tracks-screen";

export const metadata: Metadata = { title: "Tracks" };

export default function TracksPage() {
  return <TracksScreen />;
}

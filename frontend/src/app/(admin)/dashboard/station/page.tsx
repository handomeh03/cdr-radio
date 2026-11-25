import type { Metadata } from "next";
import { StationScreen } from "@/features/stations/components/station-screen";

export const metadata: Metadata = { title: "Station" };

export default function StationPage() {
  return <StationScreen />;
}

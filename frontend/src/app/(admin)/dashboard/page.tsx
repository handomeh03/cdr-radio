import type { Metadata } from "next";
import { OverviewScreen } from "@/features/stations/components/overview-screen";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return <OverviewScreen />;
}

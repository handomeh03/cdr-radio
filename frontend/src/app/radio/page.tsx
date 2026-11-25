import type { Metadata } from "next";
import { RadioScreen } from "@/features/playback/components/radio-screen";

export const metadata: Metadata = {
  title: "Listen live · CDR Central Radio",
  description: "Listen to the live CDR Central Radio broadcast.",
};

// Public: outside the (admin) route group, so no session check runs for listeners.
export default function RadioPage() {
  return <RadioScreen />;
}

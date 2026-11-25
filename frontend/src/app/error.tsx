"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/shared/error-state";

// In this Next.js version the recovery callback is `retry` (re-fetches and re-renders the segment).
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      fullScreen
      message="An unexpected error occurred. Please try again."
      onRetry={retry}
    />
  );
}

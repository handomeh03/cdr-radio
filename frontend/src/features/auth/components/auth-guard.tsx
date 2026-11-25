"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/shared/error-state";
import { Loader } from "@/components/shared/loader";
import { useAuth } from "@/store/auth-context";

/**
 * Renders protected content only once the session is confirmed. While it is being checked (and
 * in the server-rendered HTML) only a loader is shown, so protected UI never flashes. This is a
 * UX gate: the backend enforces authorization on every request.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status, refresh } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "authenticated") return <>{children}</>;

  if (status === "error") {
    // Could not verify (backend down, server error): say so instead of pretending to be signed out.
    return (
      <ErrorState
        fullScreen
        title="Can't reach the server"
        message="We couldn't verify your session. Check that the server is running, then try again."
        onRetry={refresh}
      />
    );
  }

  return (
    <Loader
      fullScreen
      label={status === "unauthenticated" ? "Redirecting to sign in…" : "Checking your session…"}
    />
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader } from "@/components/shared/loader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/store/auth-context";
import { LoginForm } from "./login-form";

/** The /login page body: sends signed-in users to the dashboard, otherwise shows the form. */
export function LoginScreen() {
  const { status } = useAuth();
  const router = useRouter();

  // Redirects only when authenticated, and the dashboard only redirects back when
  // unauthenticated, so the two guards cannot ping-pong.
  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  if (status === "loading") return <Loader fullScreen label="Checking your session…" />;
  if (status === "authenticated") return <Loader fullScreen label="Signing you in…" />;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Admin sign in</CardTitle>
          <CardDescription>CDR Central Radio dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "error" && (
            <p role="status" className="text-sm text-muted-foreground">
              We couldn&apos;t check for an existing session. The server may be unreachable; you can
              still try to sign in.
            </p>
          )}
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}

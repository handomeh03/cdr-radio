"use client";

import { useState } from "react";
import { LogOutIcon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api-error";
import { useAuth } from "@/store/auth-context";

/** Signed-in user's email and role, plus a confirmed sign-out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await logout();
      setConfirmOpen(false);
      toast.success("Signed out");
      // The route guard sends the user to /login once the session is gone.
    } catch (error) {
      // Still signed in on the server: say so, and keep the dashboard open.
      setConfirmOpen(false);
      toast.error(getErrorMessage(error, "Could not sign out. Please try again."));
    } finally {
      setSigningOut(false);
    }
  }

  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right text-sm leading-tight sm:block">
        <div className="font-medium">{user.email}</div>
        <div className="text-xs text-muted-foreground">{user.role === "ADMIN" ? "Admin" : "Operator"}</div>
      </div>
      <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
        <LogOutIcon aria-hidden="true" />
        Sign out
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out?"
        description="You will need to sign in again to manage the station. Signing out does not affect the live stream."
        confirmLabel="Sign out"
        loading={signingOut}
        onConfirm={handleLogout}
      />
    </div>
  );
}

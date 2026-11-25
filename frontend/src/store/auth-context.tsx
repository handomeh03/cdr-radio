"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setUnauthorizedHandler } from "@/config/axios";
import {
  authKeys,
  clearNonAuthCache,
  useLoginMutation,
  useLogoutMutation,
  useMeQuery,
} from "@/features/auth/hooks/use-auth-queries";
import type { AuthStatus, AuthUser, LoginCredentials } from "@/features/auth/types";

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  /** Signs in; rejects with an ApiError (wrong password, rate limit, network...). */
  login: (credentials: LoginCredentials) => Promise<AuthUser>;
  /** Ends the session on the server; rejects (and stays signed in) if that fails. */
  logout: () => Promise<void>;
  /** Re-checks the session, e.g. when status is "error". */
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Exposes who is signed in. The user lives in the TanStack Query cache (GET /auth/me); this
 * context only derives status and wraps login/logout, so there is no second copy to keep in sync.
 * The JWT is an HttpOnly cookie: it is never readable here and never stored in web storage.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const me = useMeQuery();
  const { mutateAsync: loginAsync } = useLoginMutation();
  const { mutateAsync: logoutAsync } = useLogoutMutation();
  const { refetch } = me;

  const user = me.data ?? null;
  const status: AuthStatus = user
    ? "authenticated"
    : me.isPending
      ? "loading"
      : me.isError
        ? "error"
        : "unauthenticated";

  // A 401 from any other endpoint means the session expired: sign out locally. Navigation is left
  // to the route guards, which keeps this free of redirect loops.
  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        if (!queryClient.getQueryData(authKeys.me)) return;
        queryClient.setQueryData<AuthUser | null>(authKeys.me, null);
        clearNonAuthCache(queryClient);
        toast.info("Your session has expired. Please sign in again.");
      }),
    [queryClient],
  );

  const login = useCallback(
    async (credentials: LoginCredentials) => (await loginAsync(credentials)).user,
    [loginAsync],
  );
  const logout = useCallback(async () => {
    await logoutAsync();
  }, [logoutAsync]);
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, refresh }),
    [user, status, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

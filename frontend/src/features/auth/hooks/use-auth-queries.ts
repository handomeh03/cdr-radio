"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isUnauthorized } from "@/lib/api-error";
import { authService } from "../services/auth.service";
import type { AuthUser, LoginCredentials } from "../types";

/** Cache key of the current user. `null` is a valid cached value: "known to be signed out". */
export const authKeys = { me: ["auth", "me"] as const };

/** Drops every cached query except auth, so one account's data is never shown to the next. */
export function clearNonAuthCache(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
}

/**
 * Session rehydration (GET /auth/me). A 401 is an answer ("not signed in"), not a failure, so it
 * resolves to null; anything else (backend down, 5xx) stays an error and is not mistaken for a logout.
 */
export function useMeQuery() {
  return useQuery<AuthUser | null>({
    queryKey: authKeys.me,
    queryFn: async () => {
      try {
        return (await authService.me()).user;
      } catch (error) {
        if (isUnauthorized(error)) return null;
        throw error;
      }
    },
    retry: false,
    // Re-checked when the tab regains focus, which also notices an expired cookie.
    staleTime: 60_000,
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: LoginCredentials) => authService.login(credentials),
    onSuccess: ({ user }) => {
      clearNonAuthCache(queryClient);
      queryClient.setQueryData<AuthUser | null>(authKeys.me, user);
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authService.logout(),
    onSuccess: () => {
      queryClient.setQueryData<AuthUser | null>(authKeys.me, null);
      clearNonAuthCache(queryClient);
    },
  });
}

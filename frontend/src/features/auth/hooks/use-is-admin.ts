"use client";

import { useAuth } from "@/store/auth-context";

/**
 * True when the signed-in user is an ADMIN. This only decides which controls are shown:
 * the backend enforces roles on every request (OPERATORs get 403 on management routes).
 */
export function useIsAdmin(): boolean {
  return useAuth().user?.role === "ADMIN";
}

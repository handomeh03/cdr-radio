import type { Metadata } from "next";
import { AuthProvider } from "@/store/auth-context";

// Admin pages are not for search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Wraps only the admin routes (/login, /dashboard...) so the session check (GET /auth/me) never
 * runs for public listeners. Staying mounted across /login <-> /dashboard keeps the session state.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

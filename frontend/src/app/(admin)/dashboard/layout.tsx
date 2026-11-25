import type { Metadata } from "next";
import { AppHeader } from "@/components/shared/app-header";
import { MainNav, type NavItem } from "@/components/shared/main-nav";
import { AuthGuard } from "@/features/auth/components/auth-guard";
import { UserMenu } from "@/features/auth/components/user-menu";

export const metadata: Metadata = { title: { default: "Dashboard", template: "%s · CDR Central Radio" } };

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/dashboard", exact: true },
  { label: "Tracks", href: "/dashboard/tracks" },
  { label: "Playlists", href: "/dashboard/playlists" },
  { label: "Station", href: "/dashboard/station" },
];

/** Protected shell: nothing inside renders until the session is confirmed. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <AppHeader
          title="CDR Central Radio"
          nav={<MainNav items={NAV_ITEMS} />}
          actions={<UserMenu />}
        />
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 p-4 outline-none">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}

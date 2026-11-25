"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "@/config/query-client";

/** Client-side providers shared by every page. Auth is provided separately, only where needed. */
export function Providers({ children }: { children: React.ReactNode }) {
  // One QueryClient per browser session; useState keeps it stable across re-renders.
  const [queryClient] = useState(makeQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

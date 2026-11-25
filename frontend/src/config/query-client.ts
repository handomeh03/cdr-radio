import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api-error";

/** Retry once, and only for failures that may be temporary (no response, or a 5xx). */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  return !isApiError(error) || error.status === null || error.status >= 500;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}

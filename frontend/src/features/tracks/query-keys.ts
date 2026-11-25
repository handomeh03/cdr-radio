import type { ListTracksParams } from "./types";

/** Query keys of the tracks feature. `all` invalidates every track query. */
export const trackKeys = {
  all: ["tracks"] as const,
  list: (params: ListTracksParams) => ["tracks", "list", params] as const,
};

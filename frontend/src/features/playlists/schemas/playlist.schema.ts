import { z } from "zod";

/** Mirror the backend's PLAYLIST_NAME_MAX / PLAYLIST_DESCRIPTION_MAX. */
export const PLAYLIST_NAME_MAX = 100;
export const PLAYLIST_DESCRIPTION_MAX = 500;

export const playlistSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name")
    .max(PLAYLIST_NAME_MAX, `Name must be at most ${PLAYLIST_NAME_MAX} characters`),
  description: z
    .string()
    .trim()
    .max(PLAYLIST_DESCRIPTION_MAX, `Description must be at most ${PLAYLIST_DESCRIPTION_MAX} characters`),
});
export type PlaylistFormValues = z.infer<typeof playlistSchema>;

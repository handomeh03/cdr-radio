import { z } from "zod";

/** The two settings an admin can change. A null playlist means "no playlist" (standby tone only). */
export const stationControlSchema = z.object({
  activePlaylistId: z.uuid().nullable(),
  desiredStatus: z.enum(["ON_AIR", "OFF_AIR"]),
});
export type StationControlValues = z.infer<typeof stationControlSchema>;

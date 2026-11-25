/** What the admin has asked for. OFF_AIR means the standby tone plays; the stream itself keeps running. */
export type DesiredStatus = "ON_AIR" | "OFF_AIR";

/** GET /stations/main (public). Settings only: this is not proof of what is on air. */
export interface Station {
  slug: string;
  name: string;
  desiredStatus: DesiredStatus;
  updatedAt: string;
  activePlaylist: { id: string; name: string; trackCount: number } | null;
}

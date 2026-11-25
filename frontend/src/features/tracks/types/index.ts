import type { Page } from "@/types/pagination";

export type TrackStatus = "PROCESSING" | "READY" | "FAILED";

/** A track as returned by the API. The storage key and URLs are never exposed. */
export interface Track {
  id: string;
  title: string;
  artist: string | null;
  status: TrackStatus;
  /** Length of the processed MP3; null until READY. */
  durationMs: number | null;
  /** Container detected for the original upload (e.g. "wav", "flac"). */
  sourceFormat: string | null;
  /** Size of the processed MP3 in bytes; null until READY. */
  sizeBytes: number | null;
  /** Safe failure reason when status is FAILED. */
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TrackPage = Page<Track>;

export interface ListTracksParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: TrackStatus;
}

/** PATCH /tracks/:id. An empty or null artist clears it. */
export interface UpdateTrackInput {
  title: string;
  artist: string | null;
}

/** POST /tracks (multipart: `file` plus optional `title` and `artist`). */
export interface UploadTrackInput {
  file: File;
  title?: string;
  artist?: string;
}

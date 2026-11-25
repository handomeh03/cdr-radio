import { api } from "@/config/axios";
import type { ListTracksParams, Track, TrackPage, UpdateTrackInput, UploadTrackInput } from "../types";

/** Processing takes roughly 1-3 s per minute of audio on top of the upload, so allow plenty of time. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

export const tracksService = {
  async list(params: ListTracksParams): Promise<TrackPage> {
    const { data } = await api.get<TrackPage>("/tracks", {
      // Empty values are omitted so the backend applies its defaults.
      params: { ...params, search: params.search || undefined, status: params.status || undefined },
    });
    return data;
  },

  /**
   * Multipart upload. The `file` field and optional `title`/`artist` match the backend's
   * FileInterceptor and UploadTrackDto. No Content-Type header is set: the browser adds the
   * multipart boundary itself.
   */
  async upload(input: UploadTrackInput, onProgress?: (percent: number) => void): Promise<Track> {
    const form = new FormData();
    if (input.title) form.append("title", input.title);
    if (input.artist) form.append("artist", input.artist);
    form.append("file", input.file);

    const { data } = await api.post<Track>("/tracks", form, {
      timeout: UPLOAD_TIMEOUT_MS,
      onUploadProgress: (event) => {
        if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100));
      },
    });
    return data;
  },

  async update(id: string, input: UpdateTrackInput): Promise<Track> {
    const { data } = await api.patch<Track>(`/tracks/${id}`, input);
    return data;
  },

  /** 204 No Content. 409 when the track is used by a playlist or still processing. */
  async remove(id: string): Promise<void> {
    await api.delete(`/tracks/${id}`);
  },
};

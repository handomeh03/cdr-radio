import { z } from "zod";
import { env } from "@/config/env";

/** Mirrors the backend's TITLE_MAX / ARTIST_MAX. */
export const TRACK_TEXT_MAX = 200;

/** Formats the backend accepts (it verifies the real content, not the extension). */
export const SUPPORTED_AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac"] as const;
export const AUDIO_ACCEPT = SUPPORTED_AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(",");

const maxBytes = env.audioUploadMaxMb * 1024 * 1024;
const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

const optionalText = (label: string) =>
  z.string().trim().max(TRACK_TEXT_MAX, `${label} must be at most ${TRACK_TEXT_MAX} characters`);

/** Client-side checks for a quick, friendly answer. The server still validates everything. */
export const uploadTrackSchema = z.object({
  file: z
    .custom<File>((value) => value instanceof File, { message: "Choose an audio file" })
    .refine((file) => file.size > 0, "The file is empty")
    .refine((file) => file.size <= maxBytes, `The file is larger than ${env.audioUploadMaxMb} MB`)
    .refine(
      (file) => (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(file.name)),
      "Unsupported file type. Use MP3, WAV, M4A/AAC, OGG or FLAC",
    ),
  title: optionalText("Title"),
  artist: optionalText("Artist"),
});
export type UploadTrackFormValues = z.infer<typeof uploadTrackSchema>;

export const editTrackSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(TRACK_TEXT_MAX, `Title must be at most ${TRACK_TEXT_MAX} characters`),
  artist: optionalText("Artist"),
});
export type EditTrackFormValues = z.infer<typeof editTrackSchema>;

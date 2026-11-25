/**
 * Public (browser-safe) settings. NEXT_PUBLIC_* values must be read as literal
 * `process.env.NEXT_PUBLIC_X` expressions so Next.js can inline them at build time.
 * Server-only values are read in next.config.ts and never appear in browser code.
 */
export const env = {
  /** Base URL of the REST API: the same-origin rewrite, not the backend's own address. */
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "/api",
  /**
   * Origin of the real-time metadata server (Socket.IO). Separate from the REST rewrite, and read
   * by the browser: "localhost" only works on the PC running the backend. Null disables real-time
   * updates; the app then polls REST instead.
   */
  socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || null,
  /** Public live stream (the Icecast mount), if configured. */
  streamUrl: process.env.NEXT_PUBLIC_STREAM_URL || null,
  /**
   * Upload limit shown to users and checked before uploading. Keep equal to the backend's
   * AUDIO_UPLOAD_MAX_MB; the server enforces the real limit either way.
   */
  audioUploadMaxMb: Number(process.env.NEXT_PUBLIC_AUDIO_UPLOAD_MAX_MB) || 25,
} as const;

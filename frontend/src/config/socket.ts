import { io, type Socket } from "socket.io-client";
import { env } from "./env";

/** The /radio namespace is public and read-only: no cookies, no credentials, nothing to send. */
const NAMESPACE = "/radio";

/**
 * Creates the Socket.IO client for the real-time metadata feed, configured but NOT connected.
 * Call it once (the realtime manager owns the single instance). Returns null when
 * NEXT_PUBLIC_SOCKET_URL is not set. Socket.IO reconnects by itself with a growing delay.
 */
export function createRadioSocket(): Socket | null {
  if (!env.socketUrl) return null;
  return io(`${env.socketUrl.replace(/\/+$/, "")}${NAMESPACE}`, {
    autoConnect: false,
    withCredentials: false,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 8_000,
  });
}

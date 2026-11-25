import { isAxiosError } from "axios";
import type { ApiErrorBody } from "@/types/api";

export type ApiErrorKind = "network" | "timeout" | "canceled" | "http";

/** The only error type that leaves the Axios instance, so callers never touch raw Axios errors. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    /** HTTP status, or null when there was no response (network, timeout, canceled). */
    readonly status: number | null,
    message: string,
    /** Server-provided messages (e.g. validation), already safe to show for 4xx responses. */
    readonly details: string[] = [],
    /** The parsed error body, for fields beyond `message` (e.g. `settingsSaved`, `trackId`). */
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Reads one extra field from an error body, e.g. whether settings were saved despite a failure. */
export function getErrorField(error: unknown, key: string): unknown {
  return isApiError(error) ? (error.body?.[key] ?? null) : null;
}

export const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError;

export const isUnauthorized = (error: unknown): boolean =>
  isApiError(error) && error.status === 401;

function messagesFrom(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const { message } = body as ApiErrorBody;
  if (Array.isArray(message)) return message.filter((m) => typeof m === "string");
  return typeof message === "string" ? [message] : [];
}

/** Converts anything thrown by Axios into an ApiError with a user-safe message. */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  if (!isAxiosError(error)) {
    return new ApiError("network", null, "Something went wrong. Please try again.");
  }
  if (error.code === "ERR_CANCELED") {
    return new ApiError("canceled", null, "The request was canceled.");
  }
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
    return new ApiError("timeout", null, "The server took too long to respond.");
  }
  if (!error.response) {
    return new ApiError(
      "network",
      null,
      "Cannot reach the server. Check your connection and try again.",
    );
  }

  const { status, data } = error.response;
  const details = messagesFrom(data);
  const body = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (status === 429) {
    return new ApiError("http", status, "Too many attempts. Please wait a minute and try again.", [], body);
  }
  // 502/503/504 carry deliberate, user-safe messages from the backend (storage or playout engine
  // problems, e.g. "Settings were saved, but the live stream was not updated"). Other 5xx stay generic.
  if (status === 502 || status === 503 || status === 504) {
    return new ApiError(
      "http",
      status,
      details[0] ?? "A service the server depends on did not respond. Please try again shortly.",
      details,
      body,
    );
  }
  if (status >= 500) {
    // Never surface server internals.
    return new ApiError("http", status, "The server had a problem. Please try again shortly.", [], body);
  }
  return new ApiError("http", status, details[0] ?? "The request could not be completed.", details, body);
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  return isApiError(error) ? error.message : fallback;
}

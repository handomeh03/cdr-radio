import axios from "axios";
import { env } from "@/config/env";
import { toApiError } from "@/lib/api-error";

/**
 * The one Axios instance of the app. Requests go to the same-origin /api rewrite and carry the
 * browser-managed HttpOnly auth cookie; JavaScript never sees or stores the token.
 */
export const api = axios.create({
  baseURL: env.apiUrl,
  withCredentials: true,
  timeout: 15_000,
  headers: { Accept: "application/json" },
});

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Lets the auth layer react to an expired session without the interceptor navigating by itself
 * (navigation from here is what causes redirect loops). Returns an unsubscribe function.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

/** 401 is an expected answer here (wrong password, no session yet, already logged out). */
const SESSION_ENDPOINTS = ["/auth/login", "/auth/me", "/auth/logout"];

// Registered once, centrally: every failure becomes an ApiError; a 401 from any other endpoint
// means the session expired.
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiError(error);
    const url = axios.isAxiosError(error) ? (error.config?.url ?? "") : "";
    if (apiError.status === 401 && !SESSION_ENDPOINTS.some((path) => url.startsWith(path))) {
      unauthorizedHandler?.();
    }
    return Promise.reject(apiError);
  },
);

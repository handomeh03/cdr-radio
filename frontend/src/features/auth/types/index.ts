/** Mirrors the backend's Role enum. Authorization is enforced by the backend; this only shapes the UI. */
export type UserRole = "ADMIN" | "OPERATOR";

/** The backend's SafeUser: never includes a password hash. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

/** POST /auth/login */
export interface LoginResponse {
  user: AuthUser;
  /** When the session cookie expires (ISO 8601). */
  expiresAt: string;
}

/** GET /auth/me */
export interface MeResponse {
  user: AuthUser;
}

/** loading: checking the session. error: could not check it (e.g. backend unreachable). */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

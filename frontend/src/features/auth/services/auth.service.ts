import { api } from "@/config/axios";
import type { LoginCredentials, LoginResponse, MeResponse } from "../types";

/** Thin wrappers over the backend's auth routes (via the shared Axios instance). */
export const authService = {
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>("/auth/login", credentials);
    return data;
  },

  async me(): Promise<MeResponse> {
    const { data } = await api.get<MeResponse>("/auth/me");
    return data;
  },

  /** 204 No Content; the backend clears the HttpOnly cookie. */
  async logout(): Promise<void> {
    await api.post("/auth/logout");
  },
};

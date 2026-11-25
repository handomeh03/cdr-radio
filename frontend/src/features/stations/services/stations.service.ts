import { api } from "@/config/axios";
import type { Station } from "../types";

export const stationsService = {
  async getMain(): Promise<Station> {
    const { data } = await api.get<Station>("/stations/main");
    return data;
  },
  // PATCH /stations/main only saves settings and never changes the live audio. The dashboard
  // always uses POST /stations/main/playback/apply (features/playback), which saves AND applies.
};

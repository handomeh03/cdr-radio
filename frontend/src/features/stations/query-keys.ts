/** Query keys of the stations feature (settings of the single "main" station). */
export const stationKeys = {
  all: ["station"] as const,
  main: ["station", "main"] as const,
};

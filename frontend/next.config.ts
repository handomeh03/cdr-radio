import type { NextConfig } from "next";

/**
 * Server-only destination of the /api rewrite (never exposed to the browser).
 * Validated here so a missing or malformed value fails loudly at startup.
 */
function apiProxyTarget(): string {
  const raw = process.env.API_PROXY_TARGET;
  if (!raw) {
    throw new Error(
      "API_PROXY_TARGET is not set. Copy frontend/.env.example to frontend/.env.local.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("API_PROXY_TARGET must be a valid http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_PROXY_TARGET must use http or https.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    // Track uploads (up to 25 MB of audio plus multipart overhead) pass through the /api rewrite.
    // Next.js buffers proxied request bodies and the default limit is 10 MB.
    proxyClientMaxBodySize: "30mb",
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Browser REST calls stay same-origin (/api/...) and are proxied to NestJS, so the HttpOnly
  // auth cookie is first-party and the browser's Origin header matches the backend's
  // FRONTEND_URL. Socket.IO and the audio stream use their own public URLs.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiProxyTarget()}/:path*` }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@pharmerp/types"],
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    return [
      {
        // The worker script must never be served from the HTTP cache. If a
        // stale sw.js is returned, the browser sees identical bytes, decides
        // nothing changed, and the new build is never picked up.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@pharmerp/types"],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;

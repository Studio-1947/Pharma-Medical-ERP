import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pharmerp/types"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;

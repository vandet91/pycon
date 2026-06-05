import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Monaco editor worker files
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false };
    return config;
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@conductor/core", "@conductor/github"],
};

export default nextConfig;

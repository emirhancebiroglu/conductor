import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@conductor/core", "@conductor/github"],
  webpack(config) {
    // transpilePackages resolves .ts source directly; .js extensions in ESM
    // imports inside those packages need to be remapped to .ts files.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  },
};

export default nextConfig;

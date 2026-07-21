import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Azure App Service receives a self-contained Node.js artifact. Vinext/Sites
  // continues to use vite.config.ts and is unaffected by this output mode.
  output: "standalone",
};

export default nextConfig;

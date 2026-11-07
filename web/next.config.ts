import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The sync reads data/countries/*.json and data/stats/*.csv at runtime;
  // make sure they are deployed with the admin page.
  outputFileTracingIncludes: {
    '/admin': ['./data/**/*'],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

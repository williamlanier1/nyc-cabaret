import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 👇 make sure we are NOT exporting static HTML
  // no `output: 'export'` here
  eslint: {
    // Vercel build should not fail on lint errors
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

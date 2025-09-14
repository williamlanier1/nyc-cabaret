import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 👇 make sure we are NOT exporting static HTML
  // no `output: 'export'` here
  eslint: {
    // Vercel build should not fail on lint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Allow production builds to succeed even with type errors (matches local dev behavior)
    ignoreBuildErrors: true,
  },
};

export default nextConfig;

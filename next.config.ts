import type { NextConfig } from "next";

// Static export for GitHub Pages. The deploy workflow sets NEXT_PUBLIC_BASE_PATH
// to "/<repo-name>"; locally it is empty so `npm run dev` serves from "/".
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;

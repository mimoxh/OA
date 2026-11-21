import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许在同一目录并行运行多个 dev 实例（每个实例使用不同 distDir）
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["better-sqlite3"],
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

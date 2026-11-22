import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许在同一目录并行运行多个 dev 实例（每个实例使用不同 distDir）
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // dev 下允许通过 127.0.0.1 访问（预览代理 / e2e 多会话）
  allowedDevOrigins: ["127.0.0.1"],
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

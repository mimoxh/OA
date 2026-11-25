import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "out/**",
    "build/**",
    "desktop/**",
    "next-env.d.ts",
    // 本地调试脚本与数据目录（均在 .gitignore 中）
    ".tmp/**",
    ".standalone-out/**",
    ".devtest/**",
    "database_server/**",
    "storage/**",
  ]),
]);

export default eslintConfig;

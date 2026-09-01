import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    include: ["**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.worktrees/**",
      ".atlante/**",
      "**/reports/**",
      "**/coverage/**",
      // Built-output assertions require a freshly built website dist tree.
      "website/scripts/website-output.test.ts",
      // Built-output assertions require a freshly built docs dist tree.
      "docs/scripts/docs-output.test.ts",
    ],
  },
});

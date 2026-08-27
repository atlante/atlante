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
      "**/mutation/**",
      "**/reports/**",
      "**/coverage/**",
      ".stryker-tmp/**",
    ],
  },
});

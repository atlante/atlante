import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: true,
    include: ["**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ".atlante/**",
      "**/mutation/**",
      "**/reports/**",
      "**/coverage/**",
    ],
  },
});

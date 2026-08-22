const workspace = process.env.ATLANTE_MUTATION_WORKSPACE;
const allowed = new Set(["schema", "resources", "validator"]);

if (!workspace || !allowed.has(workspace)) {
  throw new Error(
    "ATLANTE_MUTATION_WORKSPACE must be schema, resources, or validator",
  );
}

const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  concurrency: 1,
  // Sandboxes keep source restoration independent from signal handling.
  inPlace: false,
  vitest: { configFile: "vitest.config.ts", related: false },
  testFiles: ["packages/*/test/**/*.test.ts", "scripts/*.test.ts"],
  mutate: [`packages/${workspace}/src/**/*.ts`],
  reporters: ["clear-text", "html", "json", "progress"],
  htmlReporter: { fileName: `mutation/${workspace}/mutation.html` },
  jsonReporter: { fileName: `mutation/${workspace}/mutation.json` },
  incrementalFile: `mutation/${workspace}/incremental.json`,
  tempDirName: `mutation/${workspace}/temp-${process.pid}`,
  cleanTempDir: "always",
  testRunnerNodeArgs: ["--enable-source-maps"],
  ignorePatterns: ["**/*.d.ts", "**/dist/**", "**/generated/**"],
};

export default config;

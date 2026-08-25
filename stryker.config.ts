import {
  mutationReportPath,
  resolveMutationRoot,
} from "./scripts/mutation-root.ts";

const workspace = process.env.ATLANTE_MUTATION_WORKSPACE;
const allowed = new Set(["schema", "resources", "validator"]);

if (!workspace || !allowed.has(workspace)) {
  throw new Error(
    "ATLANTE_MUTATION_WORKSPACE must be schema, resources, or validator",
  );
}

const mutationRoot = resolveMutationRoot(
  process.env.ATLANTE_MUTATION_ROOT,
  process.cwd(),
);
const reportPath = (name: string): string =>
  mutationReportPath(mutationRoot, workspace, name);

const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  concurrency: 1,
  // Recycle the Vitest child runner before mutant state can accumulate.
  maxTestRunnerReuse: 50,
  // Keep mutant executions finite. Adequacy is established only by the final
  // campaign, not by this configuration check.
  timeoutMS: 5_000,
  // Stryker 10 cannot execute module-initializer mutants after import. Schema
  // boundary tests still exercise the resulting runtime contracts directly.
  ignoreStatic: workspace === "schema",
  // Sandboxes keep source restoration independent from signal handling.
  inPlace: false,
  vitest: { configFile: "vitest.config.ts", related: false },
  testFiles: [
    "packages/*/test/**/*.test.ts",
    "scripts/mutation.test.ts",
    "scripts/mutation-root.test.ts",
  ],
  mutate: [`packages/${workspace}/src/**/*.ts`],
  reporters: ["clear-text", "html", "json", "progress"],
  htmlReporter: { fileName: reportPath("mutation.html") },
  jsonReporter: { fileName: reportPath("mutation.json") },
  incrementalFile: reportPath("incremental.json"),
  tempDirName: reportPath(`temp-${process.pid}`),
  cleanTempDir: "always",
  testRunnerNodeArgs: ["--enable-source-maps"],
  ignorePatterns: [
    "**/*.d.ts",
    "**/dist/**",
    "**/generated/**",
    // Stryker's crawler treats a leading slash as cwd-relative exact matching.
    // Use the repository-relative directory glob so it prunes mutation trees.
    "mutation/**",
  ],
};

export default config;

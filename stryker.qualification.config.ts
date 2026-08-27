import baseConfig from "./stryker.config.ts";

const outputDirectory = process.env.ATLANTE_QUALIFICATION_OUTPUT_DIR;
if (!outputDirectory) {
  throw new Error("ATLANTE_QUALIFICATION_OUTPUT_DIR is required");
}

const testFiles = [
  "packages/schema/test/qualification-fixture.test.ts",
  "packages/schema/test/qualification-fixture-failing.test.ts",
];

export default {
  ...baseConfig,
  testFiles,
  mutate: ["packages/schema/test/qualification-fixture.ts"],
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: `${outputDirectory}/report.json` },
  incrementalFile: `${outputDirectory}/incremental.json`,
  tempDirName: `.atlante/qualification/${process.pid}`,
  cleanTempDir: "always",
};

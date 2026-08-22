import baseConfig from "./stryker.config.ts";

export default {
  ...baseConfig,
  plugins: [...baseConfig.plugins, "./scripts/stryker-suite-reporter.ts"],
  reporters: ["suite-parity"],
  dryRunOnly: true,
};

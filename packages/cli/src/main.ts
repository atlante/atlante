import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { runBuild } from "./commands/build.js";
import { runBuildWatch } from "./commands/build-watch.js";
import { runInit } from "./commands/init.js";
import { runValidate } from "./commands/validate.js";

export { runBuild } from "./commands/build.js";
export { runBuildWatch } from "./commands/build-watch.js";
export { runInit } from "./commands/init.js";
export { runValidate } from "./commands/validate.js";
export { formatDiagnostic } from "./report.js";

export function createProgram(): Command {
  const program = new Command()
    .name("atlante")
    .description("Structured, versionable prompts for AI coding harnesses")
    .version(packageJson.version);

  program
    .command("validate")
    .argument("[path]", "config file or project directory", process.cwd())
    .description("validate an Atlante configuration")
    .action(async (path: string) => {
      process.exitCode = await runValidate(path);
    });

  program
    .command("build")
    .argument("[path]", "config file or project directory", process.cwd())
    .option("--watch", "rebuild on changes to config and selected resources")
    .description("build host-independent Atlante artifacts")
    .action((path: string, options: { watch?: boolean }) => {
      if (options.watch) {
        // Fire-and-forget: watch manages its own lifetime via SIGINT.
        void runBuildWatch(path);
      } else {
        process.exitCode = runBuild(path);
      }
    });

  program
    .command("init")
    .argument("[path]", "project directory", process.cwd())
    .option(
      "--pack <locator>",
      "pack locator to install and extend; use <pack>/<preset> to select a preset explicitly",
    )
    .option("--force", "overwrite an existing Atlante config")
    .description("scaffold an Atlante configuration")
    .action(
      async (path: string, options: { pack?: string; force?: boolean }) => {
        process.exitCode = await runInit(path, options);
      },
    );

  return program;
}

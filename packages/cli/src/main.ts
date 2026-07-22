import { Command } from "commander";
import { runInit } from "./commands/init.ts";
import { runResolve } from "./commands/resolve.ts";
import { runValidate } from "./commands/validate.ts";

export { listPresets, presetName, readPreset } from "@atlante/presets";
export { runInit } from "./commands/init.ts";
export { runResolve } from "./commands/resolve.ts";
export { runValidate } from "./commands/validate.ts";
export { formatDiagnostic } from "./report.ts";

export function createProgram(): Command {
  const program = new Command()
    .name("atlante")
    .description("Structured, versionable prompts for AI coding harnesses")
    .version("0.1.0");

  program
    .command("validate")
    .argument("[path]", "config file or project directory", process.cwd())
    .description("validate an Atlante configuration")
    .action(async (path: string) => {
      process.exitCode = await runValidate(path);
    });

  program
    .command("resolve")
    .argument("[path]", "config file or project directory", process.cwd())
    .option("--agent <id>", "render only this host agent")
    .option("--json", "emit artifact descriptors as JSON")
    .description("render the resolved agent prompts")
    .action(
      async (path: string, options: { agent?: string; json?: boolean }) => {
        process.exitCode = await runResolve(path, options);
      },
    );

  program
    .command("init")
    .argument("[path]", "project directory", process.cwd())
    .option("--preset <name>", "scaffold from a bundled preset")
    .option("--force", "overwrite an existing Atlante config")
    .description("scaffold an Atlante configuration")
    .action(
      async (path: string, options: { preset?: string; force?: boolean }) => {
        process.exitCode = await runInit(path, options);
      },
    );

  return program;
}

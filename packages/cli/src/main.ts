import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { runInit } from "./commands/init.js";
import { runResolve } from "./commands/resolve.js";
import { runValidate } from "./commands/validate.js";

export { listPresets, readPreset } from "@atlante/presets";
export { runInit } from "./commands/init.js";
export { runResolve } from "./commands/resolve.js";
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
    .command("resolve")
    .argument("[path]", "config file or project directory", process.cwd())
    .option("--agent <id>", "render only this host agent")
    .option("--json", "emit artifact descriptors as JSON")
    .description("render resolved agent prompts and project skills")
    .action(
      async (path: string, options: { agent?: string; json?: boolean }) => {
        process.exitCode = await runResolve(path, options);
      },
    );

  program
    .command("init")
    .argument("[path]", "project directory", process.cwd())
    .option("--preset <name>", "preset to extend (default: starter)")
    .option("--force", "overwrite an existing Atlante config")
    .description("scaffold an Atlante configuration")
    .action(
      async (path: string, options: { preset?: string; force?: boolean }) => {
        process.exitCode = await runInit(path, options);
      },
    );

  return program;
}

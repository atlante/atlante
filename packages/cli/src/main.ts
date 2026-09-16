import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { runBuild } from "./commands/build.js";
import { runBuildWatch } from "./commands/build-watch.js";
import type { EvalCommandOptions } from "./commands/eval.js";
import { runEvalCommand } from "./commands/eval.js";
import {
  type ImportKind,
  parseImportKind,
  runImport,
} from "./commands/import.js";
import { runInit } from "./commands/init.js";
import { runMcp } from "./commands/mcp.js";
import {
  runPackInstall,
  runPackList,
  runPackUninstall,
} from "./commands/pack.js";
import { runValidate } from "./commands/validate.js";

/** Commander collector for repeatable options. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export { runBuild } from "./commands/build.js";
export { runBuildWatch } from "./commands/build-watch.js";
export { runEvalCommand } from "./commands/eval.js";
export { runImport } from "./commands/import.js";
export { runInit } from "./commands/init.js";
export { runMcp } from "./commands/mcp.js";
export {
  runPackInstall,
  runPackList,
  runPackUninstall,
} from "./commands/pack.js";
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
    .option("--dry-run", "preview planned writes without writing anything")
    .description("build host-native Atlante outputs")
    .action((path: string, options: { watch?: boolean; dryRun?: boolean }) => {
      if (options.watch === true && options.dryRun === true) {
        console.error(
          "error [invalid-options]: --dry-run cannot be used with --watch",
        );
        process.exitCode = 1;
        return;
      }
      if (options.watch) {
        // Fire-and-forget: watch manages its own lifetime via SIGINT.
        void runBuildWatch(path);
      } else {
        process.exitCode = runBuild(
          path,
          options.dryRun === true ? { dryRun: true } : undefined,
        );
      }
    });

  program
    .command("mcp")
    .description("run the read-only Atlante MCP server over stdio")
    .action(async () => {
      process.exitCode = await runMcp();
    });

  program
    .command("init")
    .argument("[path]", "project directory", process.cwd())
    .option(
      "--pack <locator>",
      "pack locator to install and extend; use <pack>/<preset> to select a preset explicitly",
    )
    .option("--force", "overwrite an existing Atlante config")
    .option("--no-mcp", "skip OpenCode MCP server registration")
    .option(
      "--opencode-version <version>",
      "select the OpenCode dialect when host detection is unavailable",
    )
    .description("scaffold an Atlante configuration")
    .action(
      async (
        path: string,
        options: {
          pack?: string;
          force?: boolean;
          mcp?: boolean;
          opencodeVersion?: string;
        },
      ) => {
        process.exitCode = await runInit(path, {
          pack: options.pack,
          force: options.force,
          noMcp: options.mcp === false,
          opencodeVersion: options.opencodeVersion,
        });
      },
    );

  program
    .command("import")
    .argument("<input>", "Markdown source file")
    .requiredOption("--out <dir>", "directory for the generated local pack")
    .requiredOption(
      "--kind <kind>",
      "import as an agent or skill",
      parseImportKind,
    )
    .option("--name <id>", "override the generated pack and resource ID")
    .description("import a Markdown agent or skill into a local pack")
    .action(
      (
        input: string,
        options: { out: string; kind: ImportKind; name?: string },
      ) => {
        process.exitCode = runImport(input, options.out, {
          kind: options.kind,
          ...(options.name === undefined ? {} : { name: options.name }),
        });
      },
    );

  const pack = program
    .command("pack")
    .description("manage Atlante pack dependencies");

  pack
    .command("install")
    .argument("<package>", "pack package name")
    .argument("[path]", "project directory", process.cwd())
    .description("install and validate an Atlante pack")
    .action(async (packageName: string, path: string) => {
      process.exitCode = await runPackInstall(path, packageName);
    });

  pack
    .command("uninstall")
    .argument("<package>", "pack package name")
    .argument("[path]", "project directory", process.cwd())
    .description("uninstall an unused Atlante pack")
    .action(async (packageName: string, path: string) => {
      process.exitCode = await runPackUninstall(path, packageName);
    });

  pack
    .command("list")
    .argument("[path]", "project directory", process.cwd())
    .description("list direct Atlante pack dependencies")
    .action(async (path: string) => {
      process.exitCode = await runPackList(path);
    });

  program
    .command("eval")
    .argument("[path]", "project directory", process.cwd())
    .option(
      "--scenario <name>",
      "run only the named scenario (repeatable)",
      collect,
      [],
    )
    .option("--trials <n>", "override the configured number of trials")
    .option("--json", "print the JSON report to stdout")
    .option(
      "--out <dir>",
      "write the report under this directory instead of <project>/.atlante/eval",
    )
    .option("--keep", "keep trial sandboxes for inspection")
    .description(
      "run eval scenarios against verified native outputs in isolated sandboxes",
    )
    .action(async (path: string, options: EvalCommandOptions) => {
      process.exitCode = await runEvalCommand(path, options);
    });

  return program;
}

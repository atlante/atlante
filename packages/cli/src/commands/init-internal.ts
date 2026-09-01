import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertRealProjectRoot,
  type BuildResult,
  buildProject as buildProjectDefault,
  type ProjectContext,
} from "@atlante/builder";
import { SCHEMA_URI } from "@atlante/schema";
import {
  formatDiagnostic,
  hasErrors,
  validateDocumentText,
} from "@atlante/validator";
import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from "jsonc-parser";
import {
  diagnosticPath,
  printDiagnostic,
  printDiagnostics,
} from "../report.js";

export type InitOptions = { preset?: string; force?: boolean };

type InitFileSystem = {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, contents: string) => void;
  unlinkSync: (path: string) => void;
};

type BuildFunction = (target: string, context: ProjectContext) => BuildResult;

export type InitDependencies = Partial<InitFileSystem> & {
  buildProject?: BuildFunction;
  context?: ProjectContext;
};

const defaultFileSystem: InitFileSystem = {
  existsSync,
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, contents) => writeFileSync(path, contents),
  unlinkSync,
};

type Snapshot = { exists: boolean; contents?: string };

type PluginOptions = Record<string, unknown>;
type PluginEntry = string | [string, PluginOptions];
type PluginPlan = {
  previous: Snapshot;
  contents: string;
  registered: boolean;
};

function bareConfig(preset = "@atlante/pack"): string {
  return `{
  "$schema": "${SCHEMA_URI}",

  // Extend the first-party package preset. You can override any value or agent
  // below; your local configuration takes precedence over the inherited one.
  "extends": ${JSON.stringify(preset)},
}
`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPluginEntry(value: unknown): value is PluginEntry {
  if (typeof value === "string") return true;
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    isObject(value[1])
  );
}

function pluginId(entry: PluginEntry): string {
  return typeof entry === "string" ? entry : entry[0];
}

function parseErrorSummary(text: string, errors: ParseError[]): string {
  return errors
    .map((parseError) => {
      const line = text.slice(0, parseError.offset).split("\n").length;
      return `${printParseErrorCode(parseError.error)} at line ${line}`;
    })
    .join(", ");
}

function formatInitError(
  code: string,
  message: string,
  extra: {
    source?: string;
    expected?: string;
    next?: string;
    cause?: string;
  } = {},
): string {
  return formatDiagnostic({
    severity: "error",
    code,
    message,
    ...extra,
    source: extra.source ? diagnosticPath(extra.source) : undefined,
  });
}

function snapshot(path: string, fileSystem: InitFileSystem): Snapshot {
  if (!fileSystem.existsSync(path)) return { exists: false };
  return { exists: true, contents: fileSystem.readFileSync(path, "utf8") };
}

function parsePluginEntries(
  path: string,
  text: string,
): PluginEntry[] | { error: string } {
  const parseErrors: ParseError[] = [];
  const parsed = parse(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (parseErrors.length > 0 || !isObject(parsed)) {
    return {
      error: formatInitError(
        "invalid-opencode-configuration",
        "could not update the OpenCode configuration",
        {
          source: path,
          expected:
            '"plugin" must be an array of strings or [name, options-object] tuples',
          next: "fix the configuration and run `atlante init` again",
          cause: parseErrors.length
            ? `malformed JSONC: ${parseErrorSummary(text, parseErrors)}`
            : "the document is not a JSON object",
        },
      ),
    };
  }

  const plugin = parsed.plugin;
  if (
    plugin !== undefined &&
    (!Array.isArray(plugin) || !plugin.every(isPluginEntry))
  ) {
    return {
      error: formatInitError(
        "invalid-opencode-configuration",
        "could not update the OpenCode configuration",
        {
          source: path,
          expected:
            '"plugin" must be an array of strings or [name, options-object] tuples',
          next: "fix the configuration and run `atlante init` again",
          cause: 'the "plugin" field has an invalid value',
        },
      ),
    };
  }

  return Array.isArray(plugin) ? plugin : [];
}

/**
 * Resolves the OpenCode config file to register the plugin in. Prefers an
 * existing `opencode.jsonc`, falls back to an existing `opencode.json`
 * (OpenCode discovers both, and JSON is valid JSONC), and only defaults to
 * creating `opencode.jsonc` when neither exists.
 */
function opencodeConfigPath(
  directory: string,
  fileSystem: InitFileSystem,
): string {
  const jsonc = join(directory, "opencode.jsonc");
  if (fileSystem.existsSync(jsonc)) return jsonc;
  const json = join(directory, "opencode.json");
  if (fileSystem.existsSync(json)) return json;
  return jsonc;
}

function preparePlugin(
  directory: string,
  fileSystem: InitFileSystem,
): PluginPlan | { error: string } {
  const path = opencodeConfigPath(directory, fileSystem);
  const previous = snapshot(path, fileSystem);

  const text = previous.exists
    ? (previous.contents ?? "")
    : `{
  "$schema": "https://opencode.ai/config.json"
}
`;
  const entries = parsePluginEntries(path, text);
  if ("error" in entries) return entries;
  if (entries.some((entry) => pluginId(entry) === "@atlante/opencode")) {
    return { previous, contents: text, registered: false };
  }

  const edits = modify(text, ["plugin"], [...entries, "@atlante/opencode"], {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  return { previous, contents: applyEdits(text, edits), registered: true };
}

function restore(
  path: string,
  before: Snapshot,
  fileSystem: InitFileSystem,
): string | undefined {
  try {
    if (before.exists) {
      fileSystem.writeFileSync(path, before.contents ?? "");
    } else if (fileSystem.existsSync(path)) {
      fileSystem.unlinkSync(path);
    }
  } catch (cause) {
    return `${path}: ${String(cause)}`;
  }
  return undefined;
}

function rollback(
  changes: Array<{ path: string; before: Snapshot }>,
  fileSystem: InitFileSystem,
): string[] {
  const errors: string[] = [];
  for (const change of changes) {
    const error = restore(change.path, change.before, fileSystem);
    if (error) errors.push(error);
  }
  return errors;
}

function mutationErrorMessage(
  message: string,
  cause: unknown,
  rollbackErrors: string[],
): string {
  const rollbackMessage =
    rollbackErrors.length > 0
      ? `; rollback failed for ${rollbackErrors.join(", ")}`
      : "";
  return formatInitError("initialization-failed", message, {
    next: "fix the reported error and run `atlante init` again",
    cause: [String(cause), rollbackMessage].filter(Boolean).join(""),
  });
}

function commitInitFiles(
  target: string,
  contents: string,
  alternate: string,
  opencode: string,
  before: { target: Snapshot; alternate: Snapshot },
  plugin: PluginPlan,
  fileSystem: InitFileSystem,
): { changes: Array<{ path: string; before: Snapshot }>; error?: string } {
  const changes: Array<{ path: string; before: Snapshot }> = [];
  try {
    changes.push({ path: target, before: before.target });
    fileSystem.writeFileSync(target, contents);

    if (plugin.registered) {
      changes.push({ path: opencode, before: plugin.previous });
      fileSystem.writeFileSync(opencode, plugin.contents);
    }

    if (before.alternate.exists) {
      changes.push({ path: alternate, before: before.alternate });
      fileSystem.unlinkSync(alternate);
    }
  } catch (cause) {
    return {
      changes: [],
      error: mutationErrorMessage(
        "could not complete initialization",
        cause,
        rollback(changes, fileSystem),
      ),
    };
  }
  return { changes };
}

function initPreflightError(
  target: string,
  alternate: string,
  options: InitOptions,
  fileSystem: InitFileSystem,
): string | undefined {
  const existing = [target, alternate].filter(fileSystem.existsSync);
  if (existing.length > 0 && !options.force) {
    return formatInitError(
      "configuration-exists",
      "configuration already exists",
      {
        source: existing.join(" and "),
        expected: "no existing configuration unless --force is provided",
        next: "pass --force to overwrite the existing configuration",
      },
    );
  }
  return undefined;
}

function preflightPreset(
  target: string,
  contents: string,
  context: ProjectContext,
): boolean {
  const validated = validateDocumentText(contents, target, {
    resourceContext: context,
  });
  if (!hasErrors(validated.diagnostics)) return true;
  printDiagnostics(validated.diagnostics);
  return false;
}

function buildAndReport(
  directory: string,
  target: string,
  changes: Array<{ path: string; before: Snapshot }>,
  fileSystem: InitFileSystem,
  buildProject: BuildFunction,
  context: ProjectContext,
): number {
  let built: BuildResult;
  try {
    built = buildProject(directory, context);
  } catch (cause) {
    console.error(
      mutationErrorMessage(
        "could not complete initialization",
        cause,
        rollback(changes, fileSystem),
      ),
    );
    return 1;
  }

  if (hasErrors(built.diagnostics)) {
    const rollbackErrors = rollback(changes, fileSystem);
    printDiagnostics(built.diagnostics);
    if (rollbackErrors.length > 0) {
      printDiagnostic({
        severity: "error",
        code: "rollback-failed",
        message: "could not restore initialization files",
        next: "restore the listed files manually before retrying `atlante init`",
        cause: rollbackErrors.join(", "),
      });
    }
    return 1;
  }
  printDiagnostics(built.diagnostics);
  for (const warning of built.warnings)
    printDiagnostic({
      severity: "warning",
      code: warning.code,
      message: warning.message,
      source: diagnosticPath(warning.path),
    });

  console.log(`created ${target}`);
  return 0;
}

export async function runInitWithDependencies(
  directory: string,
  options: InitOptions,
  dependencies: InitDependencies = {},
): Promise<number> {
  const fileSystem: InitFileSystem = {
    ...defaultFileSystem,
    ...dependencies,
  };
  const context = dependencies.context ?? {};
  const target = join(directory, "atlante.jsonc");
  const alternate = join(directory, "atlante.json");
  const opencode = opencodeConfigPath(directory, fileSystem);

  try {
    assertRealProjectRoot(directory);
    const preflightError = initPreflightError(
      target,
      alternate,
      options,
      fileSystem,
    );
    if (preflightError) {
      console.error(preflightError);
      return 1;
    }
    const contents = bareConfig(options.preset);
    if (!preflightPreset(target, contents, context)) return 1;

    const before = {
      target: snapshot(target, fileSystem),
      alternate: snapshot(alternate, fileSystem),
    };
    const plugin = preparePlugin(directory, fileSystem);
    if ("error" in plugin) {
      console.error(`error: ${plugin.error}`);
      return 1;
    }

    const committed = commitInitFiles(
      target,
      contents,
      alternate,
      opencode,
      before,
      plugin,
      fileSystem,
    );
    if (committed.error) {
      console.error(committed.error);
      return 1;
    }

    const result = buildAndReport(
      directory,
      target,
      committed.changes,
      fileSystem,
      dependencies.buildProject ?? buildProjectDefault,
      context,
    );
    if (result !== 0) return result;
    console.log(
      plugin.registered
        ? `registered @atlante/opencode in ${opencode}`
        : `@atlante/opencode is already registered in ${opencode}`,
    );
    return 0;
  } catch (cause) {
    printDiagnostic({
      severity: "error",
      code: "initialization-failed",
      message: "could not initialize the project",
      source: directory,
      next: "fix the reported error and run `atlante init` again",
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return 1;
  }
}

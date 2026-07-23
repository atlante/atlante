import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { listPresets, presetName, readPreset } from "@atlante/presets";
import { SCHEMA_URI } from "@atlante/schema";
import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from "jsonc-parser";

export type InitOptions = { preset?: string; force?: boolean };

type InitFileSystem = {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, contents: string) => void;
  unlinkSync: (path: string) => void;
};

export type InitDependencies = Partial<InitFileSystem>;

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

function bareConfig(projectName: string): string {
  return `{
  "$schema": "${SCHEMA_URI}",

  // Extend the bundled starter preset. You can override any value or agent
  // below; your local configuration takes precedence over the inherited one.
  "extends": "atlante/starter",

  // Override project-wide values from the preset.
  "values": {
    "project": ${JSON.stringify(projectName)},
  },
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
    const details = parseErrors.length
      ? ` (${parseErrorSummary(text, parseErrors)})`
      : "";
    return { error: `cannot update ${path}: malformed JSONC${details}` };
  }

  const plugin = parsed.plugin;
  if (
    plugin !== undefined &&
    (!Array.isArray(plugin) || !plugin.every(isPluginEntry))
  ) {
    return {
      error: `cannot update ${path}: "plugin" must be an array of strings or [name, options-object] tuples`,
    };
  }

  return Array.isArray(plugin) ? plugin : [];
}

function preparePlugin(
  directory: string,
  fileSystem: InitFileSystem,
): PluginPlan | { error: string } {
  const path = join(directory, "opencode.jsonc");
  const previous = snapshot(path, fileSystem);

  const text = previous.exists ? (previous.contents ?? "") : "{}";
  const entries = parsePluginEntries(path, text);
  if ("error" in entries) return entries;
  if (entries.some((entry) => pluginId(entry) === "@atlante/opencode-plugin")) {
    return { previous, contents: text, registered: false };
  }

  const edits = modify(
    text,
    ["plugin"],
    [...entries, "@atlante/opencode-plugin"],
    {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    },
  );
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
  return `error: ${message}: ${String(cause)}${rollbackMessage}`;
}

function commitInitFiles(
  target: string,
  contents: string,
  alternate: string,
  opencode: string,
  before: { target: Snapshot; alternate: Snapshot },
  plugin: PluginPlan,
  fileSystem: InitFileSystem,
): string | undefined {
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
    return mutationErrorMessage(
      "could not complete initialization",
      cause,
      rollback(changes, fileSystem),
    );
  }
  return undefined;
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
  const target = join(directory, "atlante.jsonc");
  const alternate = join(directory, "atlante.json");
  const opencode = join(directory, "opencode.jsonc");

  try {
    const existing = [target, alternate].filter(fileSystem.existsSync);
    if (existing.length > 0 && !options.force) {
      const wording =
        existing.length === 1 ? "already exists" : "already exist";
      console.error(
        `error: ${existing.join(" and ")} ${wording}; pass --force to overwrite`,
      );
      return 1;
    }

    let contents: string;
    if (options.preset) {
      const { presets, errors } = listPresets();
      for (const loadError of errors) {
        console.error(`warning: ${loadError.directory}: ${loadError.message}`);
      }
      const manifest = presets.find((m) => presetName(m) === options.preset);
      if (!manifest) {
        const known = presets.map(presetName).join(", ");
        console.error(
          `error: unknown preset "${options.preset}"; available: ${known}`,
        );
        return 1;
      }
      // Verify the preset document actually exists.
      const name = presetName(manifest);
      if (!readPreset(name)) {
        console.error(
          `error: preset "${manifest.id}" manifest found but document is missing or unreadable`,
        );
        return 1;
      }
      // Generate a minimal config that extends the selected preset.
      contents = JSON.stringify(
        {
          $schema: SCHEMA_URI,
          extends: manifest.id,
          values: { project: basename(directory) },
        },
        null,
        2,
      );
    } else {
      contents = bareConfig(basename(directory));
    }

    const before = {
      target: snapshot(target, fileSystem),
      alternate: snapshot(alternate, fileSystem),
    };
    const plugin = preparePlugin(directory, fileSystem);
    if ("error" in plugin) {
      console.error(`error: ${plugin.error}`);
      return 1;
    }

    const error = commitInitFiles(
      target,
      contents,
      alternate,
      opencode,
      before,
      plugin,
      fileSystem,
    );
    if (error) {
      console.error(error);
      return 1;
    }

    console.log(`created ${target}`);
    console.log(
      plugin.registered
        ? `registered @atlante/opencode-plugin in ${opencode}`
        : `@atlante/opencode-plugin is already registered in ${opencode}`,
    );
    return 0;
  } catch (cause) {
    console.error(`error: could not initialize ${directory}: ${String(cause)}`);
    return 1;
  }
}

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { listPresets, presetName, readPreset } from "@atlante/presets";
import { SCHEMA_URI } from "@atlante/schema";
import { applyEdits, modify, parse } from "jsonc-parser";

export type InitOptions = { preset?: string; force?: boolean };

export function bareConfig(projectName: string): string {
  return `{
  "$schema": "${SCHEMA_URI}",

  // Project-wide values. Reference them from any string below as {{values.x}};
  // the resolver substitutes them before the template is rendered.
  "values": {
    "project": ${JSON.stringify(projectName)},
  },

  // Each key is a host-agent ID owned by the harness.
  "agents": {
    "build": {
      "identity": "You are a software engineer working on {{values.project}}.",
      "mission": "Implement changes the user asks for, and nothing more.",
    },
  },
}
`;
}

/**
 * Adds the plugin to opencode.jsonc without discarding existing settings.
 * Returns whether it actually registered the plugin, so the caller can report
 * what happened instead of always claiming a fresh registration.
 */
function registerPlugin(directory: string): boolean {
  const path = join(directory, "opencode.jsonc");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "{}";
  const current = (parse(text) ?? {}) as { plugin?: string[] };

  if (current.plugin?.includes("@atlante/opencode-plugin")) return false;

  const plugins = [...(current.plugin ?? []), "@atlante/opencode-plugin"];
  const edits = modify(text, ["plugin"], plugins, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  writeFileSync(path, applyEdits(text, edits));
  return true;
}

export async function runInit(
  directory: string,
  options: InitOptions,
): Promise<number> {
  const target = join(directory, "atlante.jsonc");
  const alternate = join(directory, "atlante.json");
  const existing = [target, alternate].filter(existsSync);

  if (existing.length > 0 && !options.force) {
    const wording = existing.length === 1 ? "already exists" : "already exist";
    console.error(
      `error: ${existing.join(" and ")} ${wording}; pass --force to overwrite`,
    );
    return 1;
  }

  let contents: string;
  if (options.preset) {
    const preset = readPreset(options.preset);
    if (!preset) {
      const { presets, errors } = listPresets();
      for (const loadError of errors) {
        console.error(`warning: ${loadError.directory}: ${loadError.message}`);
      }
      const known = presets.map(presetName).join(", ");
      console.error(
        `error: unknown preset "${options.preset}"; available: ${known}`,
      );
      return 1;
    }
    contents = preset;
  } else {
    contents = bareConfig(basename(directory));
  }

  writeFileSync(target, contents);
  // Write the default target first so a failed overwrite never destroys the
  // only existing configuration. Remove an alternate only after that succeeds.
  if (existsSync(alternate)) {
    try {
      unlinkSync(alternate);
    } catch (cause) {
      console.error(
        `error: wrote ${target} but could not remove ${alternate}: ${String(cause)}`,
      );
      return 1;
    }
  }
  const registered = registerPlugin(directory);

  const opencodePath = join(directory, "opencode.jsonc");
  console.log(`created ${target}`);
  console.log(
    registered
      ? `registered @atlante/opencode-plugin in ${opencodePath}`
      : `@atlante/opencode-plugin is already registered in ${opencodePath}`,
  );
  return 0;
}

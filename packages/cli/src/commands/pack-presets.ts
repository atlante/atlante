import type { Dirent } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILENAMES } from "@atlante/resources";
import { formatInitError } from "./init-error.js";

export type PackPreset = Readonly<{
  /** Full preset locator, e.g. `@acme/pack` or `@acme/pack/strict`. */
  locator: string;
  /** Preset path relative to the pack root; empty for the default preset. */
  relpath: string;
}>;

const PRESET_MANIFESTS = new Set<string>(CONFIG_FILENAMES);

/**
 * Enumerates the presets a pack provides by convention: every directory in
 * the pack tree (excluding `node_modules`) that contains `atlante.jsonc` or
 * `atlante.json` is a preset. The pack root is the default preset; its
 * subdirectories are named presets. Results are deterministic.
 */
export function discoverPackPresets(
  packageName: string,
  packRoot: string,
): PackPreset[] {
  const presets: PackPreset[] = [];
  const walk = (relative: string): void => {
    const absolute = relative === "" ? packRoot : join(packRoot, relative);
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      // Unreadable directories contribute no presets.
      return;
    }
    if (
      entries.some(
        (entry) => entry.isFile() && PRESET_MANIFESTS.has(entry.name),
      )
    ) {
      presets.push({
        locator: relative === "" ? packageName : `${packageName}/${relative}`,
        relpath: relative,
      });
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      walk(relative === "" ? entry.name : `${relative}/${entry.name}`);
    }
  };
  walk("");
  presets.sort((left, right) => {
    if (left.relpath === "") return -1;
    if (right.relpath === "") return 1;
    return left.relpath < right.relpath
      ? -1
      : left.relpath > right.relpath
        ? 1
        : 0;
  });
  return presets;
}

export type PackPresetSelection = Readonly<{
  isInteractive: () => boolean;
  prompt: (query: string) => Promise<string>;
}>;

function availablePresets(presets: readonly PackPreset[]): string {
  return presets.map((preset) => preset.locator).join(", ");
}

function explicitPresetError(
  packageName: string,
  requested: string,
  presets: readonly PackPreset[],
): { error: string } {
  return {
    error: formatInitError(
      "pack-preset-not-found",
      `${packageName}/${requested} is not a preset provided by ${packageName}`,
      {
        expected:
          "a preset directory containing atlante.jsonc or atlante.json in the installed pack",
        next: `run \`atlante init --pack ${packageName}/<preset>\` choosing one of the available presets`,
        cause: `available presets: ${availablePresets(presets) || "none"}`,
      },
    ),
  };
}

function noPresetError(packageName: string): { error: string } {
  return {
    error: formatInitError(
      "pack-preset-not-found",
      `${packageName} provides no presets`,
      {
        expected:
          "at least one directory containing atlante.jsonc or atlante.json in the installed pack",
        next: "pass a pack that provides presets, or omit --pack to use the bundled first-party pack",
      },
    ),
  };
}

function nonInteractiveError(
  packageName: string,
  presets: readonly PackPreset[],
): { error: string } {
  return {
    error: formatInitError(
      "pack-prompt-required",
      `${packageName} provides multiple presets`,
      {
        expected: "an explicit preset selection in non-interactive terminals",
        next: `run \`atlante init --pack ${packageName}/<preset>\` choosing one of the available presets`,
        cause: `available presets: ${availablePresets(presets)}`,
      },
    ),
  };
}

function namedPreset(
  packageName: string,
  presets: readonly PackPreset[],
  presetName: string,
): PackPreset | { error: string } {
  const named = presets.find((preset) => preset.relpath === presetName);
  if (named) return named;
  return explicitPresetError(packageName, presetName, presets);
}

async function promptForPreset(
  packageName: string,
  presets: readonly PackPreset[],
  selection: PackPresetSelection,
): Promise<PackPreset | { error: string }> {
  console.log(`${packageName} provides multiple presets:`);
  presets.forEach((preset, index) => {
    console.log(`  ${index + 1}. ${preset.locator}`);
  });

  for (;;) {
    let answer: string;
    try {
      answer = await selection.prompt(
        `Select a preset (1-${presets.length}): `,
      );
    } catch {
      return {
        error: formatInitError(
          "pack-prompt-aborted",
          "preset selection was aborted",
          {
            next: `run \`atlante init --pack ${packageName}/<preset>\` to select a preset without prompting`,
          },
        ),
      };
    }
    const index = Number.parseInt(answer.trim(), 10);
    const selected =
      Number.isInteger(index) && index >= 1 && index <= presets.length
        ? presets[index - 1]
        : undefined;
    if (selected) return selected;
    console.log(`Enter a number between 1 and ${presets.length}.`);
  }
}

/**
 * Selects one preset from the discovered pack presets. An explicit preset
 * name always wins; a single preset auto-selects without prompting; multiple
 * presets prompt on an interactive terminal and fail with an actionable
 * error elsewhere.
 */
export async function selectPackPreset(
  packageName: string,
  presets: readonly PackPreset[],
  presetName: string | undefined,
  selection: PackPresetSelection,
): Promise<PackPreset | { error: string }> {
  if (presetName !== undefined) {
    return namedPreset(packageName, presets, presetName);
  }
  if (presets.length === 0) return noPresetError(packageName);

  const only = presets.length === 1 ? presets[0] : undefined;
  if (only) return only;
  if (!selection.isInteractive()) {
    return nonInteractiveError(packageName, presets);
  }
  return promptForPreset(packageName, presets, selection);
}

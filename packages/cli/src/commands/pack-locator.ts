import { parseResourceLocator } from "@atlante/resources";
import { formatInitError } from "./init-error.js";

export type SelectedPack = Readonly<{
  packageName: string;
  presetName?: string;
}>;

/**
 * Parses a `--pack` value into a pack name with an optional explicit preset
 * name. The subpath of a package locator is the preset name, so
 * `@acme/pack/strict` selects the `strict` preset of `@acme/pack`.
 */
export function parsePackLocator(
  raw: string,
): SelectedPack | { error: string } {
  let parsed: ReturnType<typeof parseResourceLocator>;
  try {
    parsed = parseResourceLocator(raw);
  } catch (cause) {
    return {
      error: formatInitError(
        "invalid-pack-locator",
        "the --pack value is not a valid pack locator",
        {
          expected:
            "a package name like @scope/pack, or a preset locator like @scope/pack/<preset>",
          next: "pass a valid pack locator, or omit --pack to use the bundled first-party pack",
          cause: `received ${JSON.stringify(raw)}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        },
      ),
    };
  }
  if (parsed.kind !== "package") {
    return {
      error: formatInitError(
        "invalid-pack-locator",
        "the --pack value is not a valid pack locator",
        {
          expected:
            "a package name like @scope/pack, or a preset locator like @scope/pack/<preset>",
          next: "pass a valid pack locator, or omit --pack to use the bundled first-party pack",
          cause: `local paths are not pack locators; received ${JSON.stringify(raw)}`,
        },
      ),
    };
  }
  return {
    packageName: parsed.packageName,
    ...(parsed.subpath ? { presetName: parsed.subpath } : {}),
  };
}

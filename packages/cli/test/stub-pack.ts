import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";

export type StubPackOptions = {
  /**
   * Package name the stub is installed under. A non-first-party name keeps
   * CLI commands from intercepting it with the bundled real pack, so
   * resolution falls through to the fixture's node_modules.
   */
  name: string;
};

/**
 * Minimal valid Atlante pack installed in a fixture's node_modules. Mirrors
 * the first-party pack's binding names (`atlante` agent, `plan` skill) with
 * tiny templates, so fixture builds exercise the same resolution, binding,
 * and materialization pipeline at a fraction of the per-build cost of the
 * ~12-binding real pack.
 *
 * Installing under the first-party name `@atlante/pack` only works when the
 * fixture avoids injecting `firstPartyProjectContext()` (e.g. calls
 * `runInitWithDependencies(dir, opts, {})` instead of `runInit`): the bundled
 * context intercepts that exact name and would shadow the stub with the real
 * pack — slower, though still passing. A non-first-party name sidesteps the
 * interception entirely, which is what eval-command tests do.
 */
function stubPackFiles(name: string): Readonly<Record<string, string>> {
  const ref = (artifact: string): string => `${name}/${artifact}`;
  return {
    "package.json": `${JSON.stringify({
      name,
      version: "0.0.0-stub",
      type: "module",
      atlante: { format: 1 },
    })}\n`,
    "atlante.jsonc": `${JSON.stringify({
      $schema: SCHEMA_URI,
      values: { project: "{{sys.cwd.basename}}" },
      agents: { atlante: { $instance: ref("atlante") } },
      skills: { plan: { $instance: ref("plan") } },
    })}\n`,
    "agent/template.jsonc": `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      description: "Stub agent input contract.",
      type: "object",
      properties: {
        identity: { type: "string", minLength: 1 },
        mission: { type: "string", minLength: 1 },
      },
      required: ["identity", "mission"],
      additionalProperties: false,
    })}\n`,
    "agent/template.md":
      "# Identity\n\n{{identity}}\n\n# Mission\n\n{{mission}}\n",
    "skill/template.jsonc": `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      description: "Stub skill input contract.",
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        overview: { type: "string", minLength: 1 },
      },
      required: ["title", "overview"],
      additionalProperties: false,
    })}\n`,
    "skill/template.md": "# {{title}}\n\n## Overview\n\n{{overview}}\n",
    "atlante/instance.jsonc": `${JSON.stringify({
      $template: ref("agent"),
      description: "Stub atlante agent for fixtures.",
      identity: "You are the atlante for {{values.project}}.",
      mission: "Keep the fixture small and verified.",
    })}\n`,
    "plan/instance.jsonc": `${JSON.stringify({
      $template: ref("skill"),
      description: "Stub plan skill for fixtures.",
      title: "Plan",
      overview: "Stub plan overview.",
    })}\n`,
  };
}

/** Installs the stub pack at `<directory>/node_modules/<name>`. */
export function installStubPack(
  directory: string,
  options: StubPackOptions,
): void {
  const packRoot = join(directory, "node_modules", ...options.name.split("/"));
  for (const [relativePath, contents] of Object.entries(
    stubPackFiles(options.name),
  )) {
    const path = join(packRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

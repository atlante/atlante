#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

// 1) Plugin: Bun target=bun bundle + declarations (publishable artifact).
const plugin = join(ROOT, "packages", "opencode-plugin");
await rm(join(plugin, "dist"), { force: true, recursive: true });
const pluginResult = await Bun.build({
  entrypoints: [join(plugin, "src", "index.ts"), join(plugin, "src", "api.ts")],
  target: "bun",
  external: ["@opencode-ai/plugin"],
  splitting: true, // shared chunk keeps api.js from duplicating index.js code
  outdir: join(plugin, "dist"), // dist/index.js, dist/api.js, dist/chunk-*.js
});
if (!pluginResult.success) throw new Error(pluginResult.logs.join("\n"));
// Declarations: d.ts for every src module (consumer types resolve ./plugin.js → ./plugin.d.ts).
await Bun.$`${TSC} --project tsconfig.build.json --emitDeclarationOnly`.cwd(
  plugin,
);
if (
  !existsSync(join(plugin, "dist", "index.js")) ||
  !existsSync(join(plugin, "dist", "api.js"))
) {
  throw new Error(
    "@atlante/opencode-plugin: bundle missing dist/index.js or dist/api.js",
  );
}

// 2) CLI: Bun target=node bundle + generated assets + guard (publishable artifact).
const cli = join(ROOT, "packages", "cli");
await rm(join(cli, "dist"), { force: true, recursive: true });
const cliResult = await Bun.build({
  entrypoints: [join(cli, "bin", "atlante.ts")],
  target: "node",
  external: ["jsonc-parser"],
  // bun 1.3.14 ignores `outfile` in Bun.build; use outdir, which places
  // the bundle at <outdir>/<entry basename>.
  outdir: join(cli, "dist", "bin"),
});
if (!cliResult.success) throw new Error(cliResult.logs.join("\n"));
// Copy content assets to the bundle-relative fallback root. The legacy
// assets remain available until their consumers are migrated in T10.
// Remove first so stale entries do not survive rebuilds.
await rm(join(cli, "bundled"), { force: true, recursive: true });
await Bun.$`mkdir -p ${join(cli, "bundled")}`;
await Bun.$`cp -R ${join(ROOT, "packages", "resources", "bundled")} ${join(cli, "bundled", "resources")}`;
await Bun.$`cp -R ${join(ROOT, "packages", "templates", "bundled")} ${join(cli, "bundled", "templates")}`;
await Bun.$`cp -R ${join(ROOT, "packages", "presets", "bundled")} ${join(cli, "bundled", "presets")}`;
// Contract check: the shipped launcher must run under node.
const bundle = await readFile(join(cli, "dist", "bin", "atlante.js"), "utf8");
if (!bundle.startsWith("#!/usr/bin/env node"))
  throw new Error(
    "@atlante/cli: bundle shebang is not node; check bin/atlante.ts",
  );

console.log("Build complete");

#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

// 1) OpenCode adapter: Bun target=bun bundle + declarations (internal artifact).
const plugin = join(ROOT, "packages", "opencode");
await rm(join(plugin, "dist"), { force: true, recursive: true });
const pluginResult = await Bun.build({
  entrypoints: [join(plugin, "src", "index.ts")],
  target: "bun",
  outdir: join(plugin, "dist"), // dist/index.js
});
if (!pluginResult.success) throw new Error(pluginResult.logs.join("\n"));
// Declarations: d.ts for every src module (consumer types resolve ./native.js → ./native.d.ts).
await Bun.$`${TSC} --project tsconfig.build.json --emitDeclarationOnly`.cwd(
  plugin,
);
if (!existsSync(join(plugin, "dist", "index.js"))) {
  throw new Error("@atlante/opencode: bundle missing dist/index.js");
}

// 2) CLI: Bun target=node bundle + guards (publishable artifact).
const cli = join(ROOT, "packages", "cli");
await rm(join(cli, "dist"), { force: true, recursive: true });
// The UMD build wraps require in a factory parameter, which the bundler
// cannot trace and would leave as a runtime-relative require. The ESM
// build uses static imports, so pin resolution to lib/esm explicitly.
const cliRequire = createRequire(join(cli, "package.json"));
const jsoncEsmMain = join(
  dirname(cliRequire.resolve("jsonc-parser/package.json")),
  "lib",
  "esm",
  "main.js",
);
const cliResult = await Bun.build({
  entrypoints: [join(cli, "bin", "atlante.ts")],
  target: "node",
  plugins: [
    {
      name: "jsonc-parser-esm",
      setup(build) {
        build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
          path: jsoncEsmMain,
        }));
      },
    },
  ],
  // bun 1.3.14 ignores `outfile` in Bun.build; use outdir, which places
  // the bundle at <outdir>/<entry basename>.
  outdir: join(cli, "dist", "bin"),
});
if (!cliResult.success) throw new Error(cliResult.logs.join("\n"));
// Contract check: the shipped launcher must run under node.
const bundle = await readFile(join(cli, "dist", "bin", "atlante.js"), "utf8");
if (!bundle.startsWith("#!/usr/bin/env node"))
  throw new Error("atlante: bundle shebang is not node; check bin/atlante.ts");
// Contract check: fully self-contained. The deployed website resolves the
// unscoped CLI from node_modules/atlante/** and its runtime pack dependency
// from node_modules/@atlante/**. The only allowed bundle externals are Node
// builtins and ajv's runtime modules, which ajv's generated validator code
// requires dynamically when schemas use the matching keywords; the Atlante
// schema does not, so ajv itself does not ship in the lambda.
const builtinModules = new Set(cliRequire("node:module").builtinModules);
const externalImports = new Set(
  [
    ...bundle.matchAll(
      /(?:require\(|require\.resolve\(|\bimport\(|\bfrom ?)["']([^"']+)["']/g,
    ),
  ]
    .map((match) => match[1])
    .filter(
      (specifier) =>
        !specifier.startsWith(".") &&
        !specifier.startsWith("node:") &&
        !specifier.startsWith("#") &&
        !specifier.startsWith("ajv/dist/runtime/") &&
        !builtinModules.has(specifier),
    ),
);
if (externalImports.size > 0) {
  throw new Error(
    `atlante: bundle is not self-contained, external imports remain: ${[
      ...externalImports,
    ].join(", ")}`,
  );
}

console.log("Build complete");

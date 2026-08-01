import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTemplates } from "./loader.js";

function resolveBundledDir(): URL {
  // Standalone package (source or built dist): <pkg>/bundled.
  const standalone = new URL("../bundled", import.meta.url);
  if (existsSync(fileURLToPath(standalone))) return standalone;
  // Inlined into the CLI bundle at <cli>/dist/bin/atlante.js:
  // <cli>/bundled/templates (copied by scripts/build.ts).
  return new URL("../../bundled/templates", import.meta.url);
}

export const BUNDLED_TEMPLATES_DIR = fileURLToPath(resolveBundledDir());

export function loadBundledTemplates() {
  return loadTemplates(BUNDLED_TEMPLATES_DIR, "atlante");
}

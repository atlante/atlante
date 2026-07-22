import { fileURLToPath } from "node:url";
import { loadTemplates } from "./loader.ts";

export const BUNDLED_TEMPLATES_DIR = fileURLToPath(
  new URL("../bundled", import.meta.url),
);

export function loadBundledTemplates() {
  return loadTemplates(BUNDLED_TEMPLATES_DIR);
}

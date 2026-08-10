import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createResourcePack, type ResourcePack } from "./content-root.js";

function resolveBundledDir(): URL {
  const standalone = new URL("../bundled", import.meta.url);
  if (existsSync(fileURLToPath(standalone))) return standalone;
  return new URL("../../bundled/resources", import.meta.url);
}

export const BUNDLED_RESOURCES_DIR = fileURLToPath(resolveBundledDir());

/** The bundled root is canonicalized once, before any child is selected. */
export const BUNDLED_RESOURCE_PACK = createResourcePack(
  BUNDLED_RESOURCES_DIR,
  "bundled",
);

export function createBundledResourcePack(
  rootDirectory: string = BUNDLED_RESOURCES_DIR,
): ResourcePack {
  return createResourcePack(rootDirectory, "bundled");
}

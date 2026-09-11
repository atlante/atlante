import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { ProjectContext } from "@atlante/builder";
import {
  createPackageResourcePack,
  type ResourcePack,
} from "@atlante/resources";

type FirstPartyPackManifest = typeof import("@atlante/pack/package.json");

export const FIRST_PARTY_PACKAGE: FirstPartyPackManifest["name"] =
  "@atlante/pack";

function firstPartyManifestPath(): string {
  try {
    return createRequire(import.meta.url).resolve("@atlante/pack/package.json");
  } catch (cause) {
    throw new Error(
      `could not resolve ${FIRST_PARTY_PACKAGE} from the CLI installation: ${String(cause)}`,
    );
  }
}

/** Resolves and validates the static pack installed with this CLI. */
export function resolveFirstPartyPack(): ResourcePack {
  const manifestPath = firstPartyManifestPath();
  return createPackageResourcePack(dirname(manifestPath), FIRST_PARTY_PACKAGE);
}

/** Version of the @atlante/pack package shipped with this CLI. */
export function firstPartyPackVersion(): string {
  const manifest = JSON.parse(
    readFileSync(firstPartyManifestPath(), "utf8"),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(
      `the bundled ${FIRST_PARTY_PACKAGE} manifest declares no usable version`,
    );
  }
  return manifest.version;
}

export function firstPartyProjectContext(): ProjectContext {
  const capturedFirstPartyPack = resolveFirstPartyPack();
  return {
    packageProvider: (packageName) =>
      packageName === FIRST_PARTY_PACKAGE ? capturedFirstPartyPack : undefined,
  };
}

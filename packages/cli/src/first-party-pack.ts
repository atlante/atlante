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

/** Resolves and validates the static pack installed with this CLI. */
export function resolveFirstPartyPack(): ResourcePack {
  let manifestPath: string;
  try {
    manifestPath = createRequire(import.meta.url).resolve(
      "@atlante/pack/package.json",
    );
  } catch (cause) {
    throw new Error(
      `could not resolve ${FIRST_PARTY_PACKAGE} from the CLI installation: ${String(cause)}`,
    );
  }
  return createPackageResourcePack(dirname(manifestPath), FIRST_PARTY_PACKAGE);
}

export function firstPartyProjectContext(): ProjectContext {
  const capturedFirstPartyPack = resolveFirstPartyPack();
  return {
    packageProvider: (packageName) =>
      packageName === FIRST_PARTY_PACKAGE ? capturedFirstPartyPack : undefined,
  };
}

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packsRoot = join(import.meta.dirname, "..");
const repoRoot = join(packsRoot, "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("packs deployment contract", () => {
  it("keeps registry synchronization in the complete packs build", () => {
    const packsPackage = JSON.parse(read("packs/package.json")) as {
      scripts: Record<string, string>;
    };
    const packsIgnore = read("packs/.gitignore");
    const vercel = JSON.parse(read("packs/vercel.json")) as {
      buildCommand: string;
      installCommand: string;
      ignoreCommand?: string;
      cleanUrls: boolean;
      trailingSlash: boolean;
    };
    const releaseWorkflow = read(".github/workflows/release.yml");
    const rootPackage = JSON.parse(read("package.json")) as {
      workspaces: string[];
      scripts: Record<string, string>;
    };

    expect(packsPackage.scripts.build).toBe(
      "bun run sync:brand && bun run sync:packs && astro build",
    );
    expect(packsPackage.scripts.check).toBe(
      "bun run build && ATLANTE_BUILT_OUTPUT_TESTS=1 bun test scripts src/data",
    );
    expect(packsPackage.scripts["sync:packs"]).toBe(
      "bun scripts/sync-packs.ts",
    );
    expect(packsIgnore).toContain("public/brand/");
    expect(packsIgnore).toContain("src/styles/atlante-tokens.css");
    expect(vercel.buildCommand).toBe("bun run build");
    expect(vercel.installCommand).toBe(
      "npm install --workspaces=false --no-package-lock --no-audit --no-fund",
    );
    // Production deploys are not gated: Vercel deploys every push to the
    // production branch, so no ignored-build step may be configured.
    expect(vercel.ignoreCommand).toBeUndefined();
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.trailingSlash).toBe(false);

    // The release transaction is publication only: Vercel owns the packs
    // deployment through its git integration, like the other sites.
    expect(releaseWorkflow).not.toContain("deploy-packs");
    expect(releaseWorkflow).not.toContain("VERCEL_PACKS_PROJECT_ID");
    expect(releaseWorkflow).not.toContain("vercel deploy");

    expect(rootPackage.workspaces).toContain("packs");
    expect(rootPackage.scripts["packs:check"]).toBe(
      "bun run --cwd packs check",
    );
    expect(rootPackage.scripts["full:check"]).toContain("packs:check");
  });

  it("keeps the snapshot generated and the manifest authored", () => {
    const packsIgnore = read("packs/.gitignore");
    // The snapshot is the network fallback, so it must stay committed; the
    // manifest is authored and never generated.
    expect(packsIgnore).not.toContain("registry-snapshot.json");
    expect(() =>
      JSON.parse(read("packs/src/data/registry-manifest.json")),
    ).not.toThrow();
    expect(() =>
      JSON.parse(read("packs/src/data/registry-snapshot.json")),
    ).not.toThrow();
    expect(read("packs/src/data/registry-snapshot.json")).toContain(
      '"syncedAt"',
    );
  });
});

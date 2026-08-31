import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const websiteRoot = join(import.meta.dirname, "..");
const repoRoot = join(websiteRoot, "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("website deployment contract", () => {
  it("keeps schema publication in the complete website build", () => {
    const websitePackage = JSON.parse(read("website/package.json")) as {
      scripts: Record<string, string>;
    };
    const websiteIgnore = read("website/.gitignore");
    const vercel = JSON.parse(read("website/vercel.json")) as {
      buildCommand: string;
      cleanUrls: boolean;
      trailingSlash: boolean;
      functions: { "api/**": { includeFiles: unknown } };
      headers: Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
      }>;
    };
    const releaseWorkflow = read(".github/workflows/release.yml");
    const websiteReadme = read("website/README.md");
    const rootIgnore = read(".gitignore");
    const normalizedReadme = websiteReadme.replace(/\s+/g, " ");

    expect(websitePackage.scripts.build).toBe(
      "bun run sync:brand && bun run sync:schema && astro build",
    );
    expect(websitePackage.scripts.check).toBe(
      "bun run build && vitest run scripts/website-output.test.ts",
    );
    expect(websitePackage.scripts["sync:schema"]).toBe(
      "bun scripts/sync-schema.ts",
    );
    expect(websiteIgnore).toContain("public/schema/");
    expect(vercel.buildCommand).toBe("bun run build");
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.trailingSlash).toBe(false);
    expect(vercel.functions["api/**"].includeFiles).toBe(
      "node_modules/@atlante/**",
    );

    const schemaHeader = vercel.headers.find(
      (header) => header.source === "/schema/v0.1/schema.json",
    );
    expect(schemaHeader?.headers).toContainEqual({
      key: "Content-Type",
      value: "application/schema+json",
    });

    expect(releaseWorkflow).toContain(
      "working-directory: website\n        run: |\n          set -euo pipefail\n          bun run build",
    );
    expect(releaseWorkflow).not.toContain("Copy schema files");
    expect(releaseWorkflow).not.toContain(
      "cp -r packages/schema/schema website/",
    );
    expect(rootIgnore).not.toContain("website/schema/");

    expect(normalizedReadme).toContain(
      "Include source files outside of the Root Directory in the Build Step",
    );
    expect(normalizedReadme).toContain("Root Directory set to `website`");
    expect(normalizedReadme).toContain("Vercel CLI `20.1.0` or newer");
    expect(normalizedReadme).toContain(
      "default for projects created after August 27, 2020",
    );
    expect(normalizedReadme).toContain("../brand");
    expect(normalizedReadme).toContain("../packages/schema");
  });
});

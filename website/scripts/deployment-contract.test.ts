import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
      functions: {
        "api/**": { maxDuration: number; includeFiles: string };
      };
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
      "bun run build && ATLANTE_BUILT_OUTPUT_TESTS=1 bun test scripts api",
    );
    expect(websitePackage.scripts["sync:schema"]).toBe(
      "bun scripts/sync-schema.ts",
    );
    expect(websiteIgnore).toContain("public/schema/");
    expect(vercel.buildCommand).toBe("bun run build");
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.trailingSlash).toBe(false);
    expect(vercel.functions["api/**"]).toEqual({
      maxDuration: 30,
      includeFiles: "node_modules/@atlante/pack/**",
    });

    const schemaHeader = vercel.headers.find(
      (header) => header.source === "/schema/v0.1/:name.json",
    );
    expect(schemaHeader?.headers).toContainEqual({
      key: "Content-Type",
      value: "application/schema+json",
    });

    // The release transaction is publication only: Vercel owns the website
    // and docs deployments through its git integration.
    expect(releaseWorkflow).toContain("publish-packages:");
    expect(releaseWorkflow).toContain("create-release:");
    expect(releaseWorkflow).toContain("bun scripts/publish-packages.ts");
    expect(releaseWorkflow).toContain("tags: ['v*']");
    for (const forbidden of [
      "workflow_dispatch",
      "deploy-website",
      "deploy-docs",
      "npm view",
      "vercel build",
      "vercel deploy",
      "playground.func",
      "cp -R",
      "VERCEL_TOKEN",
    ]) {
      expect(releaseWorkflow).not.toContain(forbidden);
    }

    expect(rootIgnore).not.toContain("website/schema/");

    expect(normalizedReadme).toContain("deploys natively from Vercel");
    expect(normalizedReadme).toContain("includeFiles");
    expect(normalizedReadme).toContain(
      "Include source files outside of the Root Directory in the Build Step",
    );
    expect(normalizedReadme).toContain("advances in ordinary pull requests");
    expect(normalizedReadme).toContain("../brand");
    expect(normalizedReadme).toContain("../packages/schema");
    expect(normalizedReadme).toContain("@atlante/pack");
    for (const stale of [
      "prebuilt Vercel artifacts",
      "npm install --prefix website",
      "vercel deploy --prebuilt",
      "59.3.0",
    ]) {
      expect(normalizedReadme).not.toContain(stale);
    }
  });
});

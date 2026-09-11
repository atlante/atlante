import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const docsRoot = join(import.meta.dirname, "..");
const repoRoot = join(docsRoot, "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("docs deployment contract", () => {
  it("builds the docs site self-contained on Vercel", () => {
    const docsPackage = JSON.parse(read("docs/package.json")) as {
      scripts: Record<string, string>;
    };
    const vercel = JSON.parse(read("docs/vercel.json")) as {
      buildCommand: string;
      cleanUrls: boolean;
      trailingSlash: boolean;
    };
    const releaseWorkflow = read(".github/workflows/release.yml");

    expect(docsPackage.scripts["sync:brand"]).toBe("bun scripts/sync-brand.ts");
    expect(vercel.buildCommand).toBe("bun run sync:brand && npx astro build");
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.trailingSlash).toBe(false);
    expect(releaseWorkflow).not.toContain("deploy-docs");
    expect(releaseWorkflow).not.toContain("sync:brand");
  });
});

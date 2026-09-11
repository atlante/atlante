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
      ignoreCommand: string;
      cleanUrls: boolean;
      trailingSlash: boolean;
      redirects: Array<{
        source: string;
        destination: string;
        permanent: boolean;
      }>;
    };
    const releaseWorkflow = read(".github/workflows/release.yml");

    expect(docsPackage.scripts["sync:brand"]).toBe("bun scripts/sync-brand.ts");
    expect(vercel.buildCommand).toBe("bun run sync:brand && npx astro build");
    expect(vercel.ignoreCommand).toBe(
      'if [ "$VERCEL_ENV" != "production" ]; then exit 1; fi; if printf \'%s\\n\' "$VERCEL_GIT_COMMIT_MESSAGE" | head -n 1 | grep -Eq \'^release: v[0-9]+\\.[0-9]+\\.[0-9]+$\'; then exit 1; fi; exit 0',
    );
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.trailingSlash).toBe(false);
    // The root redirect is answered at the edge; the Astro-generated refresh
    // stub must never reach a production visitor.
    expect(vercel.redirects).toContainEqual({
      source: "/",
      destination: "/introduction",
      permanent: false,
    });
    expect(releaseWorkflow).not.toContain("deploy-docs");
    expect(releaseWorkflow).not.toContain("sync:brand");
  });
});

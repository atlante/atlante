import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const websiteRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(websiteRoot, relativePath), "utf8");
}

const observatoryKeys = [
  "configuration",
  "inputs",
  "agent",
  "validation",
  "adapter",
  "runtime",
] as const;

describe.skipIf(process.env.ATLANTE_BUILT_OUTPUT_TESTS !== "1")(
  "website built output",
  () => {
    it("keeps critical links and observatory structure in built HTML", () => {
      const html = read("dist/index.html");
      for (const href of [
        "https://docs.atlante.sh",
        "https://docs.atlante.sh/getting-started",
        "#quick-start",
        "https://github.com/atlante/atlante",
        "https://github.com/atlante/atlante/releases",
        "https://github.com/atlante/atlante/issues",
        "https://github.com/atlante/atlante/blob/main/SPECIFICATION.md",
        "https://www.npmjs.com/package/@atlante/cli",
        "https://github.com/atlante/atlante/blob/main/CONTRIBUTING.md",
      ]) {
        expect(html).toContain(href);
      }
      for (const key of observatoryKeys) {
        expect(html).toContain(`data-symbol="${key}"`);
        expect(html).toContain(`data-observation="${key}"`);
      }
    });

    it("publishes the branded 404 output with recovery links", () => {
      const html = read("dist/404.html");

      expect(html).toContain(
        "<title>This star is off the map | Atlante</title>",
      );
      expect(html).toContain("This star is off the map");
      expect(html).toContain("The page you requested was not found.");
      expect(html).toContain('href="/"');
      expect(html).toContain('href="https://docs.atlante.sh"');
      expect(html).toContain('aria-label="Switch theme"');
    });

    it("keeps the built schemas byte-equivalent to the authorities", () => {
      for (const name of ["schema.json", "eval-scenario.json"]) {
        expect(
          readFileSync(join(websiteRoot, `dist/schema/v0.1/${name}`)),
        ).toEqual(
          readFileSync(
            join(websiteRoot, "..", `packages/schema/schema/v0.1/${name}`),
          ),
        );
      }
    });
  },
);

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
    it("keeps approved copy and links in built HTML", () => {
      const html = read("dist/index.html");
      for (const text of [
        "Define, share, and evolve your harness through Atlante with your team.",
        "One harness, held together",
        "Every signal stays visible",
        "Your stars form an agent",
        "Validate before you build",
        "Only verified artifacts cross the boundary",
        "Atlante bears the structure. The host runs it.",
        "Build your constellation",
        "Built for change. Strict by design",
        "Chart your harness",
        "Presets compose in declaration order. Your local configuration takes precedence.",
        "one template → many roles",
        "Compose roles, not copies",
        "Reusable templates give agents shared structure without duplicating prompt definitions.",
        "Run ",
        ">init</code> to create your configuration and build your first harness.",
        "Learn",
        "Project",
        "Reference",
        "Getting started",
        "Specification",
        "/brand/horizontal/atlante-horizontal.svg",
        "/brand/horizontal/atlante-horizontal-reverse.svg",
      ]) {
        expect(html).toContain(text);
      }
      for (const text of [
        "invalid → no publication",
        "Keep the last good build",
        "Failed configuration or template validation leaves the current artifact tree untouched.",
        ">init</code> to create your configuration and build your first artifacts.",
      ]) {
        expect(html).not.toContain(text);
      }
      for (const href of [
        "https://docs.atlante.sh",
        "https://docs.atlante.sh/getting-started",
        "#quick-start",
        "https://github.com/atlante/atlante/releases",
        "https://github.com/atlante/atlante/issues",
        "https://github.com/atlante/atlante/blob/main/SPECIFICATION.md",
        "https://www.npmjs.com/package/@atlante/cli",
        "https://docs.atlante.sh/contributing",
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

    it("keeps the built schema byte-equivalent to the authority", () => {
      expect(
        readFileSync(join(websiteRoot, "dist/schema/v0.1/schema.json")),
      ).toEqual(
        readFileSync(
          join(websiteRoot, "..", "packages/schema/schema/v0.1/schema.json"),
        ),
      );
    });
  },
);

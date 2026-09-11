import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packsRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(packsRoot, relativePath), "utf8");
}

describe.skipIf(process.env.ATLANTE_BUILT_OUTPUT_TESTS !== "1")(
  "packs built output",
  () => {
    it("redirects the legacy /packs path to the subdomain root", () => {
      const index = read("dist/packs.html");
      expect(index).toContain("url=/");
      expect(index).toContain('http-equiv="refresh"');
    });

    it("renders the curated catalog from the registry snapshot", () => {
      const html = read("dist/index.html");
      expect(html).toContain("Pack explorer");
      expect(html).toContain("@atlante/pack");
      expect(html).toContain('href="/@atlante/pack"');
      expect(html).toContain("indexed");
      expect(html).toContain("static snapshot");
      expect(html).toContain("Registry synchronized");
      expect(html).toContain('id="pack-search"');
      expect(html).toContain('id="pack-sort"');
    });

    it("renders the pack detail page with installation and inspection", () => {
      const html = read("dist/@atlante/pack.html");
      expect(html).toContain("npx atlante@latest init --pack @atlante/pack");
      expect(html).toContain("npm install --save-dev @atlante/pack");
      expect(html).toContain("atlante.format: 1");
      expect(html).toContain("Read before installing");
      expect(html).toContain('data-file="atlante.jsonc"');
      expect(html).toContain('id="pack-files"');
      expect(html).toContain("Included presets");
      expect(html).toContain("@atlante/pack/architect");
      expect(html).toContain("https://www.npmjs.com/package/@atlante/pack");
      expect(html).toContain("https://github.com/atlante/atlante");
    });

    it("publishes the branded 404 output with recovery links", () => {
      const html = read("dist/404.html");
      expect(html).toContain("This star is off the map");
      expect(html).toContain("The page you requested was not found.");
      expect(html).toContain('href="/"');
    });
  },
);

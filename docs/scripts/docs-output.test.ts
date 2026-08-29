import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const docsRoot = join(import.meta.dirname, "..");
const sourceRoot = join(docsRoot, "src", "content", "docs");
const outputRoot = join(docsRoot, "dist");

type AuthoredDocument = {
  source: string;
  sourceRelativePath: string;
  route: string;
  draft: boolean;
};

function markdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    })
    .sort();
}

function authoredDocuments(): AuthoredDocument[] {
  return markdownFiles(sourceRoot).map((sourcePath) => {
    const source = readFileSync(sourcePath, "utf8");
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) {
      throw new Error(`Missing YAML frontmatter: ${sourcePath}`);
    }

    const sourceRelativePath = relative(sourceRoot, sourcePath).replaceAll(
      "\\",
      "/",
    );
    return {
      source,
      sourceRelativePath,
      route: `/${sourceRelativePath}`,
      draft: /^draft\s*:\s*true\s*$/m.test(frontmatter[1]),
    };
  });
}

function outputPath(route: string): string {
  return join(outputRoot, route.slice(1));
}

function rawOutputRoute(document: AuthoredDocument): string {
  return document.sourceRelativePath === "index.md"
    ? "/introduction.md"
    : document.route;
}

function staticOutputPath(route: string): string {
  return route === "/" ? join(outputRoot, "index.html") : outputPath(route);
}

function expectStaticRedirect(route: string, destination: string): void {
  expect(readFileSync(staticOutputPath(route), "utf8")).toBe(
    [
      "<!doctype html>",
      `<title>Redirecting to: ${destination}</title>`,
      `<meta http-equiv="refresh" content="0;url=${destination}">`,
      `<meta name="robots" content="noindex">`,
      `<link rel="canonical" href="https://docs.atlante.sh${destination}">`,
      "<body>",
      `\t<a href="${destination}">Redirecting from <code>${route}</code> to <code>${destination}</code></a>`,
      "</body>",
    ].join("\n"),
  );
}

describe("docs built output", () => {
  const documents = authoredDocuments();

  it("publishes exactly the non-draft authored Markdown routes", () => {
    const expectedRoutes = documents
      .filter((document) => !document.draft)
      .map(rawOutputRoute)
      .sort();
    const actualRoutes = markdownFiles(outputRoot)
      .filter((path) => path !== outputPath("/index.md"))
      .map((path) => `/${relative(outputRoot, path).replaceAll("\\", "/")}`)
      .sort();

    expect(actualRoutes).toEqual(expectedRoutes);

    for (const document of documents) {
      const companion = outputPath(rawOutputRoute(document));
      expect(
        existsSync(companion),
        `${rawOutputRoute(document)} should ${document.draft ? "not " : ""}be emitted`,
      ).toBe(!document.draft);

      if (!document.draft && existsSync(companion)) {
        const generated = readFileSync(companion, "utf8");
        expect(generated).toBe(document.source);
        expect(generated).not.toMatch(/<!doctype html>|<html\b|<body\b/i);
        expect(generated).not.toMatch(
          /<nav\b|data-pagefind-body|aria-label=["'][^"']*(?:navigation|menu|sidebar)/i,
        );
      }
    }
  });

  it("maps the root and a nested route to explicit Markdown companions", () => {
    const expectedRoutes = {
      "/introduction.md": "index.md",
      "/concepts/configuration.md": "concepts/configuration.md",
    } as const;

    for (const [route, sourceRelativePath] of Object.entries(expectedRoutes)) {
      const document = documents.find(
        (candidate) => candidate.sourceRelativePath === sourceRelativePath,
      );
      expect(
        document?.draft,
        `${sourceRelativePath} must be a published page`,
      ).toBe(false);
      expect(existsSync(outputPath(route)), `${route} should exist`).toBe(true);
    }
  });

  it("keeps the legacy Markdown route as a redirect", () => {
    expectStaticRedirect("/index.md", "/introduction.md");
  });

  it("keeps the root route as a redirect", () => {
    expectStaticRedirect("/", "/introduction");
  });
});

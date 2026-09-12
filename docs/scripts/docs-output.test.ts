import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const docsRoot = join(import.meta.dirname, "..");
const sourceRoot = join(docsRoot, "src", "content", "docs");
const outputRoot = join(docsRoot, "dist");

type AuthoredDocument = {
  source: string;
  sourceRelativePath: string;
  route: string;
  draft: boolean;
};

function contentFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return contentFiles(path);
      return entry.isFile() && /\.mdx?$/.test(entry.name) ? [path] : [];
    })
    .sort();
}

function authoredDocuments(): AuthoredDocument[] {
  return contentFiles(sourceRoot).map((sourcePath) => {
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
      route: `/${sourceRelativePath.replace(/\.mdx$/, ".md")}`,
      draft: /^draft\s*:\s*true\s*$/m.test(frontmatter[1]),
    };
  });
}

function outputPath(route: string): string {
  return join(outputRoot, route.slice(1));
}

function rawOutputRoute(document: AuthoredDocument): string {
  return document.route;
}

function staticOutputPath(route: string): string {
  if (route === "/") return join(outputRoot, "index.html");
  return route.endsWith(".md")
    ? join(outputRoot, route.slice(1), "index.html")
    : outputPath(route);
}

function expectStaticRedirect(
  route: string,
  destination: string,
  outputRelativePath?: string,
): void {
  const redirectPath = outputRelativePath
    ? join(outputRoot, outputRelativePath)
    : staticOutputPath(route);
  const canonicalHref = /^https?:\/\//.test(destination)
    ? destination
    : `https://docs.atlante.sh${destination}`;
  expect(readFileSync(redirectPath, "utf8")).toBe(
    [
      "<!doctype html>",
      `<title>Redirecting to: ${destination}</title>`,
      `<meta http-equiv="refresh" content="0;url=${destination}">`,
      `<meta name="robots" content="noindex">`,
      `<link rel="canonical" href="${canonicalHref}">`,
      "<body>",
      `\t<a href="${destination}">Redirecting from <code>${route}</code> to <code>${destination}</code></a>`,
      "</body>",
    ].join(""),
  );
}

const runOutputTests = process.env.ATLANTE_BUILT_OUTPUT_TESTS === "1";

describe.skipIf(!runOutputTests)("docs built output", () => {
  const documents = authoredDocuments();

  it("publishes exactly the non-draft authored content routes", () => {
    const expectedRoutes = documents
      .filter((document) => !document.draft)
      .map(rawOutputRoute)
      .sort();
    const actualRoutes = contentFiles(outputRoot)
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
      }
    }
  });

  it("maps the root and a nested route to explicit Markdown companions", () => {
    const expectedRoutes = {
      "/introduction.md": "introduction.md",
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

  it("keeps the contributing route as a redirect", () => {
    expectStaticRedirect(
      "/contributing",
      "https://github.com/atlante/atlante/blob/main/CONTRIBUTING.md",
      join("contributing", "index.html"),
    );
  });

  it("keeps the extension-boundary route as a redirect", () => {
    expectStaticRedirect(
      "/guides/extensions",
      "/guides/authoring-packs",
      join("guides", "extensions", "index.html"),
    );
  });

  it("keeps the OpenCode guide route as a redirect", () => {
    expectStaticRedirect(
      "/guides/opencode",
      "/guides/building-a-harness",
      join("guides", "opencode", "index.html"),
    );
  });

  it("keeps the native-output route as a redirect", () => {
    expectStaticRedirect(
      "/concepts/native-outputs",
      "/reference/materialization",
      join("concepts", "native-outputs", "index.html"),
    );
  });

  it("keeps Starlight search on full page loads", () => {
    const generated = readFileSync(
      join(outputRoot, "introduction", "index.html"),
      "utf8",
    );

    expect(generated).not.toContain('name="astro-view-transitions-enabled"');
    expect(generated).not.toContain("ClientRouter.astro");
  });
});

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

  it("publishes the branded docs 404 output", () => {
    const notFoundPath = join(outputRoot, "404.html");
    expect(
      existsSync(notFoundPath),
      "the generated /404 route should exist",
    ).toBe(true);

    const generated = readFileSync(notFoundPath, "utf8");
    const styles = [
      ...generated.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi),
    ]
      .map(([link]) => link.match(/\bhref=["']([^"']+)["']/i)?.[1])
      .filter((href): href is string => href !== undefined)
      .map((href) =>
        readFileSync(join(outputRoot, href.replace(/^\//, "")), "utf8"),
      )
      .join("\n");
    const builtOutput = `${generated}\n${styles}`;
    const anchors = [...generated.matchAll(/<a\b[^>]*>/gi)].map(
      ([anchor]) => anchor,
    );
    const backAnchors = anchors.filter((anchor) =>
      /\bdata-atlante-404-back\b/i.test(anchor),
    );

    expect(generated).toContain("data-atlante-404");
    expect(generated).toContain('data-celestial-marker="star-map"');
    expect(generated).toContain("This star is off the map");
    expect(generated.match(/\bdata-atlante-navbar\b/gi) ?? []).toHaveLength(1);
    expect(backAnchors).toHaveLength(1);
    expect(backAnchors[0]).toMatch(/\bhref=["']\/introduction["']/i);
    expect(generated).not.toContain("/getting-started");
    expect(generated).not.toMatch(
      /<(?:aside|footer)\b|data-has-(?:sidebar|toc|hero)\b|<(?:starlight-menu-button|site-search|starlight-theme-select|starlight-lang-select|mobile-starlight-toc|starlight-toc)\b|data-open-modal\b|id=["']theme-icons["']/i,
    );
    expect(generated).not.toContain("On this page");
    expect(generated).not.toContain(
      "Page not found. Check the URL or try using the search bar.",
    );

    expect(builtOutput).toMatch(/--ds-[a-z0-9-]+\s*:/i);
    expect(builtOutput).toMatch(/--font-[a-z0-9-]+\s*:/i);
    expect(builtOutput).toMatch(
      /@media\s*\([^)]*(?:max-width|min-width)[^)]*\)/i,
    );
    expect(builtOutput).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:/i);
    expect(generated).not.toMatch(
      /@atlante\/website|(?:[/'"]|^)website(?:[/'"]|$)/i,
    );
  });
});

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const docsRoot = join(import.meta.dirname, "..");
const sourceRoot = join(docsRoot, "src", "content", "docs");
const configPath = join(docsRoot, "astro.config.mjs");

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    })
    .sort();
}

function authoredRoutes(): string[] {
  return markdownFiles(sourceRoot).map(
    (sourcePath) =>
      `/${relative(sourceRoot, sourcePath).replaceAll("\\", "/").replace(/\.md$/, "")}`,
  );
}

function declaredRedirectRoutes(): string[] {
  const config = readFileSync(configPath, "utf8");
  const redirects = config.match(/redirects:\s*\{([\s\S]*?)\n\s*\},/);
  if (!redirects) return [];
  return [...redirects[1].matchAll(/["'](\/[^"']*)["']\s*:/g)].map(
    ([, route]) => route,
  );
}

function stripCodeFences(source: string): string {
  return source.replaceAll(/^```[\s\S]*?^```$/gm, "");
}

function internalLinks(source: string): string[] {
  return [
    ...stripCodeFences(source).matchAll(/\]\((\/[^)\s#]*)(?:#[^)\s]*)?\)/g),
  ].map(([, target]) => target);
}

describe("docs internal links", () => {
  const routes = authoredRoutes();
  const redirectRoutes = declaredRedirectRoutes();
  const resolvable = new Set([...routes, ...redirectRoutes]);

  it("declares every retired route as a redirect or keeps it authored", () => {
    expect(redirectRoutes).toContain("/contributing");
    expect(redirectRoutes).toContain("/guides/extensions");
    expect(redirectRoutes).toContain("/guides/opencode");
    expect(redirectRoutes).toContain("/concepts/native-outputs");
  });

  it("resolves every site-absolute link to an authored page or redirect", () => {
    const broken: string[] = [];

    for (const sourcePath of markdownFiles(sourceRoot)) {
      const source = readFileSync(sourcePath, "utf8");
      for (const target of internalLinks(source)) {
        if (!resolvable.has(target)) {
          broken.push(
            `${relative(docsRoot, sourcePath).replaceAll("\\", "/")} -> ${target}`,
          );
        }
      }
    }

    expect(broken).toEqual([]);
  });
});

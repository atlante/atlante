import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DashboardAsset } from "./server.js";
import { DASHBOARD_ASSET_PATHS } from "./web/assets.js";

const brandRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "brand",
);

const brandFiles = [
  [
    DASHBOARD_ASSET_PATHS.tokens,
    "atlante-design-tokens.css",
    "text/css; charset=utf-8",
  ],
  [
    DASHBOARD_ASSET_PATHS.fonts.bodoniModa,
    "fonts/bodonimoda/bodoni-moda-latin.woff2",
    "font/woff2",
  ],
  [
    DASHBOARD_ASSET_PATHS.fonts.sourceSerif,
    "fonts/sourceserif4/source-serif-4-latin.woff2",
    "font/woff2",
  ],
  [
    DASHBOARD_ASSET_PATHS.fonts.sourceSans,
    "fonts/sourcesans3/source-sans-3-latin.woff2",
    "font/woff2",
  ],
  [
    DASHBOARD_ASSET_PATHS.fonts.jetBrainsMono,
    "fonts/jetbrainsmono/jetbrains-mono-latin.woff2",
    "font/woff2",
  ],
] as const;

const canonicalFontUrls = [
  [
    'url("fonts/bodonimoda/bodoni-moda-latin.woff2")',
    `url("${DASHBOARD_ASSET_PATHS.fonts.bodoniModa}")`,
  ],
  [
    'url("fonts/sourceserif4/source-serif-4-latin.woff2")',
    `url("${DASHBOARD_ASSET_PATHS.fonts.sourceSerif}")`,
  ],
  [
    'url("fonts/sourcesans3/source-sans-3-latin.woff2")',
    `url("${DASHBOARD_ASSET_PATHS.fonts.sourceSans}")`,
  ],
  [
    'url("fonts/jetbrainsmono/jetbrains-mono-latin.woff2")',
    `url("${DASHBOARD_ASSET_PATHS.fonts.jetBrainsMono}")`,
  ],
] as const;

function loadBrandBody(route: string, relativePath: string): string | Buffer {
  if (route !== DASHBOARD_ASSET_PATHS.tokens) {
    return readFileSync(resolve(brandRoot, relativePath));
  }
  let stylesheet = readFileSync(resolve(brandRoot, relativePath), "utf8");
  for (const [source, target] of canonicalFontUrls) {
    stylesheet = stylesheet.replaceAll(source, target);
  }
  return stylesheet;
}

/** Load only the fixed brand files used by the dashboard asset boundary. */
export function loadDashboardBrandAssets(): Readonly<
  Record<string, DashboardAsset>
> {
  return Object.fromEntries(
    brandFiles.map(([route, relativePath, contentType]) => [
      route,
      {
        body: loadBrandBody(route, relativePath),
        contentType,
      },
    ]),
  );
}

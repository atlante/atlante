import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(websiteRoot, "..");
const exportsDir = join(repoRoot, "brand", "assets", "exports");
const brandFontsDir = join(repoRoot, "brand", "fonts");
const publicDir = join(websiteRoot, "public");
const stylesDir = join(websiteRoot, "src", "styles");

// Static brand exports served verbatim. Only the sets the site references are
// copied: favicons, horizontal and glyph lockups, and the social image.
rmSync(join(publicDir, "brand"), { recursive: true, force: true });
mkdirSync(join(publicDir, "brand"), { recursive: true });

for (const set of ["favicons", "social", "glyph", "horizontal"]) {
  cpSync(join(exportsDir, set), join(publicDir, "brand", set), {
    recursive: true,
  });
}

cpSync(
  join(exportsDir, "social", "atlante-social.png"),
  join(publicDir, "og.png"),
);

// Theme-adaptive logos inline approved artwork through Astro, so the source
// exports they use are mirrored into src/assets on every sync.
const srcAssetsDir = join(websiteRoot, "src", "assets");
rmSync(srcAssetsDir, { recursive: true, force: true });
mkdirSync(srcAssetsDir, { recursive: true });
for (const [set, file] of [
  ["glyph", "atlante-glyph.svg"],
  ["horizontal", "atlante-horizontal.svg"],
] as const) {
  cpSync(join(exportsDir, set, file), join(srcAssetsDir, file));
}

// Copy the four approved families so each typographic role stays available.
rmSync(join(publicDir, "fonts"), { recursive: true, force: true });
for (const family of [
  "bodonimoda",
  "sourceserif4",
  "sourcesans3",
  "jetbrainsmono",
]) {
  cpSync(join(brandFontsDir, family), join(publicDir, "fonts", family), {
    recursive: true,
  });
}

// Derived tokens stylesheet with root-relative font URLs. Regenerated on
// every dev/build run; never edit it directly.
const source = readFileSync(
  join(repoRoot, "brand", "atlante-design-tokens.css"),
  "utf8",
);
const tokens = source.replaceAll('url("fonts/', 'url("/fonts/');
writeFileSync(join(stylesDir, "atlante-tokens.css"), tokens);

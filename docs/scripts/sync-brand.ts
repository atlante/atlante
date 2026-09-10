import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(docsRoot, "..");
const exportsDir = join(repoRoot, "brand", "assets", "exports");
const publicDir = join(docsRoot, "public");
const assetsDir = join(docsRoot, "src", "assets");
const stylesDir = join(docsRoot, "src", "styles");
const families = ["bodonimoda", "sourceserif4", "sourcesans3", "jetbrainsmono"];

rmSync(join(publicDir, "brand"), { recursive: true, force: true });
mkdirSync(join(publicDir, "brand"), { recursive: true });
cpSync(join(exportsDir, "favicons"), join(publicDir, "brand", "favicons"), {
  recursive: true,
});

rmSync(join(publicDir, "fonts"), { recursive: true, force: true });
for (const family of families) {
  cpSync(
    join(repoRoot, "brand", "fonts", family),
    join(publicDir, "fonts", family),
    { recursive: true },
  );
}

rmSync(assetsDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });
const logoFile = "atlante-horizontal.svg";
const logo = readFileSync(join(exportsDir, "horizontal", logoFile), "utf8");
writeFileSync(
  join(assetsDir, logoFile),
  logo.replaceAll('url("../../../fonts/', 'url("/fonts/'),
);

const source = readFileSync(
  join(repoRoot, "brand", "atlante-design-tokens.css"),
  "utf8",
);
writeFileSync(
  join(stylesDir, "atlante-tokens.css"),
  source.replaceAll('url("fonts/', 'url("/fonts/'),
);

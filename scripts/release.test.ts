import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePins } from "./release.js";

test("release pin validation accepts an exact website CLI version", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlante-release-pin-"));
  try {
    const website = join(root, "website");
    mkdirSync(website);
    const manifest = join(website, "package.json");
    const contents = JSON.stringify({ dependencies: { atlante: "0.3.0" } });
    writeFileSync(manifest, contents);

    await validatePins(root);
    expect(readFileSync(manifest, "utf8")).toBe(contents);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release pin validation rejects ranges and missing pins", async () => {
  for (const dependencies of [{ atlante: "^0.3.0" }, {}]) {
    const root = mkdtempSync(join(tmpdir(), "atlante-release-pin-"));
    try {
      const website = join(root, "website");
      mkdirSync(website);
      writeFileSync(
        join(website, "package.json"),
        JSON.stringify({ dependencies }),
      );

      let failure: unknown;
      try {
        await validatePins(root);
      } catch (cause) {
        failure = cause;
      }

      expect(String(failure)).toMatch(/must pin|does not declare/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { resolveFirstPartyPack } from "../src/first-party-pack.js";

const created: string[] = [];
const expectedPackRoot = fileURLToPath(new URL("../../pack/", import.meta.url));
const firstPartyPackVersion = (
  JSON.parse(
    readFileSync(new URL("../../pack/package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("resolves the first-party pack from the CLI installation, not cwd", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-first-party-pack-"));
  created.push(directory);
  mkdirSync(join(directory, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(directory, "node_modules", "@atlante", "pack", "package.json"),
    '{ "name": "@atlante/pack", "version": "99.0.0", "atlante": { "format": 2 } }\n',
  );

  const previous = process.cwd();
  try {
    process.chdir(directory);
    const pack = resolveFirstPartyPack();
    expect(pack.root).toBe(realpathSync(expectedPackRoot));
    expect(pack.package?.name).toBe("@atlante/pack");
    expect(pack.package?.version).toBe(firstPartyPackVersion);
  } finally {
    process.chdir(previous);
  }
});

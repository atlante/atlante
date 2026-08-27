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
import { afterEach, expect, test } from "vitest";
import { resolveFirstPartyPack } from "../src/first-party-pack.js";

const created: string[] = [];
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

  const pack = resolveFirstPartyPack();
  expect(pack.root).not.toBe(realpathSync(directory));
  expect(pack.package?.name).toBe("@atlante/pack");
  expect(pack.package?.version).toBe(firstPartyPackVersion);
});

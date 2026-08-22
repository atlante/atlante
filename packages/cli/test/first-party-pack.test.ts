import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { resolveFirstPartyPack } from "../src/first-party-pack.js";

const created: string[] = [];
const expectedPackRoot = dirname(
  fileURLToPath(import.meta.resolve("@atlante/pack/package.json")),
);

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

  expect(pack.root).toBe(realpathSync(expectedPackRoot));
  expect(pack.package?.name).toBe("@atlante/pack");
  expect(pack.package?.version).toBe("0.1.6");
});

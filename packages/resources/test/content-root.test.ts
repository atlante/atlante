import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createProjectResourcePack,
  isResourcePackPathContained,
  resourcePackMetadataPaths,
} from "../src/index.js";

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("resource content roots", () => {
  test("captures an absolute project root and rejects sibling traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-content-root-"));
    created.push(root);
    mkdirSync(join(root, "nested"));

    const pack = createProjectResourcePack(root);
    const canonicalRoot = realpathSync(root);

    expect(pack.kind).toBe("project");
    expect(pack.root).toBe(canonicalRoot);
    expect(
      isResourcePackPathContained(pack, join(canonicalRoot, "nested", "file")),
    ).toBe(true);
    expect(
      isResourcePackPathContained(pack, join(canonicalRoot, "..", "outside")),
    ).toBe(false);
    expect(resourcePackMetadataPaths(pack)).toEqual([]);
  });

  test("does not authorize a symlinked child that leaves the captured root", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-content-root-"));
    const outside = mkdtempSync(join(tmpdir(), "atlante-content-outside-"));
    created.push(root, outside);
    symlinkSync(outside, join(root, "escape"), "dir");

    const pack = createProjectResourcePack(root);
    const canonicalEscape = realpathSync(join(root, "escape"));

    expect(
      isResourcePackPathContained(pack, join(canonicalEscape, "file")),
    ).toBe(false);
  });
});

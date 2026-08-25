import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { acquireMutationCampaign, resolveMutationRoot } from "./mutation-root";

test("uses the repository-relative mutation directory by default", () => {
  expect(resolveMutationRoot(undefined, "/repo")).toBe("mutation");
});

test("accepts an existing root inside the OS temp directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-mutation-root-"));
  try {
    expect(resolveMutationRoot(root, "/repo")).toBe(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  ["relative", "mutation-root"],
  ["traversal", join(tmpdir(), "atlante-mutation-root-..", "..", "outside")],
  ["outside", "/var/tmp/atlante-mutation-root-outside"],
])("rejects %s mutation roots", ([, root]) => {
  expect(() => resolveMutationRoot(root, "/repo")).toThrow(
    "ATLANTE_MUTATION_ROOT must be an absolute path inside os.tmpdir()",
  );
});

test("rejects a temp-directory symlink whose real path escapes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "atlante-mutation-root-"));
  const outside = "/";
  const link = join(parent, "link");
  try {
    await symlink(outside, link);
    expect(() => resolveMutationRoot(link, "/repo")).toThrow(
      "ATLANTE_MUTATION_ROOT must be an absolute path inside os.tmpdir()",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("isolates concurrent temp roots", async () => {
  const roots = await Promise.all(
    Array.from({ length: 2 }, () =>
      mkdtemp(join(tmpdir(), "atlante-mutation-")),
    ),
  );
  try {
    expect(new Set(roots).size).toBe(2);
  } finally {
    await Promise.all(
      roots.map((root) => rm(root, { recursive: true, force: true })),
    );
  }
});

test("cleans stale temp directories only after acquiring the workspace lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-mutation-"));
  const workspaceRoot = join(root, "schema");
  const lock = join(workspaceRoot, ".campaign-lock");
  const stale = join(workspaceRoot, "temp-123");
  await mkdir(stale, { recursive: true });
  try {
    const release = await acquireMutationCampaign(root, "schema");
    await expect(readFile(lock, "utf8")).resolves.toBe(String(process.pid));
    await expect(readFile(stale, "utf8")).rejects.toThrow();
    expect(() => acquireMutationCampaign(root, "schema")).toThrow(
      "mutation campaign already active",
    );
    await release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes a dead campaign lock and its temp residue", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-mutation-"));
  const lock = join(root, "schema", ".campaign-lock");
  const stale = join(root, "schema", "temp-456");
  await mkdir(stale, { recursive: true });
  await mkdir(join(root, "schema"), { recursive: true });
  await writeFile(lock, "999999");
  try {
    const release = await acquireMutationCampaign(root, "schema");
    await expect(readFile(lock, "utf8")).resolves.toBe(String(process.pid));
    await expect(readFile(stale, "utf8")).rejects.toThrow();
    await release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not delete a fresh lock while its owner metadata is being published", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-mutation-"));
  const lock = join(root, "schema", ".campaign-lock");
  await mkdir(join(root, "schema"), { recursive: true });
  await writeFile(lock, "");
  try {
    expect(() => acquireMutationCampaign(root, "schema")).toThrow(
      "mutation campaign already active",
    );
    await expect(readFile(lock, "utf8")).resolves.toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers an old lock with incomplete metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-mutation-"));
  const lock = join(root, "schema", ".campaign-lock");
  await mkdir(join(root, "schema"), { recursive: true });
  await writeFile(lock, "not-a-pid");
  await utimes(lock, new Date(0), new Date(0));
  try {
    const release = await acquireMutationCampaign(root, "schema");
    await release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a live owner blocks a second campaign", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-mutation-"));
  const lock = join(root, "schema", ".campaign-lock");
  await mkdir(join(root, "schema"), { recursive: true });
  await writeFile(lock, String(process.pid));
  try {
    expect(() => acquireMutationCampaign(root, "schema")).toThrow(
      "mutation campaign already active",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a fresh dead owner is recovered without waiting for the stale timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-mutation-"));
  const lock = join(root, "schema", ".campaign-lock");
  await mkdir(join(root, "schema"), { recursive: true });
  await writeFile(lock, "999999");
  try {
    const release = await acquireMutationCampaign(root, "schema");
    await release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release does not remove a lock replaced by another owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-mutation-"));
  const lock = join(root, "schema", ".campaign-lock");
  await mkdir(join(root, "schema"), { recursive: true });
  try {
    const release = await acquireMutationCampaign(root, "schema");
    await rm(lock);
    await writeFile(lock, "999999");
    await release();
    await expect(readFile(lock, "utf8")).resolves.toBe("999999");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

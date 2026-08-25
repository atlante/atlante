import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
  canonicalMutationVerdict,
  hashMutationVerdict,
  hashSourceFiles,
  type MutationReport,
  type MutationVerdictEntry,
  RESOURCE_SOURCE_ALGORITHM,
  resourceSourceFiles,
  sourceFiles,
} from "./mutation-evidence";

const workspaces = [
  {
    evidencePath: "mutation-evidence/resources-mutation.json",
    sourceRoot: "packages/resources/src",
    sourceFiles: resourceSourceFiles,
    workspace: "resources",
  },
  {
    evidencePath: "mutation-evidence/schema-mutation.json",
    sourceRoot: "packages/schema/src",
    sourceFiles: (root: string) => sourceFiles(root, "packages/schema/src"),
    workspace: "schema",
  },
  {
    evidencePath: "mutation-evidence/validator-mutation.json",
    sourceRoot: "packages/validator/src",
    sourceFiles: (root: string) => sourceFiles(root, "packages/validator/src"),
    workspace: "validator",
  },
] as const;

test.each(workspaces)(
  "validates durable $workspace mutation evidence and an ignored report when present",
  async ({
    evidencePath,
    sourceFiles: readSourceFiles,
    sourceRoot,
    workspace,
  }) => {
    const evidence = JSON.parse(
      await readFile(resolve(evidencePath), "utf8"),
    ) as Evidence;
    if (workspace === "schema") {
      expect(evidence).toMatchObject({
        reproducibility: {
          campaigns: 2,
          comparison: "source-file-and-mutant-id-plus-status",
          exact: true,
          runtimes: ["0m57s", "0m57s"],
          exitCodes: [0, 0],
          manifests: [
            "mutation-evidence/schema-run1.json",
            "mutation-evidence/schema-run2.json",
          ],
          verdictEntries: 188,
          verdictSha256:
            "104bf4cccd3b885deba7e7ce4de4b12fdb37ac836cf6fe88589e346cc096c187",
        },
      });
    }
    expect(evidence).toMatchObject({
      schemaVersion: 2,
      workspace,
      command: `bun run mutation:test ${workspace}`,
      source: {
        identity: `${sourceRoot}/**/*.ts`,
        algorithm: RESOURCE_SOURCE_ALGORITHM,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        files: expect.any(Array),
        fileCount: expect.any(Number),
      },
      report: {
        identity: `mutation/${workspace}/mutation.json`,
      },
      versions: {
        bun: expect.any(String),
        node: expect.any(String),
        vitest: expect.any(String),
        stryker: expect.any(String),
      },
      runtime: expect.stringMatching(/^\d+m\d+s$/),
      commitBase: expect.stringMatching(/^[0-9a-f]{7,40}$/),
      exitCode: 0,
      counts: {
        files: expect.any(Number),
        mutants: expect.any(Number),
        killed: expect.any(Number),
        survived: expect.any(Number),
        noCoverage: expect.any(Number),
        mutationScore: expect.any(Number),
        timeouts: 0,
        errors: 0,
        ignored: expect.any(Number),
      },
    });
    expect(
      evidence.counts.killed +
        evidence.counts.survived +
        evidence.counts.noCoverage +
        evidence.counts.ignored,
    ).toBe(evidence.counts.mutants);
    expect(evidence.counts.mutationScore).toBe(
      Math.round(
        (evidence.counts.killed /
          (evidence.counts.killed +
            evidence.counts.survived +
            evidence.counts.noCoverage)) *
          10000,
      ) / 100,
    );
    expect(evidence.source.sha256).toBe(
      hashSourceFiles(await readSourceFiles(".")),
    );
    const currentSource = await readSourceFiles(".");
    expect(evidence.source.files).toEqual(
      currentSource.map((file) => file.path),
    );
    expect(evidence.source.fileCount).toBe(currentSource.length);

    const report = await readOptionalReport(evidence.report.identity);
    if (report) await validateReport(report, evidence);
  },
);

test("schema run manifests independently prove exact verdict identity", async () => {
  const run1 = await readManifest("mutation-evidence/schema-run1.json");
  const run2 = await readManifest("mutation-evidence/schema-run2.json");

  validateManifest(run1, 1);
  validateManifest(run2, 2);
  expect(run1.verdict).toEqual(run2.verdict);
  expect(run1.verdictSha256).toBe(run2.verdictSha256);

  const report = await readOptionalReport("mutation/schema/mutation.json");
  if (report) {
    expect(canonicalMutationVerdict(report)).toEqual(run1.verdict);
    expect(hashMutationVerdict(canonicalMutationVerdict(report))).toBe(
      run1.verdictSha256,
    );
  }
});

type Evidence = {
  workspace: string;
  source: { sha256: string; files: string[]; fileCount: number };
  report: { identity: string };
  counts: Record<string, number>;
};

type Manifest = {
  schemaVersion: number;
  workspace: string;
  run: number;
  algorithm: string;
  verdictSha256: string;
  counts: { entries: number; files: number; statuses: Record<string, number> };
  verdict: MutationVerdictEntry[];
};

async function readOptionalReport(
  path: string,
): Promise<MutationReport | undefined> {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8")) as MutationReport;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function validateReport(
  report: MutationReport,
  evidence: Evidence,
): Promise<void> {
  const verdict = canonicalMutationVerdict(report);
  const mutants = verdict;
  const counts = mutants.reduce<Record<string, number>>((result, mutant) => {
    result[mutant.status] = (result[mutant.status] ?? 0) + 1;
    return result;
  }, {});
  expect(Object.values(report.files)).toHaveLength(evidence.counts.files);
  expect(mutants).toHaveLength(evidence.counts.mutants);
  expect(counts.Killed).toBe(evidence.counts.killed);
  expect(counts.Survived).toBe(evidence.counts.survived);
  expect(counts.NoCoverage).toBe(evidence.counts.noCoverage);
  expect(counts.Timeout ?? 0).toBe(evidence.counts.timeouts);
  expect((counts.CompileError ?? 0) + (counts.RuntimeError ?? 0)).toBe(
    evidence.counts.errors,
  );
  expect(counts.Ignored ?? 0).toBe(evidence.counts.ignored);
  if (evidence.workspace === "schema") {
    const manifest = await readManifest("mutation-evidence/schema-run1.json");
    expect(verdict).toEqual(manifest.verdict);
    expect(hashMutationVerdict(verdict)).toBe(manifest.verdictSha256);
    expect(counts).toEqual(manifest.counts.statuses);
  }
}

async function readManifest(path: string): Promise<Manifest> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as Manifest;
}

function validateManifest(manifest: Manifest, expectedRun: number): void {
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.workspace).toBe("schema");
  expect(manifest.run).toBe(expectedRun);
  expect(manifest.algorithm).toBe(
    "sha256:json(sorted-source-mutantId-status):v1",
  );
  expect(manifest.verdict).toHaveLength(manifest.counts.entries);
  expect(hashMutationVerdict(manifest.verdict)).toBe(manifest.verdictSha256);
  expect(
    manifest.verdict.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.status] = (counts[entry.status] ?? 0) + 1;
      return counts;
    }, {}),
  ).toEqual(manifest.counts.statuses);
  expect(new Set(manifest.verdict.map((entry) => entry.source)).size).toBe(
    manifest.counts.files,
  );
}

test("source identity changes when content or path changes", () => {
  const original = [
    { path: "packages/resources/src/a.ts", bytes: Buffer.from("a") },
  ];
  expect(hashSourceFiles(original)).not.toBe(
    hashSourceFiles([
      { path: "packages/resources/src/a.ts", bytes: Buffer.from("b") },
    ]),
  );
  expect(hashSourceFiles(original)).not.toBe(
    hashSourceFiles([
      { path: "packages/resources/src/b.ts", bytes: Buffer.from("a") },
    ]),
  );
});

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
  hashSourceFiles,
  RESOURCE_SOURCE_ALGORITHM,
  resourceSourceFiles,
} from "./mutation-evidence";

const evidencePath = resolve("mutation-evidence/resources-mutation.json");
const reportPath = resolve("mutation/resources/mutation.json");

test("validates durable mutation evidence and the ignored report when present", async () => {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
    schemaVersion: number;
    workspace: string;
    command: string;
    source: {
      identity: string;
      algorithm: string;
      sha256: string;
      files: string[];
      fileCount: number;
    };
    report: { identity: string; sha256: string };
    versions: Record<string, string>;
    runtime: string;
    exitCode: number;
    counts: Record<string, number>;
  };
  expect(evidence).toMatchObject({
    schemaVersion: expect.any(Number),
    workspace: "resources",
    command: "bun run mutation:test resources",
    source: {
      identity: "packages/resources/src/**/*.ts",
      algorithm: RESOURCE_SOURCE_ALGORITHM,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
    report: {
      identity: "mutation/resources/mutation.json",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
    versions: {
      bun: expect.any(String),
      node: expect.any(String),
      vitest: expect.any(String),
      stryker: expect.any(String),
    },
    runtime: expect.stringMatching(/^\d+m\d+s$/),
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
      ignored: 0,
    },
  });
  expect(
    evidence.counts.killed +
      evidence.counts.survived +
      evidence.counts.noCoverage,
  ).toBe(evidence.counts.mutants);
  expect(evidence.counts.mutationScore).toBe(
    Math.round((evidence.counts.killed / evidence.counts.mutants) * 10000) /
      100,
  );
  expect(evidence.source.sha256).toBe(
    hashSourceFiles(await resourceSourceFiles(".")),
  );
  const currentSource = await resourceSourceFiles(".");
  expect(evidence.source.files).toEqual(currentSource.map((file) => file.path));
  expect(evidence.source.fileCount).toBe(currentSource.length);

  const report = await readOptionalReport();
  if (!report) {
    expect(
      evidence.report.identity,
      "checked-in evidence is the durable mutation record when the ignored report is absent",
    ).toBe("mutation/resources/mutation.json");
  }
  if (report) await validateReport(report, evidence);
});

type MutationReport = {
  files: Record<string, { mutants: { status: string }[] }>;
};

async function readOptionalReport(): Promise<MutationReport | undefined> {
  try {
    await access(reportPath);
    return JSON.parse(await readFile(reportPath, "utf8")) as MutationReport;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function validateReport(
  report: MutationReport,
  evidence: { counts: Record<string, number>; report: { sha256: string } },
): Promise<void> {
  const reportBytes = await readFile(reportPath);
  expect(createHash("sha256").update(reportBytes).digest("hex")).toBe(
    evidence.report.sha256,
  );
  const mutants = Object.values(report.files).flatMap((file) => file.mutants);
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

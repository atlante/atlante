import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { mutationPreflightRefreshEnabled } from "./mutation";
import {
  canonicalMutationVerdict,
  hashMutationVerdict,
  hashSourceFiles,
  type MutationReport,
  type MutationVerdictEntry,
  mutationVerdictCounts,
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
    manifestPath: "mutation-evidence/resources-verdict.json",
  },
  {
    evidencePath: "mutation-evidence/schema-mutation.json",
    sourceRoot: "packages/schema/src",
    sourceFiles: (root: string) => sourceFiles(root, "packages/schema/src"),
    workspace: "schema",
    manifestPath: "mutation-evidence/schema-run2.json",
  },
  {
    evidencePath: "mutation-evidence/validator-mutation.json",
    sourceRoot: "packages/validator/src",
    sourceFiles: (root: string) => sourceFiles(root, "packages/validator/src"),
    workspace: "validator",
    manifestPath: "mutation-evidence/validator-verdict.json",
  },
] as const;

const expectedCounts = {
  schema: {
    files: 2,
    mutants: 188,
    killed: 130,
    survived: 14,
    noCoverage: 1,
    mutationScore: 89.66,
    timeouts: 0,
    errors: 0,
    ignored: 43,
  },
  resources: {
    files: 20,
    mutants: 4861,
    killed: 3087,
    survived: 1335,
    noCoverage: 439,
    mutationScore: 63.51,
    timeouts: 0,
    errors: 0,
    ignored: 0,
  },
  validator: {
    files: 5,
    mutants: 1338,
    killed: 956,
    survived: 295,
    noCoverage: 86,
    mutationScore: 71.5,
    timeouts: 0,
    errors: 0,
    ignored: 1,
  },
} as const;

test.each(workspaces)(
  "validates durable $workspace mutation evidence and an ignored report when present",
  async ({
    evidencePath,
    sourceFiles: readSourceFiles,
    sourceRoot,
    workspace,
    manifestPath,
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
          runtimes: ["1m10s", "1m7s"],
          exitCodes: [0, 0],
          manifests: [
            "mutation-evidence/schema-run1.json",
            "mutation-evidence/schema-run2.json",
          ],
          preflightRecords: [
            "mutation-evidence/schema-run1-preflight.json",
            "mutation-evidence/schema-run2-preflight.json",
          ],
          campaignRecords: [
            "mutation-evidence/schema-run1-campaign.json",
            "mutation-evidence/schema-run2-campaign.json",
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
        ...expectedCounts[workspace],
      },
      attestation: {
        preflight: {
          identity: expect.stringContaining("mutation-evidence/"),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        campaign: {
          identity: expect.stringContaining("mutation-evidence/"),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
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
    const currentSource = await readSourceFiles(".");
    if (!mutationPreflightRefreshEnabled()) {
      expect(evidence.source.sha256).toBe(hashSourceFiles(currentSource));
      expect(evidence.source.files).toEqual(
        currentSource.map((file) => file.path),
      );
      expect(evidence.source.fileCount).toBe(currentSource.length);
    }

    const attestation = await readAttestation(evidence);
    await validateAttestation(attestation, evidence, workspace, manifestPath);
    for (const record of evidence.attestations) {
      const tracked = await readAttestation({ attestation: record });
      await validateAttestation(
        tracked,
        evidence,
        workspace,
        record.manifest.identity,
        record,
      );
    }

    const tracked = (await readdir(resolve("mutation-evidence")))
      .filter((path) => /(?:preflight|campaign)\.json$/.test(path))
      .sort();
    const allEvidence = await Promise.all(
      workspaces.map(
        async ({ evidencePath }) =>
          JSON.parse(await readFile(resolve(evidencePath), "utf8")) as Evidence,
      ),
    );
    const expected = allEvidence
      .flatMap((item) => [item.attestation, ...item.attestations])
      .flatMap((record) => [
        record.preflight.identity,
        record.campaign.identity,
      ])
      .map((path) => path.replace(/^mutation-evidence\//, ""))
      .filter((path, index, paths) => paths.indexOf(path) === index)
      .sort();
    expect(tracked).toEqual(expected);

    const report = await readOptionalReport(evidence.report.identity);
    if (report) {
      await validateReport(report, evidence);
      await expect(hashFile(evidence.report.identity)).resolves.toBe(
        attestation.campaign.report.sha256,
      );
      for (const record of [evidence.attestation, ...evidence.attestations]) {
        const campaign = await readAttestation({ attestation: record });
        const manifest = await readManifest(record.manifest.identity);
        expect(await hashFile(evidence.report.identity)).toBe(
          campaign.campaign.report.sha256,
        );
        expect(canonicalMutationVerdict(report)).toEqual(manifest.verdict);
        expect(hashMutationVerdict(canonicalMutationVerdict(report))).toBe(
          campaign.campaign.verdict.sha256,
        );
      }
      if (workspace === "schema") await validateIgnoredDispositions(report);
    }
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
  attestation: {
    preflight: { identity: string; sha256: string };
    campaign: { identity: string; sha256: string };
    manifest: { identity: string; sha256: string };
  };
  attestations: Evidence["attestation"][];
  manifestPath: string;
};

type PreflightRecord = {
  schemaVersion: 1;
  campaignId: string;
  command: string;
  status: string;
  exitCode: number;
  counts: { testFiles: { total: number }; tests: { total: number } };
  sourceSha256: string;
  configSha256: string;
  gitHead: string;
  toolVersions: Record<string, string>;
};

type Attestation = { preflight: PreflightRecord; campaign: CampaignRecord };

type CampaignRecord = {
  schemaVersion: 2;
  workspace: string;
  campaignId: string;
  preflight: { identity: string; sha256: string };
  report: { identity: string; sha256?: string };
  verdict: {
    identity: string;
    sha256: string;
    counts: ReturnType<typeof mutationVerdictCounts>;
  };
  source: { identity: string; sha256: string };
  config: { identity: string; sha256: string };
  stryker: { startedAt: string; endedAt: string; runtimeMs: number };
  exitCode: number;
  signal: string | null;
  gitHead: string;
  toolVersions: Record<string, string>;
};

type Manifest = {
  schemaVersion: number;
  workspace: string;
  run?: number;
  algorithm?: string;
  campaignId: string;
  rawReportSha256: string;
  verdictSha256: string;
  counts: { entries: number; files: number; statuses: Record<string, number> };
  verdict: MutationVerdictEntry[];
};

type IgnoredDisposition = {
  source: string;
  id: string;
  mutator: string;
  start: unknown;
  end: unknown;
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

async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(resolve(path)))
    .digest("hex");
}

async function readAttestation(
  evidence: Pick<Evidence, "attestation">,
): Promise<Attestation> {
  const preflightBytes = await readFile(
    resolve(evidence.attestation.preflight.identity),
  );
  const campaignBytes = await readFile(
    resolve(evidence.attestation.campaign.identity),
  );
  expect(createHash("sha256").update(preflightBytes).digest("hex")).toBe(
    evidence.attestation.preflight.sha256,
  );
  expect(createHash("sha256").update(campaignBytes).digest("hex")).toBe(
    evidence.attestation.campaign.sha256,
  );
  return {
    preflight: JSON.parse(preflightBytes.toString("utf8")) as PreflightRecord,
    campaign: JSON.parse(campaignBytes.toString("utf8")) as CampaignRecord,
  };
}

async function validateAttestation(
  attestation: { preflight: PreflightRecord; campaign: CampaignRecord },
  evidence: Evidence,
  workspace: string,
  manifestPath: string,
  expected = evidence.attestation,
): Promise<void> {
  const { campaign, preflight } = attestation;
  const manifestBytes = await readFile(resolve(manifestPath));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
  expect(createHash("sha256").update(manifestBytes).digest("hex")).toBe(
    expected.manifest.sha256,
  );
  expect(preflight.schemaVersion).toBe(1);
  expect(campaign.schemaVersion).toBe(2);
  expect(preflight.campaignId).toBe(campaign.campaignId);
  expect(campaign.workspace).toBe(workspace);
  expect(preflight.command).toBe("bun run test");
  expect(preflight.status).toBe("passed");
  expect(preflight.exitCode).toBe(0);
  expect(["ordinary", "stale-source-bootstrap"]).toContain(
    preflight.refreshMode,
  );
  expect(preflight.counts.testFiles.total).toBe(53);
  expect(preflight.counts.tests.total).toBe(829);
  expect(campaign.exitCode).toBe(0);
  expect(campaign.signal).toBeNull();
  expect(campaign.preflight.sha256).toBe(expected.preflight.sha256);
  expect(campaign.source).toEqual({
    identity: evidence.source.identity,
    sha256: evidence.source.sha256,
  });
  expect(preflight.sourceSha256).toBe(campaign.source.sha256);
  expect(preflight.sourceSha256).toBe(evidence.source.sha256);
  expect(campaign.config.identity).toBe("stryker.config.ts");
  const currentConfigSha256 = hashSourceFiles([
    { path: "stryker.config.ts", bytes: await readFile("stryker.config.ts") },
  ]);
  expect(preflight.configSha256).toBe(campaign.config.sha256);
  expect(preflight.configSha256).toBe(currentConfigSha256);
  expect(campaign.gitHead).toMatch(/^[0-9a-f]{7,40}$/);
  expect(campaign.gitHead).toBe(preflight.gitHead);
  expect(campaign.toolVersions).toEqual(preflight.toolVersions);
  expect(campaign.report.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(campaign.report.sha256).toBe(manifest.rawReportSha256);
  expect(campaign.verdict.sha256).toBe(manifest.verdictSha256);
  expect(campaign.verdict.counts).toEqual(manifest.counts);
  expect(manifest.campaignId).toBe(campaign.campaignId);
  expect(manifest.workspace).toBe(workspace);
  expect(hashMutationVerdict(manifest.verdict)).toBe(manifest.verdictSha256);
  expect(mutationVerdictCounts(manifest.verdict)).toEqual(manifest.counts);
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

async function validateIgnoredDispositions(
  report: MutationReport,
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(
      resolve("mutation-evidence/schema-ignored-dispositions.json"),
      "utf8",
    ),
  ) as { count: number; mutants: IgnoredDisposition[] };
  const ignored = Object.entries(report.files)
    .flatMap(([source, file]) =>
      file.mutants
        .filter((mutant) => mutant.status === "Ignored")
        .map((mutant) => ({
          source,
          id: mutant.id,
          location: mutant.location,
          mutator: mutant.mutatorName,
        })),
    )
    .sort((left, right) =>
      `${left.source}:${left.id}`.localeCompare(
        `${right.source}:${right.id}`,
        undefined,
        {
          numeric: true,
        },
      ),
    );
  expect(manifest.count).toBe(ignored.length);
  expect(
    manifest.mutants.map(({ source, id, mutator, start, end }) => ({
      source,
      id,
      location: { start, end },
      mutator,
    })),
  ).toEqual(ignored);
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
  expect(manifest.campaignId).toMatch(/^[0-9a-f-]{36}$/);
  expect(manifest.rawReportSha256).toMatch(/^[a-f0-9]{64}$/);
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

test.each([
  [
    "preflight source digest",
    (attestation: Attestation) => {
      attestation.preflight.sourceSha256 = "0".repeat(64);
    },
  ],
  [
    "campaign source digest",
    (attestation: Attestation) => {
      attestation.campaign.source.sha256 = "0".repeat(64);
    },
  ],
  [
    "preflight config digest",
    (attestation: Attestation) => {
      attestation.preflight.configSha256 = "0".repeat(64);
    },
  ],
  [
    "campaign config digest",
    (attestation: Attestation) => {
      attestation.campaign.config.sha256 = "0".repeat(64);
    },
  ],
])("rejects a mismatched %s attestation digest", async (_name, mutate) => {
  const evidence = JSON.parse(
    await readFile("mutation-evidence/schema-mutation.json", "utf8"),
  ) as Evidence;
  const attestation = await readAttestation(evidence);
  mutate(attestation);
  await expect(
    validateAttestation(
      attestation,
      evidence,
      "schema",
      "mutation-evidence/schema-run2.json",
    ),
  ).rejects.toThrow();
});

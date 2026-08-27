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
  type mutationVerdictCounts,
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
  }) => {
    const evidence = JSON.parse(
      await readFile(resolve(evidencePath), "utf8"),
    ) as Evidence;
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
      attestations: expect.any(Array),
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

    await validateAttestations(evidence, workspace);
    await validateEvidenceInventory();

    const report = await readOptionalReport(evidence.report.identity);
    await validateReportEvidence(report, evidence, workspace);
  },
);

async function validateAttestations(
  evidence: Evidence,
  workspace: string,
): Promise<void> {
  expect(evidence.attestations).toHaveLength(workspace === "schema" ? 2 : 1);
  for (const record of evidence.attestations) {
    await validateAttestation(
      await readAttestation({ attestation: record }),
      evidence,
      workspace,
      record,
    );
  }
  if (workspace !== "schema") return;
  await validateSchemaReproducibility(evidence);
}

async function validateSchemaReproducibility(
  evidence: Evidence,
): Promise<void> {
  const canonical = await readManifest("mutation-evidence/schema-verdict.json");
  validateManifest(canonical);
  expect(evidence.reproducibility?.canonicalManifest).toBe(
    "mutation-evidence/schema-verdict.json",
  );
  expect(evidence.reproducibility?.verdictSha256).toBe(canonical.verdictSha256);
  expect(evidence.reproducibility?.verdictEntries).toBe(
    canonical.counts.entries,
  );
  const campaigns = await Promise.all(
    evidence.attestations.map((record) =>
      readAttestation({ attestation: record }),
    ),
  );
  expect(
    new Set(campaigns.map(({ campaign }) => campaign.campaignId)).size,
  ).toBe(2);
  for (const { campaign } of campaigns) {
    expect(campaign.verdict?.sha256).toBe(canonical.verdictSha256);
    expect(campaign.verdict?.counts).toEqual(canonical.counts);
  }
}

async function validateEvidenceInventory(): Promise<void> {
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
    .flatMap((item) => item.attestations)
    .flatMap((record) => [record.preflight.identity, record.campaign.identity])
    .map((path) => path.replace(/^mutation-evidence\//, ""))
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort();
  expect(tracked).toEqual(expected);
  expect(
    (await readdir(resolve("mutation-evidence")))
      .filter((path) => path.endsWith(".json"))
      .sort(),
  ).toEqual([
    "resources-campaign.json",
    "resources-mutation.json",
    "resources-preflight.json",
    "schema-ignored-dispositions.json",
    "schema-mutation.json",
    "schema-run1-campaign.json",
    "schema-run1-preflight.json",
    "schema-run2-campaign.json",
    "schema-run2-preflight.json",
    "schema-verdict.json",
    "validator-campaign.json",
    "validator-mutation.json",
    "validator-preflight.json",
  ]);
}

async function validateReportEvidence(
  report: MutationReport | undefined,
  evidence: Evidence,
  workspace: string,
): Promise<void> {
  if (!report) return;
  await validateReport(report, evidence);
  for (const record of evidence.attestations) {
    const campaign = await readAttestation({ attestation: record });
    expect(await hashFile(evidence.report.identity)).toBe(
      campaign.campaign.report.sha256,
    );
    expect(hashMutationVerdict(canonicalMutationVerdict(report))).toBe(
      campaign.campaign.verdict?.sha256,
    );
  }
  if (workspace === "schema") await validateIgnoredDispositions(report);
}

test("schema run manifests independently prove exact verdict identity", async () => {
  const canonical = await readManifest("mutation-evidence/schema-verdict.json");

  validateManifest(canonical);
  const evidence = JSON.parse(
    await readFile("mutation-evidence/schema-mutation.json", "utf8"),
  ) as Evidence;
  const campaigns = await Promise.all(
    evidence.attestations.map(async (record) =>
      readAttestation({ attestation: record }),
    ),
  );
  expect(campaigns).toHaveLength(2);
  expect(campaigns.map(({ campaign }) => campaign.verdict?.sha256)).toEqual([
    canonical.verdictSha256,
    canonical.verdictSha256,
  ]);
  expect(campaigns.map(({ campaign }) => campaign.verdict?.counts)).toEqual([
    canonical.counts,
    canonical.counts,
  ]);

  const report = await readOptionalReport("mutation/schema/mutation.json");
  if (report) {
    expect(canonicalMutationVerdict(report)).toEqual(canonical.verdict);
    expect(hashMutationVerdict(canonicalMutationVerdict(report))).toBe(
      canonical.verdictSha256,
    );
  }
});

type Evidence = {
  workspace: string;
  source: { sha256: string; files: string[]; fileCount: number };
  report: { identity: string };
  counts: Record<string, number>;
  commitBase: string;
  reproducibility?: {
    canonicalManifest?: string;
    verdictEntries?: number;
    verdictSha256?: string;
  };
  attestations: {
    preflight: { identity: string; sha256: string };
    campaign: { identity: string; sha256: string };
  }[];
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
  algorithm?: string;
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

async function readAttestation(evidence: {
  attestation: Evidence["attestations"][number];
}): Promise<Attestation> {
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
  expected: Evidence["attestations"][number],
): Promise<void> {
  const { campaign, preflight } = attestation;
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
  expect(campaign.report.identity).toBe(evidence.report.identity);
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
  expect(campaign.gitHead).toBe(evidence.commitBase);
  expect(campaign.toolVersions).toEqual(preflight.toolVersions);
  expect(campaign.report.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(campaign.verdict?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(campaign.verdict?.counts.entries).toBe(evidence.counts.mutants);
  expect(campaign.verdict?.counts.files).toBe(evidence.counts.files);
  expect(campaign.verdict?.counts.statuses).toEqual({
    Killed: evidence.counts.killed,
    Survived: evidence.counts.survived,
    NoCoverage: evidence.counts.noCoverage,
    ...(evidence.counts.ignored > 0
      ? { Ignored: evidence.counts.ignored }
      : {}),
  });
  expect(campaign.verdict?.identity).toBe(
    `mutation/${workspace}/verdict/${campaign.campaignId}.json`,
  );
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
    const manifest = await readManifest(
      "mutation-evidence/schema-verdict.json",
    );
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

function validateManifest(manifest: Manifest): void {
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.workspace).toBe("schema");
  expect(manifest.algorithm).toBe(
    "sha256:json(sorted-source-mutantId-status):v1",
  );
  expect(manifest.verdict).toHaveLength(manifest.counts.entries);
  expect(manifest.verdict).toEqual(
    [...manifest.verdict].sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.mutantId.localeCompare(right.mutantId, undefined, {
          numeric: true,
        }) ||
        left.status.localeCompare(right.status),
    ),
  );
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
  const attestation = await readAttestation({
    attestation: evidence.attestations[1],
  });
  mutate(attestation);
  await expect(
    validateAttestation(
      attestation,
      evidence,
      "schema",
      evidence.attestations[1],
    ),
  ).rejects.toThrow();
});

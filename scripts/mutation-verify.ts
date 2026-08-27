import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  hashSourceFiles,
  RESOURCE_SOURCE_ALGORITHM,
  sourceFiles,
} from "./mutation-evidence";

type Workspace = "schema" | "resources" | "validator";

const workspaces: readonly Workspace[] = ["schema", "resources", "validator"];

const minimumMutationScores: Record<Workspace, number> = {
  schema: 89.66,
  resources: 63.51,
  validator: 71.5,
};

function sourceIdentity(workspace: Workspace): string {
  return `packages/${workspace}/src/**/*.ts`;
}

type SourceRecord = { identity?: unknown; sha256?: unknown };

type Evidence = {
  workspace?: unknown;
  command?: unknown;
  source?: SourceRecord & { algorithm?: unknown };
  commitBase?: unknown;
  exitCode?: unknown;
  attestations?: Array<{
    preflight: { identity: string; sha256: string };
    campaign: { identity: string; sha256: string };
  }>;
  counts?: Record<string, number>;
};

type PreflightRecord = {
  sourceSha256: string;
  configSha256: string;
  gitHead: string;
};

type CampaignRecord = {
  schemaVersion: number;
  workspace: string;
  campaignId: string;
  exitCode: number;
  signal: null;
  report: { identity: string; sha256: string };
  source: { identity: string; sha256: string };
  config: { identity: string; sha256: string };
  gitHead: string;
};

type Report = {
  files: Record<string, { mutants: { id: string; status: string }[] }>;
};

type Checker = (condition: boolean, message: string) => void;

function createChecker(into: string[]): Checker {
  return (condition: boolean, message: string) => {
    if (!condition) into.push(message);
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as T;
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
    )
      throw error;
    return undefined;
  }
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(resolve(path)))
    .digest("hex");
}

function verifiedDigest(
  check: Checker,
  bytes: Buffer,
  expected: string,
  at: string,
): boolean {
  if (createHash("sha256").update(bytes).digest("hex") === expected)
    return true;
  check(false, `${at}: recorded digest does not match file bytes`);
  return false;
}

function countIssues(
  check: Checker,
  label: string,
  workspace: Workspace,
  counts: Record<string, number>,
): void {
  const denominator =
    counts.killed + counts.survived + counts.noCoverage + counts.ignored;
  check(
    denominator === counts.mutants && Number.isFinite(counts.mutants),
    `${label}: status counts do not sum to mutants`,
  );

  const score =
    Math.round(
      (counts.killed / (counts.killed + counts.survived + counts.noCoverage)) *
        10000,
    ) / 100;
  check(
    counts.mutationScore === score,
    `${label}: recorded mutation score does not match counts`,
  );
  check(
    counts.mutationScore >= minimumMutationScores[workspace],
    `${label}: mutation score ${counts.mutationScore} is below the ${workspace} ratchet (${minimumMutationScores[workspace]})`,
  );
}

function headerIssues(
  label: string,
  workspace: Workspace,
  evidence: Evidence,
): string[] {
  const issues: string[] = [];
  const check = createChecker(issues);

  check(
    evidence.workspace === workspace &&
      evidence.command === `bun run mutation:test ${workspace}` &&
      evidence.exitCode === 0,
    `${label}: evidence header does not describe a successful ${workspace} campaign`,
  );
  check(
    evidence.source?.identity === sourceIdentity(workspace) &&
      evidence.source.algorithm === RESOURCE_SOURCE_ALGORITHM,
    `${label}: unexpected source identity or algorithm`,
  );
  check(
    typeof evidence.commitBase === "string" &&
      /^[0-9a-f]{7,40}$/.test(evidence.commitBase),
    `${label}: missing or malformed commitBase`,
  );
  countIssues(check, label, workspace, evidence.counts ?? {});
  return issues;
}

function linkageIssues(
  check: Checker,
  at: string,
  commitBase: unknown,
  preflight: PreflightRecord,
  campaign: CampaignRecord,
): void {
  check(
    campaign.schemaVersion === 2 &&
      campaign.signal === null &&
      campaign.exitCode === 0,
    `${at}: failed or malformed campaign run`,
  );
  check(
    campaign.report.identity === `mutation/${campaign.workspace}/mutation.json`,
    `${at}: unexpected report identity`,
  );
  check(
    campaign.source.identity ===
      sourceIdentity(campaign.workspace as Workspace) &&
      campaign.config.identity === "stryker.config.ts",
    `${at}: unexpected campaign identities`,
  );
  check(
    preflight.gitHead === campaign.gitHead && campaign.gitHead === commitBase,
    `${at}: git heads diverge across preflight, campaign, and evidence`,
  );
  check(
    preflight.sourceSha256 === campaign.source.sha256,
    `${at}: source digests diverge between preflight and campaign`,
  );
  check(
    preflight.configSha256 === campaign.config.sha256,
    `${at}: config digests diverge between preflight and campaign`,
  );
}

async function storedReportIssues(
  check: Checker,
  at: string,
  mutantCount: number | undefined,
  campaign: CampaignRecord,
): Promise<void> {
  const report = await readOptionalJson<Report>(campaign.report.identity);
  if (!report) return;

  check(
    (await sha256(campaign.report.identity)) === campaign.report.sha256,
    `${at}: stored report drifted`,
  );
  check(
    Object.values(report.files).reduce(
      (total, file) => total + file.mutants.length,
      0,
    ) === mutantCount,
    `${at}: report mutant count differs from evidence`,
  );
}

async function attestationIssues(
  label: string,
  evidence: Evidence,
): Promise<string[]> {
  const issues: string[] = [];
  const check = createChecker(issues);
  const records = evidence.attestations ?? [];

  check(records.length > 0, `${label}: no attestations`);
  const campaigns = new Set<string>();

  for (const [index, record] of records.entries()) {
    const at = `${label}:attestation[${index}]`;
    if (!(await readBytesAndVerify(check, record, at))) continue;
    const preflight = await readJson<PreflightRecord>(
      record.preflight.identity,
    );
    const campaign = await readJson<CampaignRecord>(record.campaign.identity);

    campaigns.add(campaign.campaignId);
    linkageIssues(check, at, evidence.commitBase, preflight, campaign);
    await storedReportIssues(check, at, evidence.counts?.mutants, campaign);
  }

  check(
    campaigns.size === records.length,
    `${label}: duplicate campaign attestation`,
  );
  return issues;
}

async function readBytesAndVerify(
  check: Checker,
  record: NonNullable<Evidence["attestations"]>[number],
  at: string,
): Promise<boolean> {
  const preflightBytes = await readFile(resolve(record.preflight.identity));
  if (!verifiedDigest(check, preflightBytes, record.preflight.sha256, at))
    return false;
  const campaignBytes = await readFile(resolve(record.campaign.identity));
  return verifiedDigest(check, campaignBytes, record.campaign.sha256, at);
}

async function computeStaleness(
  workspace: Workspace,
  evidence: Evidence,
): Promise<boolean> {
  const freshSource =
    hashSourceFiles(await sourceFiles(".", `packages/${workspace}/src`)) ===
    evidence.source?.sha256;

  const strykerConfigSha256 = await sha256("stryker.config.ts");
  let configsMatched = 0;
  for (const record of evidence.attestations ?? []) {
    const campaign = await readJson<CampaignRecord>(record.campaign.identity);
    if (campaign.config.sha256 === strykerConfigSha256) configsMatched += 1;
  }
  return (
    !freshSource || configsMatched !== (evidence.attestations ?? []).length
  );
}

type WorkspaceOutcome = {
  workspace: Workspace;
  failures: string[];
  stale?: boolean;
};

async function verifyOne(workspace: Workspace): Promise<WorkspaceOutcome> {
  const outcome: WorkspaceOutcome = { workspace, failures: [] };
  const label = `mutation-evidence/${workspace}-mutation.json`;

  try {
    const evidence = await readJson<Evidence>(label);
    outcome.failures.push(
      ...headerIssues(label, workspace, evidence),
      ...(await attestationIssues(label, evidence)),
    );
    try {
      outcome.stale = await computeStaleness(workspace, evidence);
    } catch (error) {
      outcome.failures.push(
        `${label}: unable to assess staleness (${String(error)})`,
      );
    }
  } catch (error) {
    outcome.failures.push(`${label}: cannot be verified (${String(error)})`);
  }
  return outcome;
}

export type MutationEvidenceSummary = {
  failures: readonly string[];
  stale: readonly Workspace[];
};

export async function verifyMutationEvidence(
  targets: readonly Workspace[] = workspaces,
): Promise<MutationEvidenceSummary> {
  const outcomes: WorkspaceOutcome[] = [];
  for (const workspace of targets) outcomes.push(await verifyOne(workspace));

  const failures = outcomes.flatMap(({ failures: issues }) => issues);
  const stale = outcomes.flatMap(({ stale, workspace }) =>
    stale ? [workspace] : [],
  );
  for (const failure of failures) console.error(`error: ${failure}`);
  for (const workspace of stale)
    console.warn(`[mutation-evidence] ${workspace}: STALE`);
  return { failures, stale };
}

if (import.meta.main) {
  const strict = process.argv.includes("--strict");
  const { failures, stale } = await verifyMutationEvidence();
  if (failures.length > 0 || (strict && stale.length > 0)) {
    console.error(
      `verification failed${
        stale.length > 0
          ? `\nstale workspaces: regenerate with bun run mutation:test ${stale.join("|")}`
          : ""
      }`,
    );
    process.exit(1);
  }
  console.log("verification passed");
}

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import type { TestCase, Reporter as VitestReporter } from "vitest/node";

export type CaseStatus = "pass" | "fail" | "skip";

export type RawIdentity = {
  fileName: string;
  name: string;
  status: CaseStatus;
};

export type StoredIdentity = RawIdentity;

export type ParityResult = {
  status: "pass" | "mismatch";
  expectedCount: number;
  actualCount: number;
  missing: string[];
  extra: string[];
  statusMismatches: StatusMismatch[];
};

export function normalizeIdentity(
  identity: RawIdentity,
  projectRoot: string,
): string {
  const fileName = relative(resolve(projectRoot), resolve(identity.fileName))
    .split(sep)
    .join("/");
  return `${fileName}::${identity.name.replace(/\s*>\s*/g, " ")}`;
}

export type StatusMismatch = {
  identity: string;
  expected: CaseStatus;
  actual: CaseStatus;
};

export function compareIdentityReports(
  expected: StoredIdentity[],
  actual: StoredIdentity[],
): ParityResult {
  const expectedCases = groupCases(expected);
  const actualCases = groupCases(actual);
  const identities = new Set([...expectedCases.keys(), ...actualCases.keys()]);
  const missing: string[] = [];
  const extra: string[] = [];
  const statusMismatches: StatusMismatch[] = [];

  for (const identity of [...identities].sort()) {
    const expectedStatuses = expectedCases.get(identity) ?? [];
    const actualStatuses = actualCases.get(identity) ?? [];
    if (expectedStatuses.length > actualStatuses.length) {
      missing.push(
        ...Array(expectedStatuses.length - actualStatuses.length).fill(
          identity,
        ),
      );
    } else if (actualStatuses.length > expectedStatuses.length) {
      extra.push(
        ...Array(actualStatuses.length - expectedStatuses.length).fill(
          identity,
        ),
      );
    }
    const sharedCount = Math.min(
      expectedStatuses.length,
      actualStatuses.length,
    );
    for (let index = 0; index < sharedCount; index += 1) {
      if (expectedStatuses[index] !== actualStatuses[index]) {
        statusMismatches.push({
          identity,
          expected: expectedStatuses[index],
          actual: actualStatuses[index],
        });
      }
    }
  }

  return {
    status:
      missing.length === 0 &&
      extra.length === 0 &&
      statusMismatches.length === 0
        ? "pass"
        : "mismatch",
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
    statusMismatches,
  };
}

function groupCases(cases: StoredIdentity[]): Map<string, CaseStatus[]> {
  const grouped = new Map<string, CaseStatus[]>();
  for (const testCase of cases) {
    const identity = `${testCase.fileName}::${testCase.name}`;
    const statuses = grouped.get(identity) ?? [];
    statuses.push(testCase.status);
    grouped.set(identity, statuses);
  }
  for (const statuses of grouped.values()) statuses.sort();
  return grouped;
}

function outputPath(): string {
  const path = process.env.ATLANTE_SUITE_PARITY_OUTPUT;
  if (!path) throw new Error("ATLANTE_SUITE_PARITY_OUTPUT is required");
  return path;
}

export class SuiteParityVitestReporter implements VitestReporter {
  private readonly tests: RawIdentity[] = [];

  onTestCaseResult(testCase: TestCase): void {
    this.tests.push({
      fileName: testCase.module.moduleId,
      name: testCase.fullName,
      status: vitestStatus(testCase.result().state),
    });
  }

  async onTestRunEnd(): Promise<void> {
    await mkdir(dirname(outputPath()), { recursive: true });
    await writeFile(outputPath(), JSON.stringify(this.tests, null, 2));
  }
}

export default SuiteParityVitestReporter;

export type StoredIdentityReport = {
  fileName: string;
  name: string;
  status: string | number;
}[];

export async function qualifySuiteParity(
  workspace: string,
  projectRoot = process.cwd(),
): Promise<ParityResult> {
  const directory = await mkdtemp(resolve(tmpdir(), "atlante-suite-parity-"));
  const vitestOutput = resolve(directory, "vitest.json");
  const strykerOutput = resolve(directory, "stryker.json");
  const env = {
    ...process.env,
    ATLANTE_MUTATION_WORKSPACE: workspace,
    ATLANTE_SUITE_PARITY_OUTPUT: vitestOutput,
  };
  try {
    await run(
      ["bun", "x", "vitest", "run", "--reporter", "./scripts/suite-parity.ts"],
      env,
    );
    await run(["bun", "x", "stryker", "run", "stryker.parity.config.ts"], {
      ...env,
      ATLANTE_SUITE_PARITY_OUTPUT: strykerOutput,
    });
    const vitest = JSON.parse(
      await readFile(vitestOutput, "utf8"),
    ) as RawIdentity[];
    const stryker = JSON.parse(
      await readFile(strykerOutput, "utf8"),
    ) as StoredIdentityReport;
    return compareIdentityReports(
      vitest.map((identity) => ({
        ...identity,
        fileName: normalizeFileName(identity.fileName, projectRoot),
        name: normalizeName(identity.name),
      })),
      stryker.map((identity) => ({
        fileName: normalizeFileName(identity.fileName, projectRoot),
        name: normalizeName(identity.name),
        status: strykerStatus(identity.status),
      })),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function normalizeName(name: string): string {
  return name.replace(/\s*>\s*/g, " ");
}

function normalizeFileName(fileName: string, projectRoot: string): string {
  return relative(resolve(projectRoot), resolve(fileName)).split(sep).join("/");
}

function vitestStatus(state: string | undefined): CaseStatus {
  if (state === "pass") return "pass";
  if (state === "skip" || state === "todo") return "skip";
  return "fail";
}

function strykerStatus(status: string | number): CaseStatus {
  if (status === "success" || status === 0) return "pass";
  if (status === "skipped" || status === 2) return "skip";
  return "fail";
}

function run(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(argv[0], argv.slice(1), { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`${argv.join(" ")} exited with ${code ?? 1}`)),
    );
  });
}

if (import.meta.main) {
  const workspace = process.argv[2];
  if (!["schema", "resources", "validator"].includes(workspace ?? "")) {
    console.error("usage: bun run suite:parity <schema|resources|validator>");
    process.exitCode = 2;
  } else {
    try {
      const result = await qualifySuiteParity(workspace as string);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === "pass" ? 0 : 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}

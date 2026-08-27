import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

type StrykerMutant = { status: string };
export type StrykerReport = {
  files?: Record<string, { mutants?: StrykerMutant[] }>;
};

export type QualificationResult = {
  status: "pass";
  mutants: { killed: number; survived: number; noCoverage: number };
  infrastructureErrors: number;
  timeouts: number;
};

class QualificationError extends Error {
  readonly kind = "infrastructure" as const;
  readonly phase = "dry-run" as const;
  readonly exitCode: number;

  constructor(exitCode: number, detail?: string) {
    super(
      detail ??
        `Stryker qualification dry run failed with exit code ${exitCode}`,
    );
    this.name = "QualificationError";
    this.exitCode = exitCode;
  }
}

export async function runQualification(
  options: {
    failingTest?: boolean;
    runStryker?: (environment: NodeJS.ProcessEnv) => Promise<number>;
  } = {},
): Promise<QualificationResult> {
  const directory = await mkdtemp(resolve(tmpdir(), "atlante-qualification-"));
  try {
    const environment = {
      ...process.env,
      ATLANTE_MUTATION_WORKSPACE: "schema",
      ATLANTE_QUALIFICATION_OUTPUT_DIR: directory,
      ...(options.failingTest
        ? { ATLANTE_QUALIFICATION_FAILING_TEST: "1" }
        : {}),
    };
    const campaign = await (options.runStryker ?? runStryker)(environment);
    if (campaign !== 0) {
      throw new QualificationError(campaign);
    }
    const report = JSON.parse(
      await readFile(resolve(directory, "report.json"), "utf8"),
    ) as StrykerReport;
    validateMutationReport(report);
    const counts = summarizeMutationReport(report);
    return {
      status: "pass",
      mutants: {
        killed: counts.killed,
        survived: counts.survived,
        noCoverage: counts.noCoverage,
      },
      infrastructureErrors: counts.infrastructureErrors,
      timeouts: counts.timeouts,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const knownStatuses = new Set([
  "Killed",
  "Survived",
  "NoCoverage",
  "Timeout",
  "CompileError",
  "RuntimeError",
  "Ignored",
]);

function validateMutationReport(report: StrykerReport): void {
  for (const mutant of Object.values(report.files ?? {}).flatMap(
    (file) => file.mutants ?? [],
  )) {
    if (mutant.status === "Timeout") {
      throw new QualificationError(
        0,
        "Stryker qualification produced a timeout",
      );
    }
    if (["CompileError", "RuntimeError", "Error"].includes(mutant.status)) {
      throw new QualificationError(
        0,
        `Stryker qualification produced mutant status ${mutant.status}`,
      );
    }
    if (!knownStatuses.has(mutant.status)) {
      throw new QualificationError(
        0,
        `Stryker qualification produced unknown mutant status ${mutant.status}`,
      );
    }
  }
}

export function summarizeMutationReport(report: StrykerReport) {
  const counts = {
    killed: 0,
    survived: 0,
    noCoverage: 0,
    infrastructureErrors: 0,
    timeouts: 0,
  };
  for (const mutant of Object.values(report.files ?? {}).flatMap(
    (file) => file.mutants ?? [],
  )) {
    if (mutant.status === "Killed") counts.killed += 1;
    else if (mutant.status === "Survived") counts.survived += 1;
    else if (mutant.status === "NoCoverage") counts.noCoverage += 1;
    else if (mutant.status === "Timeout") counts.timeouts += 1;
    else if (["CompileError", "RuntimeError"].includes(mutant.status)) {
      counts.infrastructureErrors += 1;
    }
  }
  return counts;
}

function runStryker(environment: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      "bun",
      ["x", "stryker", "run", "stryker.qualification.config.ts"],
      { env: environment, stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolveRun(code ?? (signal ? 128 : 1)),
    );
  });
}

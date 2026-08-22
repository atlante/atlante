import { access, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { runQualification, summarizeMutationReport } from "./qualification";

describe("mutation qualification", () => {
  test("reports deterministic killed, survived, and no-coverage mutants", async () => {
    if (!process.env.ATLANTE_RUN_QUALIFICATION) return;
    const result = await runQualification();

    expect(result).toMatchObject({
      status: "pass",
      mutants: {
        killed: 7,
        survived: 3,
        noCoverage: 4,
      },
      infrastructureErrors: 0,
      timeouts: 0,
    });
  });

  test("fails the campaign when its test suite is unloadable", async () => {
    if (!process.env.ATLANTE_RUN_QUALIFICATION) return;
    await expect(runQualification({ failingTest: true })).rejects.toMatchObject(
      {
        kind: "infrastructure",
        phase: "dry-run",
        exitCode: 1,
      },
    );
  });

  test("accounts for timeout and infrastructure statuses separately", () => {
    expect(
      summarizeMutationReport({
        files: {
          fixture: {
            mutants: [
              { status: "Killed" },
              { status: "Timeout" },
              { status: "RuntimeError" },
              { status: "CompileError" },
            ],
          },
        },
      }),
    ).toEqual({
      killed: 1,
      survived: 0,
      noCoverage: 0,
      infrastructureErrors: 2,
      timeouts: 1,
    });
  });

  test.each([
    ["timeout", "Timeout", 0],
    ["compile errors", "CompileError", 0],
    ["runtime errors", "RuntimeError", 0],
    ["generic errors", "Error", 0],
    ["unknown statuses", "UnexpectedStatus", 0],
    ["a nonzero exit with a partial report", "Killed", 1],
  ])("rejects qualification for %s", async (_case, status, exitCode) => {
    let outputDirectory = "";
    await expect(
      runQualification({
        runStryker: async (environment) => {
          outputDirectory = environment.ATLANTE_QUALIFICATION_OUTPUT_DIR ?? "";
          await writeFile(
            `${outputDirectory}/report.json`,
            JSON.stringify({
              files: { fixture: { mutants: [{ status }] } },
            }),
          );
          return exitCode;
        },
      }),
    ).rejects.toMatchObject({
      name: "QualificationError",
      kind: "infrastructure",
      phase: "dry-run",
    });

    await expect(access(outputDirectory)).rejects.toThrow();
  });
});

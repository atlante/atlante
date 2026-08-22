import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const outputPath = process.env.ATLANTE_SUITE_PARITY_OUTPUT;

type DryRunCompletedEvent = {
  result: {
    status: string;
    tests: Array<{
      fileName?: string;
      name: string;
      status: string | number;
    }>;
  };
};

const reporter = {
  async onDryRunCompleted(event: DryRunCompletedEvent) {
    if (event.result.status !== "complete") {
      throw new Error(
        `Stryker dry run did not complete: ${event.result.status}`,
      );
    }
    if (!outputPath) throw new Error("ATLANTE_SUITE_PARITY_OUTPUT is required");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      JSON.stringify(
        event.result.tests.map(({ fileName, name, status }) => ({
          fileName,
          name,
          status: normalizeStatus(status),
        })),
        null,
        2,
      ),
    );
  },
};

function normalizeStatus(status: string | number): "pass" | "fail" | "skip" {
  if (status === "success" || status === 0) return "pass";
  if (status === "skipped" || status === 2) return "skip";
  return "fail";
}

export const strykerPlugins = [
  // Keep this adapter dependency-free; these are Stryker's public value-plugin fields.
  { kind: "Reporter", name: "suite-parity", value: reporter },
];

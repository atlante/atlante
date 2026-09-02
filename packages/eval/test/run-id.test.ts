import { describe, expect, test } from "bun:test";
import { createRunId, rollRunId } from "../src/run-id.js";

describe("createRunId", () => {
  test("matches the documented run-id shape", () => {
    expect(createRunId(new Date(2026, 8, 2, 10, 32, 11))).toMatch(
      /^2026-09-02T10-32-11-[0-9a-f]{4}$/,
    );
  });
});

describe("rollRunId", () => {
  test("keeps a run id whose report directory is free", () => {
    const report = { runId: "2026-09-02T10-00-00-abcd" };
    expect(rollRunId(report, () => false).runId).toBe(
      "2026-09-02T10-00-00-abcd",
    );
  });

  test("re-rolls on a report-directory collision until the id is free", () => {
    const report = { runId: "taken-0" };
    const taken = new Set(["taken-0", "roll-1", "roll-2"]);
    let rolls = 0;
    const rolled = rollRunId(
      report,
      (id) => taken.has(id),
      () => `roll-${++rolls}`,
    );
    expect(rolled.runId).toBe("roll-3");
    // The report is updated in place so the printed summary, the JSON body,
    // and the published directory name stay identical.
    expect(report.runId).toBe("roll-3");
  });

  test("fails closed when no free id can be allocated", () => {
    expect(() =>
      rollRunId(
        { runId: "taken" },
        () => true,
        () => "also-taken",
      ),
    ).toThrow(/run id/i);
  });
});

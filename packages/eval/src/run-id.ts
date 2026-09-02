import { randomInt } from "node:crypto";

/**
 * Run identifier: local timestamp plus a random suffix; also the report
 * directory name (`2026-09-02T10-32-11-a3f2`).
 */
export function createRunId(date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
  const time = [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
  const suffix = randomInt(0, 0xffff).toString(16).padStart(4, "0");
  return `${stamp}T${time}-${suffix}`;
}

/** A report whose `runId` names an existing report directory. */
type ReportedRun = { runId: string };

const RUN_ID_ROLL_LIMIT = 8;

/**
 * Re-rolls `report.runId` while `exists` reports a directory collision, so a
 * republished run can never clobber earlier evidence. The report is mutated
 * in place: the printed summary, the JSON body, and the published directory
 * must always name the same run. Throws after the bounded roll budget so a
 * persistently colliding base directory surfaces as a publish failure
 * instead of a silent overwrite.
 */
export function rollRunId<T extends ReportedRun>(
  report: T,
  exists: (runId: string) => boolean,
  roll: () => string = createRunId,
): T {
  if (!exists(report.runId)) return report;
  for (let attempt = 0; attempt < RUN_ID_ROLL_LIMIT; attempt++) {
    report.runId = roll();
    if (!exists(report.runId)) return report;
  }
  throw new Error(
    `could not allocate a fresh eval run id under ${RUN_ID_ROLL_LIMIT} attempts`,
  );
}

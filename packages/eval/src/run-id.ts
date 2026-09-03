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

/** A report whose `runId` will name its reserved report directory. */
type ReportedRun = { runId: string };

const RUN_ID_ROLL_LIMIT = 8;

/**
 * Atomically reserves a run id through the supplied callback, re-rolling
 * `report.runId` when the callback reports a collision. The callback must
 * perform the reservation itself (for example, `mkdir` without `recursive`),
 * rather than checking existence first; this closes the check-then-create
 * race that could otherwise clobber earlier evidence. The report is mutated
 * in place so the printed summary, JSON body, and directory name stay equal.
 * Throws after the bounded roll budget so a persistently colliding base
 * directory surfaces a publish failure instead of a silent overwrite.
 */
export function reserveRunId<T extends ReportedRun>(
  report: T,
  reserve: (runId: string) => boolean,
  roll: () => string = createRunId,
): T {
  for (let attempt = 0; attempt < RUN_ID_ROLL_LIMIT; attempt++) {
    if (reserve(report.runId)) return report;
    report.runId = roll();
  }
  throw new Error(
    `could not allocate a fresh eval run id under ${RUN_ID_ROLL_LIMIT} attempts`,
  );
}

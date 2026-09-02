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

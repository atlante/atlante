import { isAbsolute } from "node:path";

export type RecordValue = Record<string, unknown>;

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function bounded(value: string, maximum: number): string {
  return value.slice(0, Math.max(0, maximum));
}

export function isSafePathInput(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    !isAbsolute(value) &&
    !/^[a-zA-Z]:/u.test(value) &&
    !/^[\\/]/u.test(value)
  );
}

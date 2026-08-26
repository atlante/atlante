import { z } from "zod";

function own<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

type IssueContext = {
  addIssue(issue: {
    code: "custom";
    message: string;
    path: (string | number)[];
  }): void;
};

type ValidationIssue = {
  message: string;
  path: PropertyKey[];
  code?: string;
  errors?: ValidationIssue[][];
};

function selectUnionBranch(
  branches: readonly ValidationIssue[][],
  input: unknown,
): ValidationIssue[] | undefined {
  if (typeof input === "string") return branches[0];
  if (input === null) return branches.at(-1) ?? branches[0];
  return (
    branches.find((candidate) =>
      candidate.some((child) => child.code !== "invalid_type"),
    ) ?? branches[0]
  );
}

function selectedIssues(
  issues: readonly ValidationIssue[],
  input: unknown,
): ValidationIssue[] {
  const output: ValidationIssue[] = [];
  for (const issue of issues) {
    if (issue.code === "invalid_union" && issue.errors) {
      const branch = selectUnionBranch(issue.errors, input);
      if (branch) output.push(...selectedIssues(branch, input));
      continue;
    }
    output.push(issue);
  }
  return output;
}

function reportIssues(
  context: IssueContext,
  key: string,
  result: {
    success: boolean;
    error?: { issues: ValidationIssue[] };
  },
  input: unknown,
): boolean {
  if (result.success) return true;
  for (const issue of selectedIssues(result.error?.issues ?? [], input))
    context.addIssue({
      code: "custom",
      message: issue.message,
      path: [key, ...issue.path.map(String)],
    });
  return false;
}

/** Validate original keys, then copy them safely, including `__proto__`. */
export function safeRecord<
  Key extends z.ZodType<string>,
  Value extends z.ZodTypeAny,
>(keySchema: Key, valueSchema: Value) {
  return z.unknown().transform((input, context) => {
    const output: Record<string, z.output<Value>> = {};
    if (!isRecord(input)) {
      context.addIssue({ code: "custom", message: "expected an object" });
      return output;
    }

    for (const key of Object.keys(input)) {
      const parsedKey = keySchema.safeParse(key);
      const parsedValue = valueSchema.safeParse(input[key]);
      if (
        reportIssues(context, key, parsedKey, key) &&
        reportIssues(context, key, parsedValue, input[key]) &&
        parsedKey.success &&
        parsedValue.success
      )
        own(output, parsedKey.data, parsedValue.data);
    }
    return output;
  });
}

/**
 * A single project value. Values are strings only (SPECIFICATION.md §4.2):
 * there is no non-string type a `{{values.key}}` reference could splice into
 * a string field without either failing template input validation (array,
 * object) or degrading to `String(...)` output (`one,two`,
 * `[object Object]`). A caller that needs structured, per-agent data belongs
 * in the template's own `inputSchema`, not in `values`.
 */
export const valueSchema = z.string();

/** Value names are flat keys accepted by the `{{values.key}}` syntax. */
// Stryker disable all: Official Vitest sandbox imports this module before mutant activation; static initializer mutation cannot activate, and the runtime contract is covered.
export const VALUE_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;
// Stryker restore all

export const valuesMapSchema = safeRecord(
  z.string().regex(VALUE_KEY_PATTERN),
  valueSchema,
);

export type Value = z.infer<typeof valueSchema>;
export type ValuesMap = z.infer<typeof valuesMapSchema>;

/**
 * Overlay values map — allows `null` for tombstoning inherited values.
 * Expanded into a canonical ValuesMap by stripping null entries during merge.
 */
// Stryker disable all: Official Vitest sandbox imports this module before mutant activation; static initializer mutation cannot activate, and the runtime contract is covered.
export const valuesMapOverlaySchema = safeRecord(
  z.string().regex(VALUE_KEY_PATTERN),
  z.union([z.string(), z.null()]),
);
// Stryker restore all
export type ValuesMapOverlay = z.infer<typeof valuesMapOverlaySchema>;

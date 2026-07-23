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

function reportIssues(
  context: IssueContext,
  key: string,
  result: {
    success: boolean;
    error?: { issues: { message: string; path: PropertyKey[] }[] };
  },
): boolean {
  if (result.success) return true;
  for (const issue of result.error?.issues ?? [])
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
        reportIssues(context, key, parsedKey) &&
        reportIssues(context, key, parsedValue) &&
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
export const VALUE_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

export const valuesMapSchema = safeRecord(
  z.string().regex(VALUE_KEY_PATTERN),
  valueSchema,
);

export type Value = z.infer<typeof valueSchema>;
export type ValuesMap = z.infer<typeof valuesMapSchema>;

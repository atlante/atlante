import { z } from "zod";

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

export const valuesMapSchema = z.record(
  z.string().regex(VALUE_KEY_PATTERN),
  valueSchema,
);

export type Value = z.infer<typeof valueSchema>;
export type ValuesMap = Record<string, Value>;

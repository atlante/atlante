import { type OutputOptions, outputOptionsSchema } from "@atlante/schema";

export function defaultOutputOptions(): OutputOptions {
  return outputOptionsSchema.parse({});
}

export function normalizeOutputOptions(value: unknown): OutputOptions {
  return outputOptionsSchema.parse(value ?? {});
}

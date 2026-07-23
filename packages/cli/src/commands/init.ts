import { type InitOptions, runInitWithDependencies } from "./init-internal.ts";

export type { InitOptions } from "./init-internal.ts";

export function runInit(
  directory: string,
  options: InitOptions,
): Promise<number> {
  return runInitWithDependencies(directory, options);
}

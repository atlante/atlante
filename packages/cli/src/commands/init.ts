import { firstPartyProjectContext } from "../first-party-pack.js";
import { type InitOptions, runInitWithDependencies } from "./init-internal.js";

export type { InitOptions } from "./init-internal.js";

export function runInit(
  directory: string,
  options: InitOptions,
): Promise<number> {
  return runInitWithDependencies(directory, options, {
    context: firstPartyProjectContext(),
  });
}

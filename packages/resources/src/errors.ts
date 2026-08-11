import type {
  RawResourceLocator,
  ResourceFailure,
  ResourceFailureCode,
  ResourceGraphChain,
  ResourceGraphFailureCode,
  ResourceLocation,
  ResourceOrigin,
} from "./types.js";

export type ResourceFailureContext = {
  readonly dependencies?: readonly string[];
  readonly unresolvedParents?: readonly string[];
};

export function normalizeResourcePaths(
  paths: readonly string[] | undefined,
): string[] {
  return [...new Set(paths ?? [])].sort();
}

type FailureDetails = {
  readonly locator?: RawResourceLocator;
  readonly source?: ResourceOrigin;
  readonly pointer?: string;
  readonly location?: ResourceLocation;
  readonly chain?: ResourceGraphChain;
};

/**
 * Typed source-loading failure. Filesystem paths are deliberately kept out of
 * the failure message and normal failure fields; watcher paths live only on
 * the separate reconciliation context below.
 */
export class ResourceResolutionError extends Error {
  readonly failure: ResourceFailure;
  /** Current evidence; a watch reconciler may union it with prior inputs. */
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];

  constructor(failure: ResourceFailure, context: ResourceFailureContext = {}) {
    super(failure.message);
    this.name = "ResourceResolutionError";
    this.failure = Object.freeze({
      ...failure,
      ...(failure.chain
        ? {
            chain: Object.freeze(
              failure.chain.map((node) =>
                Object.freeze({
                  ...node,
                  origin: Object.freeze({ ...node.origin }),
                }),
              ),
            ) as ResourceGraphChain,
          }
        : {}),
    });
    this.dependencies = Object.freeze(
      normalizeResourcePaths(context.dependencies),
    );
    this.unresolvedParents = Object.freeze(
      normalizeResourcePaths(context.unresolvedParents),
    );
  }
}

export function failResource(
  code: Exclude<
    ResourceFailureCode,
    | "resource-cycle"
    | "resource-depth-exceeded"
    | "missing-effective-template"
    | "incompatible-template"
  >,
  message: string,
  details: FailureDetails = {},
  context: ResourceFailureContext = {},
): never {
  throw new ResourceResolutionError(
    {
      code,
      message,
      ...details,
    },
    context,
  );
}

export function failGraphResource(
  code: ResourceGraphFailureCode,
  message: string,
  chain: ResourceGraphChain,
  details: FailureDetails = {},
  context: ResourceFailureContext = {},
): never {
  throw new ResourceResolutionError(
    {
      code,
      message,
      chain,
      ...details,
    },
    context,
  );
}

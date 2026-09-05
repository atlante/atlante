import { type ResourcePack, resourcePackWatchRoot } from "./content-root.js";
import {
  failResource,
  normalizeResourceRoots,
  ResourceResolutionError,
} from "./errors.js";
import type { LoadedResource } from "./facets.js";
import {
  addResourceGraphEdge,
  addResourceGraphNode,
  assertResourceGraphStep,
  canonicalGraphKey,
  createResourceGraphState,
  type ResourceGraph,
  type ResourceGraphState,
  snapshotResourceGraph,
} from "./graph.js";
import type { JsoncLocation } from "./jsonc.js";
import { parseResourceLocator } from "./locator.js";
import type {
  EnteredFacet,
  LoadedFacet,
  TraversalContext,
  TraversalFailureDetails,
} from "./resolution-types.js";
import { composeFailurePointer, graphNode } from "./resolution-values.js";
import type {
  InstanceFacet,
  Preset,
  RawResourceLocator,
  ResourceFailureCode,
  ResourceGraphChain,
  ResourceGraphNode,
  ResourceOrigin,
  ResourceWatchRoot,
  TemplateFacet,
} from "./types.js";

/**
 * Shared resolver state: the resource graph under construction, the accumulated
 * dependency/unresolved-parent sets, and the trusted package roots, plus the
 * graph-traversal and failure-decoration operations every resolver collaborator
 * relies on.
 */
export class ResolutionTraversal {
  private readonly graph: ResourceGraphState = createResourceGraphState();
  private readonly dependencies = new Set<string>();
  private readonly unresolvedParents = new Set<string>();
  private readonly trustedRoots = new Map<string, ResourceWatchRoot>();

  get dependencyPaths(): ReadonlySet<string> {
    return this.dependencies;
  }

  get unresolvedParentPaths(): ReadonlySet<string> {
    return this.unresolvedParents;
  }

  get watchRoots(): readonly ResourceWatchRoot[] {
    return normalizeResourceRoots([...this.trustedRoots.values()]);
  }

  snapshotGraph(): ResourceGraph {
    return snapshotResourceGraph(this.graph);
  }

  run<T>(action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw this.decorateFailure(error);
    }
  }

  decorateFailure(error: unknown): ResourceResolutionError | Error {
    if (!(error instanceof ResourceResolutionError)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    return new ResourceResolutionError(error.failure, {
      dependencies: [...this.dependencies, ...error.dependencies],
      unresolvedParents: [
        ...this.unresolvedParents,
        ...error.unresolvedParents,
      ],
      trustedRoots: normalizeResourceRoots([
        ...this.trustedRoots.values(),
        ...error.trustedRoots,
      ]),
    });
  }

  collectPack(pack: ResourcePack): void {
    if (pack.kind !== "package") return;
    const root = resourcePackWatchRoot(pack);
    this.trustedRoots.set(`${root.canonical}\u0000${root.lexical}`, root);
  }

  collect<T>(loaded: LoadedResource<T>): void {
    loaded.dependencies.forEach((path) => {
      this.dependencies.add(path);
    });
    loaded.unresolvedParents.forEach((path) => {
      this.unresolvedParents.add(path);
    });
  }

  enter(
    node: ResourceGraphNode,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): readonly ResourceGraphNode[] {
    assertResourceGraphStep(path, node, hops);
    if (path.length > 0) {
      const parent = path.at(-1);
      if (parent) addResourceGraphEdge(this.graph, parent, node);
    } else {
      addResourceGraphNode(this.graph, node);
    }
    addResourceGraphNode(this.graph, node);
    return [...path, node];
  }

  enterLoaded<T extends TemplateFacet | InstanceFacet>(
    loaded: LoadedFacet<T>,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): EnteredFacet<T> {
    const node = graphNode(loaded.loaded.facet);
    return {
      loaded,
      node,
      path: this.enter(node, path, hops),
      key: canonicalGraphKey(node),
    };
  }

  failureNode(
    kind: ResourceGraphNode["kind"],
    locator: RawResourceLocator,
    source: ResourceOrigin | undefined,
  ): ResourceGraphNode | undefined {
    if (!source) return undefined;
    try {
      const parsed = parseResourceLocator(locator);
      return {
        kind,
        locator: parsed.value,
        origin: source,
      } as ResourceGraphNode;
    } catch {
      return undefined;
    }
  }

  graphChain(
    path: readonly ResourceGraphNode[],
  ): ResourceGraphChain | undefined {
    return path.length === 0
      ? undefined
      : (path as [ResourceGraphNode, ...ResourceGraphNode[]]);
  }

  decorateTraversalFailure(
    error: unknown,
    path: readonly ResourceGraphNode[],
    kind: ResourceGraphNode["kind"],
    locator: RawResourceLocator,
  ): ResourceResolutionError | Error {
    if (!(error instanceof ResourceResolutionError)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    const failure = error.failure;
    if (failure.chain) return error;
    const node = this.failureNode(kind, locator, failure.source);
    const chain = this.graphChain(node ? [...path, node] : path);
    return new ResourceResolutionError(
      {
        ...failure,
        ...(chain ? { chain } : {}),
      },
      this.failureContext(error),
    );
  }

  loadForTraversal<T extends TemplateFacet | InstanceFacet | Preset>(
    load: () => LoadedFacet<T>,
    path: readonly ResourceGraphNode[],
    kind: ResourceGraphNode["kind"],
    locator: RawResourceLocator,
  ): LoadedFacet<T> {
    try {
      return load();
    } catch (error) {
      throw this.decorateTraversalFailure(error, path, kind, locator);
    }
  }

  delegatedFailure(
    error: ResourceResolutionError,
    path: readonly ResourceGraphNode[],
    source: ResourceOrigin | undefined,
    pointer: string | undefined,
    location: JsoncLocation | undefined,
    pointerScope: string | undefined,
  ): ResourceResolutionError {
    const failure = error.failure;
    const chain = failure.chain ?? this.graphChain(path);
    const failurePointer = composeFailurePointer(
      pointer,
      failure.pointer,
      pointerScope,
    );
    return new ResourceResolutionError(
      {
        ...failure,
        ...(source && !failure.source ? { source } : {}),
        ...(failurePointer ? { pointer: failurePointer } : {}),
        ...(location && !failure.location ? { location } : {}),
        ...(chain ? { chain } : {}),
      },
      this.failureContext(error),
    );
  }

  delegateResource<T>(
    action: () => T,
    path: readonly ResourceGraphNode[],
    source: ResourceOrigin | undefined,
    pointer: string | undefined,
    location?: JsoncLocation,
    pointerScope?: string,
  ): T {
    try {
      return action();
    } catch (error) {
      if (!(error instanceof ResourceResolutionError)) throw error;
      throw this.delegatedFailure(
        error,
        path,
        source,
        pointer,
        location,
        pointerScope,
      );
    }
  }

  failureContext(error?: ResourceResolutionError): {
    readonly dependencies: readonly string[];
    readonly unresolvedParents: readonly string[];
    readonly trustedRoots: readonly ResourceWatchRoot[];
  } {
    return {
      dependencies: [...this.dependencies, ...(error?.dependencies ?? [])],
      unresolvedParents: [
        ...this.unresolvedParents,
        ...(error?.unresolvedParents ?? []),
      ],
      trustedRoots: normalizeResourceRoots([
        ...this.trustedRoots.values(),
        ...(error?.trustedRoots ?? []),
      ]),
    };
  }

  failAt(
    code: Exclude<
      ResourceFailureCode,
      | "resource-cycle"
      | "resource-depth-exceeded"
      | "missing-effective-template"
      | "incompatible-template"
    >,
    message: string,
    context: TraversalContext,
    details: TraversalFailureDetails = {},
  ): never {
    const chain = this.graphChain(context.path);
    return failResource(
      code,
      message,
      chain ? { ...details, chain } : details,
      this.failureContext(),
    );
  }
}

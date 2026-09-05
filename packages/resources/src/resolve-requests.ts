import type { ResourcePack } from "./content-root.js";
import type {
  ResolveDocumentRequest,
  ResolvedResourceDocument,
  ResolvedResourceInstance,
  ResolvedTemplate,
  ResolveInstanceRequest,
  ResolveTemplateRequest,
  ResourceResolveOptions,
} from "./resolution-types.js";
import { ResourceResolver } from "./resolve.js";
import type { RawResourceLocator } from "./types.js";

type ResourceRequest = ResourceResolveOptions & {
  readonly pack: ResourcePack;
};

function requestWithPack<T extends ResourceRequest>(
  requestOrPack: T | ResourcePack,
  fields: Omit<T, "pack">,
): T {
  if ("pack" in requestOrPack) return requestOrPack;
  return { pack: requestOrPack, ...fields } as T;
}

function runResourceRequest<T extends ResourceRequest, Result>(
  request: T,
  action: (resolver: ResourceResolver) => Result,
): Result {
  const resolver = new ResourceResolver(request.pack, request);
  return resolver.run(() => action(resolver));
}

export function resolveResourceInstance(
  request: ResolveInstanceRequest,
): ResolvedResourceInstance;
export function resolveResourceInstance(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options?: ResourceResolveOptions,
): ResolvedResourceInstance;
export function resolveResourceInstance(
  requestOrPack: ResolveInstanceRequest | ResourcePack,
  locator?: RawResourceLocator,
  authoringFile?: string,
  options: ResourceResolveOptions = {},
): ResolvedResourceInstance {
  const request = requestWithPack<ResolveInstanceRequest>(requestOrPack, {
    locator: locator as RawResourceLocator,
    authoringFile: authoringFile as string,
    ...options,
  });
  return runResourceRequest(request, (resolver) =>
    resolver.resolveInstance(
      request.pack,
      request.locator,
      request.authoringFile,
    ),
  );
}

export function resolveResourceTemplate(
  request: ResolveTemplateRequest,
): ResolvedTemplate;
export function resolveResourceTemplate(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options?: ResourceResolveOptions,
): ResolvedTemplate;
export function resolveResourceTemplate(
  requestOrPack: ResolveTemplateRequest | ResourcePack,
  locator?: RawResourceLocator,
  authoringFile?: string,
  options: ResourceResolveOptions = {},
): ResolvedTemplate {
  const request = requestWithPack<ResolveTemplateRequest>(requestOrPack, {
    locator: locator as RawResourceLocator,
    authoringFile: authoringFile as string,
    ...options,
  });
  return runResourceRequest(request, (resolver) =>
    resolver.resolveTemplate(
      request.pack,
      request.locator,
      request.authoringFile,
    ),
  );
}

export function resolveResourceDocument(
  request: ResolveDocumentRequest,
): ResolvedResourceDocument;
export function resolveResourceDocument(
  pack: ResourcePack,
  rootFile: string,
  options?: ResourceResolveOptions,
): ResolvedResourceDocument;
export function resolveResourceDocument(
  requestOrPack: ResolveDocumentRequest | ResourcePack,
  rootFile?: string,
  options: ResourceResolveOptions = {},
): ResolvedResourceDocument {
  const request = requestWithPack<ResolveDocumentRequest>(requestOrPack, {
    rootFile: rootFile as string,
    ...options,
  });
  return runResourceRequest(request, (resolver) =>
    resolver.resolveDocument(request.rootFile, request.rootDocument),
  );
}

export const resolveInstance = resolveResourceInstance;
export const resolveTemplate = resolveResourceTemplate;
export const resolveDocument = resolveResourceDocument;
export const resolveResource = resolveResourceDocument;

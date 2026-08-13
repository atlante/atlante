/** JSON values are immutable once they cross the resource seam. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

declare const validatedLocatorBrand: unique symbol;
declare const validatedProjectOriginPathBrand: unique symbol;
declare const validatedBundledOriginPathBrand: unique symbol;
declare const validatedPackageOriginPathBrand: unique symbol;

/**
 * Raw authored input is intentionally untrusted. T3 validation constructors
 * will be the only resource API that produces the branded locator identities.
 */
export type RawResourceLocator = string;

/** Readable alias for raw values retained in authored diagnostics. */
export type AuthoredResourceLocator = RawResourceLocator;

/** A validated project reference resolved from its containing authoring file. */
export type ValidatedLocalResourceLocator = (`./${string}` | `../${string}`) & {
  readonly [validatedLocatorBrand]: "local";
};

/** A validated direct child of the temporary first-party namespace. */
export type ValidatedBuiltinResourceLocator = `atlante/${string}` & {
  readonly [validatedLocatorBrand]: "builtin";
};

/** A validated npm package locator with an optional contained subpath. */
export type ValidatedPackageResourceLocator = string & {
  readonly [validatedLocatorBrand]: "package";
};

export type ValidatedResourceLocator =
  | ValidatedLocalResourceLocator
  | ValidatedBuiltinResourceLocator
  | ValidatedPackageResourceLocator;

/** Trusted aliases retained for resource identities and graph nodes. */
export type LocalResourceLocator = ValidatedLocalResourceLocator;
export type BuiltinResourceLocator = ValidatedBuiltinResourceLocator;
export type PackageResourceLocator = ValidatedPackageResourceLocator;
export type ResourceLocator = ValidatedResourceLocator;

export type RawProjectResourceOrigin = {
  readonly kind: "project";
  /** Untrusted content-root-relative path authored by a source file. */
  readonly path: string;
};

export type RawBundledResourceOrigin = {
  readonly kind: "bundled";
  /** Untrusted bundled source identity authored by a loader. */
  readonly path: string;
};

export type RawPackageResourceOrigin = {
  readonly kind: "package";
  /** Untrusted package-qualified source identity authored by a loader. */
  readonly path: string;
};

export type RawResourceOrigin =
  | RawProjectResourceOrigin
  | RawBundledResourceOrigin
  | RawPackageResourceOrigin;

export type ProjectResourceOrigin = {
  readonly kind: "project";
  /** Validated content-root-relative, stable source path. */
  readonly path: string & {
    readonly [validatedProjectOriginPathBrand]: "project";
  };
};

export type BundledResourceOrigin = {
  readonly kind: "bundled";
  /** Validated stable identity such as atlante/agent/template.jsonc. */
  readonly path: `atlante/${string}` & {
    readonly [validatedBundledOriginPathBrand]: "bundled";
  };
};

export type PackageResourceOrigin = {
  readonly kind: "package";
  /** Validated identity such as @acme/pack@1.2.0/agent/template.jsonc. */
  readonly path: `${string}@${string}/${string}` & {
    readonly [validatedPackageOriginPathBrand]: "package";
  };
};

export type ResourceOrigin =
  | ProjectResourceOrigin
  | BundledResourceOrigin
  | PackageResourceOrigin;

export type ResourceIdentity = {
  readonly locator: ResourceLocator;
  readonly origin: ResourceOrigin;
};

export type ResourceFacetKind = "template" | "instance";

export type TemplateFacet = ResourceIdentity & {
  readonly kind: "template";
  readonly inputSchema: JsonObject;
  readonly source: string;
};

export type InstanceFacet = ResourceIdentity & {
  readonly kind: "instance";
  readonly input: JsonObject;
};

export type Preset = ResourceIdentity & {
  readonly kind: "preset";
  readonly document: JsonObject;
};

export type PresetResourceGraphNode = ResourceIdentity & {
  readonly kind: "preset";
};

export type InstanceResourceGraphNode = ResourceIdentity & {
  readonly kind: "instance";
};

export type TemplateResourceGraphNode = ResourceIdentity & {
  readonly kind: "template";
};

export type ResourceGraphNode =
  | PresetResourceGraphNode
  | InstanceResourceGraphNode
  | TemplateResourceGraphNode;

/**
 * Complete ordered resource traversal, including the starting and failing
 * nodes. Graph failures require this non-empty typed chain.
 */
export type ResourceGraphChain = readonly [
  ResourceGraphNode,
  ...ResourceGraphNode[],
];

export type ResourceLocation = {
  /** One-based authoring location. */
  readonly line: number;
  readonly column: number;
};

export type ResourceFailureCode =
  | "invalid-locator"
  | "package-not-declared"
  | "package-not-installed"
  | "package-metadata-unreadable"
  | "missing-pack-format"
  | "unsupported-pack-format"
  | "missing-package-subpath"
  | "missing-target"
  | "wrong-target-type"
  | "ambiguous-facet"
  | "malformed-jsonc"
  | "invalid-template-schema"
  | "conflicting-selectors"
  | "missing-effective-template"
  | "unsafe-path"
  | "resource-cycle"
  | "resource-depth-exceeded"
  | "incompatible-template"
  | "invalid-resolved-input";

export type ResourceGraphFailureCode =
  | "resource-cycle"
  | "resource-depth-exceeded"
  | "missing-effective-template"
  | "incompatible-template";

type ResourceFailureDetails = {
  readonly message: string;
  /** The authored value is retained for invalid-locator diagnostics. */
  readonly locator?: RawResourceLocator;
  readonly source?: ResourceOrigin;
  readonly pointer?: string;
  readonly location?: ResourceLocation;
};

export type ResourceGraphFailure = ResourceFailureDetails & {
  readonly code: ResourceGraphFailureCode;
  readonly chain: ResourceGraphChain;
};

export type ResourceFailure =
  | ResourceGraphFailure
  | (ResourceFailureDetails & {
      readonly code: Exclude<ResourceFailureCode, ResourceGraphFailureCode>;
      /** Present when a non-graph failure was reached through a known chain. */
      readonly chain?: ResourceGraphChain;
    });

/** Alias used by callers that refer to failures as resource errors. */
export type ResourceError = ResourceFailure;

/** Package data retained by a trusted package resource root. */
export type ResourcePackageIdentity = {
  readonly name: string;
  readonly version: string;
  readonly manifestPath: string;
  readonly lexicalManifestPath: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
};

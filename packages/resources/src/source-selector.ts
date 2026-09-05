import type { ResourcePack } from "./content-root.js";
import { failGraphResource, ResourceResolutionError } from "./errors.js";
import type { JsoncLocation } from "./jsonc.js";
import { isSafeJsonObject } from "./jsonc.js";
import { own } from "./object.js";
import {
  childPointer,
  mapResourceValuePointers,
  originAt,
  provenanceForValue,
  type ResourceProvenance,
} from "./provenance.js";
import { withResourceValueTombstones } from "./resolution.js";
import type { ResolutionTraversal } from "./resolution-traversal.js";
import type {
  AuthoringContext,
  AuthoringProvenance,
  InstanceTraversal,
  LoadedFacet,
  MergedResourceValue,
  NormalizedValue,
  ResolvedTemplate,
  ResourceBindingCollectionSpec,
  ResourceTraversal,
  SourceLocalContext,
  SourceMetadata,
  SourceResolutionContext,
  SourceResult,
  SourceSelection,
  SourceSelectorContext,
} from "./resolution-types.js";
import {
  addBindingValuesProvenance,
  authoringContext,
  cloneObject,
  contextAt,
  copySourceValues,
  isObject,
  mergeValues,
  removeContextMap,
  removeProvenance,
  selectorKeys,
  selectorValue,
  sortProvenance,
  sourceValueTombstones,
  traversalContext,
  withoutKeys,
} from "./resolution-values.js";
import { inspectResourceFile } from "./resource-files.js";
import type {
  InstanceFacet,
  JsonObject,
  JsonValue,
  RawResourceLocator,
  ResourceGraphNode,
  ResourceOrigin,
} from "./types.js";

/** Neutral subject label for sources resolved outside a declared collection. */
export const neutralBindingSubject = "binding";

/** Re-entry operations the source selector needs from the coordinator. */
export type SourceSelectorHost = Readonly<{
  resolveTemplateAt: (
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerScope: string | undefined,
  ) => ResourceTraversal<ResolvedTemplate>;
  resolveInstanceAt: (
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerScope: string | undefined,
  ) => InstanceTraversal;
  normalizeTemplateInput: (
    template: ResolvedTemplate,
    input: JsonValue,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ) => NormalizedValue;
  requireCompatibleTemplate: (
    actual: ResolvedTemplate,
    expected: readonly ResolvedTemplate[],
    path: readonly ResourceGraphNode[],
    sourcePointer: string,
  ) => void;
}>;

/**
 * Resolves resource source objects (`$template` / `$instance` selections or
 * declared default templates) into normalized source results with aligned
 * provenance and authoring contexts.
 */
export class SourceSelector {
  constructor(
    private readonly traversal: ResolutionTraversal,
    private readonly host: SourceSelectorHost,
  ) {}

  private sourceSelector(
    source: Record<string, JsonValue>,
    context: SourceResolutionContext,
  ): SourceSelectorContext {
    const selector = selectorKeys(source)[0];
    if (selector === undefined) {
      return {
        origin: context.origin,
        authoring: authoringContext(context.pack, context.authoringFile),
      };
    }
    const selectorPointer = childPointer("", selector);
    const authoring =
      contextAt(context.sourceAuthoring, "") ??
      authoringContext(context.pack, context.authoringFile);
    return {
      selector,
      origin:
        originAt(context.sourceProvenance, selectorPointer) ?? context.origin,
      pointer: childPointer(context.sourcePointer, selector),
      location:
        authoring.locations?.[childPointer(context.sourcePointer, selector)] ??
        authoring.locations?.[selectorPointer],
      authoring:
        contextAt(context.sourceAuthoring, selectorPointer) ?? authoring,
    };
  }

  private selectSource(
    source: Record<string, JsonValue>,
    kind: "root" | "nested",
    sourceContext: SourceResolutionContext,
  ): SourceSelection {
    const selectors = selectorKeys(source);
    if (selectors.length > 1) {
      return this.traversal.failAt(
        "conflicting-selectors",
        "a resource source cannot select both $template and $instance",
        traversalContext(sourceContext.path, sourceContext.hops),
        {
          source: sourceContext.origin,
          pointer: sourceContext.sourcePointer || undefined,
        },
      );
    }

    const selector = this.sourceSelector(source, sourceContext);
    if (selector.selector === "$instance")
      return this.selectSourceInstance(
        source,
        sourceContext,
        selector.origin,
        selector.pointer,
        selector.location,
        selector.authoring,
      );
    if (selector.selector === "$template")
      return this.selectSourceTemplate(
        source,
        sourceContext,
        selector.origin,
        selector.pointer,
        selector.location,
        selector.authoring,
      );

    if (kind === "nested") {
      return this.traversal.failAt(
        "invalid-resolved-input",
        "nested source objects require $template or $instance",
        traversalContext(sourceContext.path, sourceContext.hops),
        {
          source: sourceContext.origin,
          pointer: sourceContext.sourcePointer || undefined,
        },
      );
    }

    if (!sourceContext.defaultTemplate) {
      return this.traversal.failAt(
        "invalid-resolved-input",
        "binding source object requires $template, $instance, or a collection default template",
        traversalContext(sourceContext.path, sourceContext.hops),
        {
          source: sourceContext.origin,
          pointer: sourceContext.sourcePointer || undefined,
        },
      );
    }

    const template = this.host.resolveTemplateAt(
      sourceContext.pack,
      sourceContext.defaultTemplate,
      sourceContext.authoringFile,
      sourceContext.path,
      sourceContext.hops,
      sourceContext.sourcePointer,
    );
    return {
      template: template.value,
      path: template.path,
      hops: template.hops,
    };
  }

  private selectSourceInstance(
    source: Record<string, JsonValue>,
    sourceContext: SourceResolutionContext,
    selectorOrigin: ResourceOrigin,
    selectorPointer: string | undefined,
    selectorLocation: JsoncLocation | undefined,
    selectedContext: AuthoringContext,
  ): SourceSelection {
    const instance = this.resolveSourceSelector(
      source,
      sourceContext,
      "$instance",
      selectorOrigin,
      selectorPointer,
      selectorLocation,
      (selected) =>
        this.host.resolveInstanceAt(
          selectedContext.pack,
          selected,
          selectedContext.file,
          sourceContext.path,
          sourceContext.hops,
          sourceContext.sourcePointer,
        ),
    );
    return {
      template: instance.value.template,
      inherited: instance.value.input,
      inheritedProvenance: instance.value.provenance,
      inheritedAuthoring: instance.authoring,
      path: instance.path,
      hops: instance.hops,
    };
  }

  private selectSourceTemplate(
    source: Record<string, JsonValue>,
    sourceContext: SourceResolutionContext,
    selectorOrigin: ResourceOrigin,
    selectorPointer: string | undefined,
    selectorLocation: JsoncLocation | undefined,
    selectedContext: AuthoringContext,
  ): SourceSelection {
    const template = this.resolveSourceSelector(
      source,
      sourceContext,
      "$template",
      selectorOrigin,
      selectorPointer,
      selectorLocation,
      (selected) =>
        this.host.resolveTemplateAt(
          selectedContext.pack,
          selected,
          selectedContext.file,
          sourceContext.path,
          sourceContext.hops,
          sourceContext.sourcePointer,
        ),
    );
    return {
      template: template.value,
      path: template.path,
      hops: template.hops,
    };
  }

  private resolveSourceSelector<T extends ResourceTraversal<unknown>>(
    source: Record<string, JsonValue>,
    sourceContext: SourceResolutionContext,
    selector: "$template" | "$instance",
    selectorOrigin: ResourceOrigin,
    selectorPointer: string | undefined,
    selectorLocation: JsoncLocation | undefined,
    resolve: (locator: RawResourceLocator) => T,
  ): T {
    const selected = this.traversal.delegateResource(
      () =>
        selectorValue(
          source,
          selector,
          selectorOrigin,
          sourceContext.sourcePointer,
          selectorLocation,
        ),
      sourceContext.path,
      selectorOrigin,
      selectorPointer,
      undefined,
      sourceContext.sourcePointer,
    );
    return this.traversal.delegateResource(
      () => resolve(selected),
      sourceContext.path,
      selectorOrigin,
      selectorPointer,
      selectorLocation,
      sourceContext.sourcePointer,
    );
  }

  private sourceObject(
    value: JsonValue | undefined,
    origin: ResourceOrigin,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): JsonObject {
    if (isSafeJsonObject(value)) return value;
    return this.traversal.failAt(
      "invalid-resolved-input",
      "resolved source input must be a JSON object",
      traversalContext(path, hops),
      { source: origin },
    );
  }

  private sourceDescription(
    context: "root" | "nested",
    value: JsonObject,
    subject: string,
    origin: ResourceOrigin,
    sourcePointer: string,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): string | undefined {
    const description = value.description;
    if (context !== "root" && typeof description === "string")
      return description;
    if (typeof description === "string" && description.length > 0)
      return description;
    if (context === "root")
      return this.traversal.failAt(
        "invalid-resolved-input",
        `${subject} description must be a non-empty string after resolution`,
        traversalContext(path, hops),
        {
          source: origin,
          pointer: sourcePointer
            ? `${sourcePointer}/description`
            : "/description",
        },
      );
    return undefined;
  }

  private sourceValues(
    value: JsonObject,
    origin: ResourceOrigin,
    sourcePointer: string,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): JsonObject | undefined {
    const valueTombstones = sourceValueTombstones(value);
    if (!Object.hasOwn(value, "values")) {
      return valueTombstones.length > 0
        ? withResourceValueTombstones({}, valueTombstones)
        : undefined;
    }
    if (!isObject(value.values))
      return this.traversal.failAt(
        "invalid-resolved-input",
        "binding values must be a JSON object",
        traversalContext(path, hops),
        {
          source: origin,
          pointer: sourcePointer ? `${sourcePointer}/values` : "/values",
        },
      );
    return copySourceValues(value.values as JsonObject, valueTombstones);
  }

  private sourceMetadata(
    context: "root" | "nested",
    value: JsonObject,
    provenance: ResourceProvenance,
    origin: ResourceOrigin,
    subject: string,
    sourcePointer: string,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): SourceMetadata {
    const metadataKeys = new Set(["description", "values"]);
    const description = this.sourceDescription(
      context,
      value,
      subject,
      origin,
      sourcePointer,
      path,
      hops,
    );
    const values = this.sourceValues(value, origin, sourcePointer, path, hops);
    return {
      input:
        context === "root"
          ? withoutKeys(value, metadataKeys)
          : cloneObject(value),
      provenance:
        context === "root"
          ? removeProvenance(provenance, metadataKeys)
          : provenance,
      ...(description ? { description } : {}),
      ...(values ? { values } : {}),
    };
  }

  private sourceLocalContext(
    source: Record<string, JsonValue>,
    origin: ResourceOrigin,
    pack: ResourcePack,
    authoringFile: string,
    sourceProvenance: ResourceProvenance | undefined,
    sourceAuthoring: AuthoringProvenance | undefined,
  ): SourceLocalContext {
    const value = withoutKeys(source, new Set(["$template", "$instance"]));
    return {
      value,
      provenance: sourceProvenance
        ? removeProvenance(
            sourceProvenance,
            new Set(["$template", "$instance"]),
          )
        : provenanceForValue(value, origin),
      authoring: sourceAuthoring
        ? removeContextMap(sourceAuthoring, new Set(["$template", "$instance"]))
        : mapResourceValuePointers(
            value,
            authoringContext(pack, authoringFile),
          ),
    };
  }

  private buildSourceResult(
    selection: SourceSelection,
    metadata: SourceMetadata,
    merged: MergedResourceValue,
    normalized: NormalizedValue,
    normalizedValue: JsonObject,
    pack: ResourcePack,
    authoringFile: string,
    origin: ResourceOrigin,
  ): SourceResult {
    const bindingProvenance: Record<string, ResourceOrigin> = {};
    const bindingAuthoring: Record<string, AuthoringContext> = {};
    if (metadata.description) {
      const descriptionOrigin =
        originAt(merged.provenance, "/description") ?? origin;
      own(bindingProvenance, "/description", descriptionOrigin);
      own(
        bindingAuthoring,
        "/description",
        contextAt(merged.authoring, "/description") ??
          authoringContext(pack, authoringFile),
      );
    }
    for (const pointer of Object.keys(normalized.provenance).sort()) {
      own(bindingProvenance, pointer, normalized.provenance[pointer]);
      const context = contextAt(normalized.authoring, pointer);
      if (context) own(bindingAuthoring, pointer, context);
    }
    addBindingValuesProvenance(
      bindingProvenance,
      merged.provenance,
      metadata.values,
    );
    return {
      template: selection.template,
      input: cloneObject(normalizedValue),
      provenance: Object.freeze(sortProvenance(bindingProvenance)),
      authoring: Object.freeze(bindingAuthoring),
      path: selection.path,
      hops: selection.hops,
      ...(metadata.description ? { description: metadata.description } : {}),
      ...(metadata.values ? { values: metadata.values } : {}),
    };
  }

  resolveLoadedSelector<T extends ResourceTraversal<unknown>>(
    loaded: LoadedFacet<InstanceFacet>,
    selector: "$template" | "$instance",
    path: readonly ResourceGraphNode[],
    pointerScope: string | undefined,
    resolve: (locator: RawResourceLocator) => T,
  ): T {
    const origin = loaded.loaded.facet.origin;
    const selected = this.traversal.delegateResource(
      () =>
        selectorValue(
          loaded.loaded.facet.input,
          selector,
          origin,
          "",
          loaded.loaded.locations?.[`/${selector}`],
        ),
      path,
      origin,
      `/${selector}`,
      undefined,
      pointerScope,
    );
    return this.traversal.delegateResource(
      () => resolve(selected),
      path,
      origin,
      `/${selector}`,
      loaded.loaded.locations?.[`/${selector}`],
      pointerScope,
    );
  }

  selectInstance(
    loaded: LoadedFacet<InstanceFacet>,
    selector: string | undefined,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerScope?: string,
  ): SourceSelection {
    const origin = loaded.loaded.facet.origin;
    if (selector === "$template") {
      const template = this.resolveLoadedSelector(
        loaded,
        selector,
        path,
        pointerScope,
        (selected) =>
          this.host.resolveTemplateAt(
            loaded.authoring.pack,
            selected,
            loaded.authoring.file,
            path,
            hops + 1,
            pointerScope,
          ),
      );
      return {
        template: template.value,
        path: template.path,
        hops: template.hops,
      };
    }

    if (selector === "$instance") {
      const base = this.resolveLoadedSelector(
        loaded,
        selector,
        path,
        pointerScope,
        (selected) =>
          this.host.resolveInstanceAt(
            loaded.authoring.pack,
            selected,
            loaded.authoring.file,
            path,
            hops + 1,
            pointerScope,
          ),
      );
      return {
        template: base.value.template,
        inherited: base.value.input,
        inheritedProvenance: base.value.provenance,
        inheritedAuthoring: base.authoring,
        path: base.path,
        hops: base.hops,
      };
    }

    try {
      const sibling = this.host.resolveTemplateAt(
        loaded.pack,
        "./",
        loaded.authoring.file,
        path,
        hops + 1,
        pointerScope,
      );
      return {
        template: sibling.value,
        path: sibling.path,
        hops: sibling.hops,
      };
    } catch (error) {
      if (
        error instanceof ResourceResolutionError &&
        error.failure.code === "missing-target" &&
        this.isAbsentSiblingTemplate(loaded)
      ) {
        return failGraphResource(
          "missing-effective-template",
          "instance has no effective sibling template facet",
          path as [ResourceGraphNode, ...ResourceGraphNode[]],
          { source: origin },
          this.traversal.failureContext(error),
        );
      }
      throw error;
    }
  }

  isAbsentSiblingTemplate(loaded: LoadedFacet<InstanceFacet>): boolean {
    try {
      return (
        inspectResourceFile(
          loaded.target,
          "template.jsonc",
          loaded.loaded.facet.locator,
        ) === undefined
      );
    } catch {
      return false;
    }
  }

  resolveSource(
    source: Record<string, JsonValue>,
    context: "root" | "nested",
    expected: ResolvedTemplate | undefined,
    pack: ResourcePack,
    authoringFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    origin: ResourceOrigin,
    spec?: ResourceBindingCollectionSpec,
    sourcePointer = "",
    sourceProvenance?: ResourceProvenance,
    sourceAuthoring?: AuthoringProvenance,
  ): SourceResult {
    const subject = spec?.subject ?? neutralBindingSubject;
    const selection = this.selectSource(source, context, {
      pack,
      authoringFile,
      path,
      hops,
      origin,
      subject,
      ...(spec?.defaultTemplate
        ? { defaultTemplate: spec.defaultTemplate }
        : {}),
      sourcePointer,
      sourceProvenance,
      sourceAuthoring,
    });

    const local = this.sourceLocalContext(
      source,
      origin,
      pack,
      authoringFile,
      sourceProvenance,
      sourceAuthoring,
    );
    const merged = mergeValues(selection.inherited, local.value, {
      inheritedProvenance: selection.inheritedProvenance,
      inheritedAuthoring: selection.inheritedAuthoring,
      inheritedOrigin: selection.inherited
        ? (originAt(selection.inheritedProvenance, "") ?? origin)
        : undefined,
      localOrigin: origin,
      localProvenance: local.provenance,
      localAuthoring: local.authoring,
    });
    const mergedValue = this.sourceObject(
      merged.value,
      origin,
      selection.path,
      selection.hops,
    );

    if (expected)
      this.host.requireCompatibleTemplate(
        selection.template,
        [expected],
        selection.path,
        sourcePointer,
      );
    const metadata = this.sourceMetadata(
      context,
      mergedValue,
      merged.provenance,
      origin,
      subject,
      sourcePointer,
      selection.path,
      selection.hops,
    );
    const normalized = this.host.normalizeTemplateInput(
      selection.template,
      metadata.input,
      metadata.provenance,
      merged.authoring,
      pack,
      authoringFile,
      selection.path,
      selection.hops,
      sourcePointer,
    );
    const normalizedValue = this.sourceObject(
      normalized.value,
      origin,
      selection.path,
      selection.hops,
    );
    return this.buildSourceResult(
      selection,
      metadata,
      merged,
      normalized,
      normalizedValue,
      pack,
      authoringFile,
      origin,
    );
  }
}

import type { ResourcePack } from "./content-root.js";
import { failGraphResource } from "./errors.js";
import { own } from "./object.js";
import {
  childPointer,
  cloneResourceProvenance,
  originAt,
  type ResourceProvenance,
} from "./provenance.js";
import { withResourceTemplateSelection } from "./resolution.js";
import type { ResolutionTraversal } from "./resolution-traversal.js";
import type {
  AuthoringContext,
  AuthoringProvenance,
  InstanceTraversal,
  LocatedValue,
  NormalizedValue,
  ResolvedTemplate,
  ResolvedTemplateSlot,
  ResourceBindingCollectionSpec,
  SlotCandidateContext,
  SlotGroup,
  SourceResult,
  TraversalContext,
} from "./resolution-types.js";
import {
  appendPointer,
  authoringContext,
  cloneObject,
  cloneValue,
  contextAt,
  graphNode,
  isBareResourceLocator,
  isConfiguredSlotValue,
  isObject,
  locationsAt,
  replaceContextSubtree,
  replaceProvenanceSubtree,
  selectedSlotCandidate,
  selectorKeys,
  setAt,
  sliceContextMap,
  sliceProvenance,
  templateAcceptsArray,
  templateAcceptsObject,
  traversalContext,
  unchangedNormalizedValue,
} from "./resolution-values.js";
import type {
  JsonValue,
  RawResourceLocator,
  ResourceGraphNode,
  ResourceOrigin,
} from "./types.js";

/** Re-entry operations the slot normalizer needs from the coordinator. */
export type SlotNormalizerHost = Readonly<{
  resolveInstanceAt: (
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
    path: readonly ResourceGraphNode[] | undefined,
    hops: number,
    pointerScope: string | undefined,
  ) => InstanceTraversal;
  resolveSource: (
    source: Record<string, JsonValue>,
    context: "root" | "nested",
    expected: ResolvedTemplate | undefined,
    pack: ResourcePack,
    authoringFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    origin: ResourceOrigin,
    spec: ResourceBindingCollectionSpec | undefined,
    sourcePointer: string,
    sourceProvenance: ResourceProvenance | undefined,
    sourceAuthoring: AuthoringProvenance | undefined,
  ) => SourceResult;
}>;

function uniqueResolvedSlots(
  slots: readonly ResolvedTemplateSlot[],
): ResolvedTemplateSlot[] {
  const unique = new Map<string, ResolvedTemplateSlot>();
  for (const slot of slots) {
    if (!unique.has(slot.template.key)) unique.set(slot.template.key, slot);
  }
  return [...unique.values()];
}

function groupTemplateSlots(
  slots: readonly ResolvedTemplateSlot[],
): readonly SlotGroup[] {
  const groups = new Map<
    string,
    { dataPath: string[]; slots: ResolvedTemplateSlot[] }
  >();
  for (const slot of slots) {
    const dataPath = slot.slot.dataPath ?? [slot.slot.property];
    const key = JSON.stringify(dataPath);
    const group = groups.get(key);
    if (group) {
      group.slots.push(slot);
    } else {
      groups.set(key, { dataPath: [...dataPath], slots: [slot] });
    }
  }
  return [...groups.values()].map(({ dataPath, slots: grouped }) => ({
    dataPath: Object.freeze(dataPath),
    slots: Object.freeze(grouped),
  }));
}

/**
 * Normalizes resolved input values against a template's slot declarations:
 * locates slot values, resolves nested instance/source selections, and keeps
 * provenance and authoring contexts aligned with the rewritten values.
 */
export class SlotNormalizer {
  constructor(
    private readonly traversal: ResolutionTraversal,
    private readonly host: SlotNormalizerHost,
  ) {}

  normalizeSlotLocation(
    location: LocatedValue,
    slot: ResolvedTemplateSlot,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    if (
      !slot.slot.arrayItems ||
      !Array.isArray(location.value) ||
      templateAcceptsArray(slot.template)
    ) {
      const normalized = this.normalizeSlotValue(
        location.value,
        sliceProvenance(provenance, location.pointer),
        sliceContextMap(authoring, location.pointer),
        slot.template,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        appendPointer(pointerPrefix, location.pointer),
      );
      return {
        ...normalized,
        value: withResourceTemplateSelection(
          normalized.value,
          slot.slot.templateId,
        ),
      };
    }

    return this.normalizeArraySlotLocation(
      location as LocatedValue & { readonly value: readonly JsonValue[] },
      slot,
      provenance,
      authoring,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      pointerPrefix,
    );
  }

  private normalizeArraySlotLocation(
    location: LocatedValue & { readonly value: readonly JsonValue[] },
    slot: ResolvedTemplateSlot,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    return this.normalizeArrayEntries(
      location,
      provenance,
      authoring,
      (item, itemPointer) => {
        const normalized = this.normalizeSlotValue(
          item,
          sliceProvenance(provenance, itemPointer),
          sliceContextMap(authoring, itemPointer),
          slot.template,
          fallbackPack,
          fallbackFile,
          path,
          hops,
          appendPointer(pointerPrefix, itemPointer),
        );
        return {
          ...normalized,
          value: withResourceTemplateSelection(
            normalized.value,
            slot.slot.templateId,
          ),
        };
      },
    );
  }

  private normalizeSlotGroupLocation(
    location: LocatedValue,
    group: SlotGroup,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    const slots = uniqueResolvedSlots(group.slots);
    const first = slots[0];
    if (!first) {
      return {
        value: cloneValue(location.value),
        provenance: cloneResourceProvenance(
          sliceProvenance(provenance, location.pointer),
        ),
        authoring: sliceContextMap(authoring, location.pointer),
      };
    }
    if (slots.length === 1) {
      return this.normalizeSlotLocation(
        location,
        first,
        provenance,
        authoring,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        pointerPrefix,
      );
    }

    if (
      first.slot.arrayItems &&
      slots.every(({ slot }) => slot.arrayItems) &&
      Array.isArray(location.value) &&
      !slots.some(({ template }) => templateAcceptsArray(template))
    ) {
      return this.normalizeArraySlotGroupLocation(
        location as LocatedValue & { readonly value: readonly JsonValue[] },
        slots,
        provenance,
        authoring,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        pointerPrefix,
      );
    }

    return this.normalizeSlotCandidates(
      location.value,
      sliceProvenance(provenance, location.pointer),
      sliceContextMap(authoring, location.pointer),
      slots,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      appendPointer(pointerPrefix, location.pointer),
    );
  }

  private normalizeArraySlotGroupLocation(
    location: LocatedValue & { readonly value: readonly JsonValue[] },
    slots: readonly ResolvedTemplateSlot[],
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    return this.normalizeArrayEntries(
      location,
      provenance,
      authoring,
      (item, itemPointer) =>
        this.normalizeSlotCandidates(
          item,
          sliceProvenance(provenance, itemPointer),
          sliceContextMap(authoring, itemPointer),
          slots,
          fallbackPack,
          fallbackFile,
          path,
          hops,
          appendPointer(pointerPrefix, itemPointer),
        ),
    );
  }

  private normalizeArrayEntries(
    location: LocatedValue & { readonly value: readonly JsonValue[] },
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    normalize: (item: JsonValue, itemPointer: string) => NormalizedValue,
  ): NormalizedValue {
    const entries = location.value.map((item, index) =>
      normalize(item, childPointer(location.pointer, index)),
    );
    const output: Record<string, ResourceOrigin> = {};
    const outputAuthoring: Record<string, AuthoringContext> = {};
    const arrayOrigin = originAt(provenance, location.pointer);
    if (arrayOrigin) own(output, "", arrayOrigin);
    const arrayAuthoring = contextAt(authoring, location.pointer);
    if (arrayAuthoring) own(outputAuthoring, "", arrayAuthoring);
    for (const [index, entry] of entries.entries()) {
      for (const pointer of Object.keys(entry.provenance).sort()) {
        own(
          output,
          pointer === "" ? `/${index}` : `/${index}${pointer}`,
          entry.provenance[pointer],
        );
      }
      for (const pointer of Object.keys(entry.authoring).sort()) {
        own(
          outputAuthoring,
          pointer === "" ? `/${index}` : `/${index}${pointer}`,
          entry.authoring[pointer],
        );
      }
    }
    return {
      value: entries.map((entry) => entry.value),
      provenance: Object.freeze(output),
      authoring: Object.freeze(outputAuthoring),
    };
  }

  private normalizeSlotCandidates(
    value: JsonValue,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    slots: readonly ResolvedTemplateSlot[],
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    sourcePointer: string,
  ): NormalizedValue {
    const candidates = uniqueResolvedSlots(slots);
    const first = candidates[0];
    if (!first) {
      return unchangedNormalizedValue(value, provenance, authoring);
    }
    if (candidates.length === 1) {
      return this.normalizeSlotValue(
        value,
        provenance,
        authoring,
        first.template,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        sourcePointer,
      );
    }

    const selected = selectedSlotCandidate(value, candidates);
    if (selected) {
      return this.normalizeSlotValue(
        value,
        provenance,
        authoring,
        selected.template,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        sourcePointer,
      );
    }

    if (!isConfiguredSlotValue(value, candidates))
      return unchangedNormalizedValue(value, provenance, authoring);

    return this.normalizeConfiguredSlot({
      value,
      provenance,
      authoring,
      slots: candidates,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      sourcePointer,
    });
  }

  private normalizeConfiguredSlot(
    candidateContext: SlotCandidateContext,
  ): NormalizedValue {
    const {
      value,
      provenance,
      authoring,
      slots,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      sourcePointer,
    } = candidateContext;
    const first = slots[0];
    if (!first) {
      return {
        value: cloneValue(value),
        provenance: cloneResourceProvenance(provenance),
        authoring: sliceContextMap(authoring, ""),
      };
    }
    const selectedContext =
      contextAt(authoring, "") ?? authoringContext(fallbackPack, fallbackFile);

    if (typeof value === "string") {
      const instance = this.host.resolveInstanceAt(
        selectedContext.pack,
        value,
        selectedContext.file,
        path,
        hops + 1,
        sourcePointer,
      );
      const candidate = slots.find(
        ({ template }) => template.key === instance.value.template.key,
      );
      const selected = candidate ?? first;
      this.requireCompatibleTemplate(
        instance.value.template,
        slots.map(({ template }) => template),
        instance.path,
        sourcePointer,
      );
      return {
        value: withResourceTemplateSelection(
          cloneObject(instance.value.input),
          selected.slot.templateId,
        ),
        provenance: cloneResourceProvenance(instance.value.provenance),
        authoring: instance.authoring,
      };
    }

    const fallback =
      [...slots].sort((a, b) =>
        a.template.key.localeCompare(b.template.key),
      )[0] ?? first;
    const origin = originAt(provenance, "") ?? fallback.template.origin;
    const source = this.host.resolveSource(
      value as Record<string, JsonValue>,
      "nested",
      undefined,
      selectedContext.pack,
      selectedContext.file,
      path,
      hops + 1,
      origin,
      undefined,
      sourcePointer,
      provenance,
      authoring,
    );
    const candidate = slots.find(
      ({ template }) => template.key === source.template.key,
    );
    const selected = candidate ?? first;
    this.requireCompatibleTemplate(
      source.template,
      slots.map(({ template }) => template),
      source.path,
      sourcePointer,
    );
    return {
      value: withResourceTemplateSelection(
        cloneObject(source.input),
        selected.slot.templateId,
      ),
      provenance: cloneResourceProvenance(source.provenance),
      authoring: source.authoring,
    };
  }

  normalizeTemplateInput(
    template: ResolvedTemplate,
    input: JsonValue,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    let value = cloneValue(input);
    const outputProvenance: Record<string, ResourceOrigin> = {
      ...provenance,
    };
    const outputAuthoring: Record<string, AuthoringContext> = {
      ...authoring,
    };

    for (const group of groupTemplateSlots(template.slots)) {
      const locations = locationsAt(value, group.dataPath);
      for (const location of locations) {
        const target = this.normalizeSlotGroupLocation(
          location,
          group,
          provenance,
          authoring,
          fallbackPack,
          fallbackFile,
          path,
          hops,
          pointerPrefix,
        );
        if (location.path.length === 0) value = target.value;
        else setAt(value, location.path, target.value);
        replaceProvenanceSubtree(
          outputProvenance,
          location.pointer,
          target.provenance,
        );
        replaceContextSubtree(
          outputAuthoring,
          location.pointer,
          target.authoring,
        );
      }
    }

    return {
      value,
      provenance: Object.freeze(outputProvenance),
      authoring: Object.freeze(outputAuthoring),
    };
  }

  private enterInlineTemplate(
    template: ResolvedTemplate,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): TraversalContext {
    const nextPath = this.traversal.enter(
      graphNode(template.facet),
      path,
      hops + 1,
    );
    return traversalContext(nextPath, hops + 1);
  }

  private normalizeSlotValue(
    value: JsonValue,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    expected: ResolvedTemplate,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    sourcePointer: string,
  ): NormalizedValue {
    if (typeof value === "string") {
      if (!templateAcceptsObject(expected) && !isBareResourceLocator(value)) {
        const inline = this.enterInlineTemplate(expected, path, hops);
        return this.normalizeSlotString(
          value,
          provenance,
          authoring,
          expected,
          fallbackPack,
          fallbackFile,
          inline.path,
          inline.hops,
          sourcePointer,
        );
      }
      return this.normalizeSlotString(
        value,
        provenance,
        authoring,
        expected,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        sourcePointer,
      );
    }

    if (isObject(value) && selectorKeys(value).length > 0) {
      return this.normalizeSlotSource(
        value,
        provenance,
        authoring,
        expected,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        sourcePointer,
      );
    }

    const inline = this.enterInlineTemplate(expected, path, hops);
    if (Array.isArray(value) || isObject(value)) {
      return this.normalizeTemplateInput(
        expected,
        value,
        provenance,
        authoring,
        fallbackPack,
        fallbackFile,
        inline.path,
        inline.hops,
        sourcePointer,
      );
    }

    return {
      value: cloneValue(value),
      provenance: cloneResourceProvenance(provenance),
      authoring: sliceContextMap(authoring, ""),
    };
  }

  private normalizeSlotString(
    value: string,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    expected: ResolvedTemplate,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    sourcePointer: string,
  ): NormalizedValue {
    if (!templateAcceptsObject(expected) && !isBareResourceLocator(value)) {
      return {
        value,
        provenance: cloneResourceProvenance(provenance),
        authoring: sliceContextMap(authoring, ""),
      };
    }

    const context =
      contextAt(authoring, "") ?? authoringContext(fallbackPack, fallbackFile);
    const instance = this.host.resolveInstanceAt(
      context.pack,
      value,
      context.file,
      path,
      hops + 1,
      sourcePointer,
    );
    this.requireCompatibleTemplate(
      instance.value.template,
      [expected],
      instance.path,
      sourcePointer,
    );
    return {
      value: cloneObject(instance.value.input),
      provenance: cloneResourceProvenance(instance.value.provenance),
      authoring: instance.authoring,
    };
  }

  private normalizeSlotSource(
    value: Record<string, JsonValue>,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    expected: ResolvedTemplate,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    sourcePointer: string,
  ): NormalizedValue {
    const origin = originAt(provenance, "");
    const context =
      contextAt(authoring, "") ?? authoringContext(fallbackPack, fallbackFile);
    const source = this.host.resolveSource(
      value,
      "nested",
      expected,
      context.pack,
      context.file,
      path,
      hops + 1,
      origin ?? expected.origin,
      undefined,
      sourcePointer,
      provenance,
      authoring,
    );
    return {
      value: cloneObject(source.input),
      provenance: cloneResourceProvenance(source.provenance),
      authoring: source.authoring,
    };
  }

  requireCompatibleTemplate(
    actual: ResolvedTemplate,
    expected: readonly ResolvedTemplate[],
    path: readonly ResourceGraphNode[],
    sourcePointer: string,
  ): void {
    const expectedKeys = [
      ...new Set(expected.map((template) => template.key)),
    ].sort();
    if (expectedKeys.includes(actual.key)) return;
    failGraphResource(
      "incompatible-template",
      `configured nested instance template does not match slot templates: ${actual.key} != [${expectedKeys.join(", ")}]`,
      path as [ResourceGraphNode, ...ResourceGraphNode[]],
      { source: actual.origin, pointer: sourcePointer || undefined },
      this.traversal.failureContext(),
    );
  }
}

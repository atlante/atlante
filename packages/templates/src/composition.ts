import type { TemplateRegistry } from "./loader.js";
import { TEMPLATE_ID_PATTERN } from "./schema.js";

export type Slot = {
  property: string;
  templateId: string;
  path?: string[];
  dataPath?: string[];
  arrayItems?: boolean;
};

export type CompositionIssue = {
  code: "unknown-template" | "cyclic-template" | "invalid-input-schema";
  message: string;
  templateId: string;
  property?: string;
  slotPath?: string[];
  chain?: string[];
};

type SlotMarker = {
  path: string[];
  dataPath: string[];
  property: string;
  template: unknown;
  topLevel: boolean;
  arrayItems: boolean;
};

type MarkerContext = {
  path: string[];
  dataPath: string[];
  property: string;
  topLevel: boolean;
  arrayItems: boolean;
};

function isObject(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

function isValidTemplateId(value: unknown): value is string {
  return typeof value === "string" && TEMPLATE_ID_PATTERN.test(value);
}

function isValidMarker(
  marker: SlotMarker,
): marker is SlotMarker & { template: string } {
  return isValidTemplateId(marker.template);
}

function childContext(
  context: MarkerContext,
  path: string[],
  dataPath: string[],
  property = context.property,
  arrayItems = context.arrayItems,
): MarkerContext {
  return { path, dataPath, property, topLevel: false, arrayItems };
}

function visitSchemaNode(node: unknown, context: MarkerContext): SlotMarker[] {
  if (!isObject(node)) return [];
  if (Object.hasOwn(node, "template")) {
    return [
      {
        path: context.path,
        dataPath: context.dataPath,
        property: context.dataPath.at(-1) ?? context.property,
        template: node.template,
        topLevel: context.topLevel,
        arrayItems: context.arrayItems,
      },
    ];
  }

  return Object.entries(node).flatMap(([key, value]) =>
    visitSchemaEntry(key, value, context),
  );
}

function visitSchemaArray(
  items: unknown[],
  context: MarkerContext,
  key: string,
  includeDataIndex: boolean,
  arrayItems: boolean,
): SlotMarker[] {
  return items.flatMap((item, index) =>
    visitSchemaNode(
      item,
      childContext(
        context,
        [...context.path, key, String(index)],
        includeDataIndex
          ? [...context.dataPath, String(index)]
          : context.dataPath,
        context.property,
        arrayItems,
      ),
    ),
  );
}

function visitProperties(
  properties: Record<string, unknown>,
  context: MarkerContext,
): SlotMarker[] {
  return Object.entries(properties).flatMap(([property, node]) =>
    visitSchemaNode(
      node,
      childContext(
        context,
        [...context.path, property],
        [...context.dataPath, property],
        property,
        context.arrayItems,
      ),
    ),
  );
}

function visitItems(value: unknown, context: MarkerContext): SlotMarker[] {
  if (Array.isArray(value))
    return visitSchemaArray(value, context, "items", true, true);
  return visitSchemaNode(
    value,
    childContext(
      context,
      [...context.path, "items"],
      context.dataPath,
      context.property,
      true,
    ),
  );
}

function isCompositionKeyword(key: string): boolean {
  return key === "oneOf" || key === "anyOf" || key === "allOf";
}

function visitCompositionBranches(
  key: string,
  value: unknown,
  context: MarkerContext,
): SlotMarker[] {
  if (Array.isArray(value))
    return visitSchemaArray(value, context, key, false, context.arrayItems);
  return visitSchemaNode(
    value,
    childContext(context, [...context.path, key], context.dataPath),
  );
}

function visitSchemaEntry(
  key: string,
  value: unknown,
  context: MarkerContext,
): SlotMarker[] {
  if (key === "properties" && isObject(value))
    return visitProperties(value, context);
  if (key === "items") return visitItems(value, context);
  if (isCompositionKeyword(key))
    return visitCompositionBranches(key, value, context);
  if (Array.isArray(value))
    return visitSchemaArray(value, context, key, true, context.arrayItems);
  return visitSchemaNode(
    value,
    childContext(context, [...context.path, key], [...context.dataPath, key]),
  );
}

function markersOf(inputSchema: Record<string, unknown>): SlotMarker[] {
  const properties = inputSchema.properties;
  const propertyMarkers = isObject(properties)
    ? Object.entries(properties).flatMap(([property, node]) =>
        visitSchemaNode(node, {
          path: [property],
          dataPath: [property],
          property,
          topLevel: true,
          arrayItems: false,
        }),
      )
    : [];
  const otherMarkers = Object.entries(inputSchema)
    .filter(([key]) => key !== "properties")
    .flatMap(([key, value]) =>
      visitSchemaNode(value, {
        path: [key],
        dataPath: [key],
        property: key,
        topLevel: false,
        arrayItems: false,
      }),
    );
  return [...propertyMarkers, ...otherMarkers];
}

function slotFromMarker(marker: SlotMarker & { template: string }): Slot {
  const slot: Slot = {
    property: marker.property,
    templateId: marker.template,
  };
  if (!marker.topLevel) {
    slot.path = marker.path;
    slot.dataPath = marker.dataPath;
    if (marker.arrayItems) slot.arrayItems = true;
  }
  return slot;
}

function invalidMarkerIssue(
  rootId: string,
  slotPath: string[],
  marker: SlotMarker,
): CompositionIssue {
  const actual =
    typeof marker.template === "string"
      ? JSON.stringify(marker.template)
      : `${typeof marker.template} ${JSON.stringify(marker.template)}`;
  return {
    code: "invalid-input-schema",
    message: `template "${rootId}": slot "${marker.property}" has invalid template marker ${actual}; expected a non-empty namespaced id matching namespace/name`,
    templateId: rootId,
    property: [...slotPath, ...marker.dataPath].at(-1),
    slotPath: [...slotPath, ...marker.path],
  };
}

export function slotsOf(inputSchema: Record<string, unknown>): Slot[] {
  return markersOf(inputSchema).filter(isValidMarker).map(slotFromMarker);
}

/** Depth-first walk over the slot graph, collecting every issue it finds. */
export function walkComposition(
  registry: TemplateRegistry,
  rootId: string,
  stack: string[] = [],
  slotPath: string[] = [],
  property?: string,
): CompositionIssue[] {
  if (stack.includes(rootId)) {
    const chain = [...stack, rootId];
    return [
      {
        code: "cyclic-template",
        message: `circular template composition: ${chain.join(" -> ")}`,
        templateId: rootId,
        property: property ?? slotPath.at(-1),
        slotPath,
        chain,
      },
    ];
  }

  const template = registry.get(rootId);
  if (!template) {
    return [
      {
        code: "unknown-template",
        message: `template "${rootId}" does not exist`,
        templateId: rootId,
        property: property ?? slotPath.at(-1),
        slotPath,
      },
    ];
  }

  const issues: CompositionIssue[] = [];

  const slots: Slot[] = [];
  for (const marker of markersOf(template.inputSchema)) {
    if (!isValidMarker(marker)) {
      issues.push(invalidMarkerIssue(rootId, slotPath, marker));
      continue;
    }
    slots.push(slotFromMarker(marker));
  }

  for (const slot of slots) {
    issues.push(
      ...walkComposition(
        registry,
        slot.templateId,
        [...stack, rootId],
        [...slotPath, ...(slot.path ?? [slot.property])],
        slot.property,
      ),
    );
  }
  return issues;
}

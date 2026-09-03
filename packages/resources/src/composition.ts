// fallow-ignore-file code-duplication -- resource composition intentionally mirrors templates without a package dependency

import { parseResourceLocator } from "./locator.js";

export type Slot = {
  property: string;
  templateId: string;
  path?: string[];
  dataPath?: string[];
  arrayItems?: boolean;
  /** Item-relative dataPath suffix for `arrayItems` slots; omitted when empty. */
  itemPath?: string[];
};

type SlotMarker = {
  path: string[];
  dataPath: string[];
  itemPath: string[];
  property: string;
  template: unknown;
  topLevel: boolean;
  arrayItems: boolean;
};

type MarkerContext = {
  path: string[];
  dataPath: string[];
  itemPath: string[];
  property: string;
  topLevel: boolean;
  arrayItems: boolean;
};

function isObject(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

/** A slot marker candidate is exactly `{ template: ... }`. */
export function isCompositionMarker(
  node: unknown,
): node is Record<string, unknown> & { template: unknown } {
  return (
    isObject(node) &&
    Object.keys(node).length === 1 &&
    Object.hasOwn(node, "template")
  );
}

function isValidTemplateId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = parseResourceLocator(value);
    return parsed.kind === "local" || parsed.subpath !== undefined;
  } catch {
    return false;
  }
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
  itemPath = context.itemPath,
): MarkerContext {
  return { path, dataPath, itemPath, property, topLevel: false, arrayItems };
}

function visitSchemaNode(node: unknown, context: MarkerContext): SlotMarker[] {
  if (!isObject(node)) return [];
  if (isCompositionMarker(node)) {
    return [
      {
        path: context.path,
        dataPath: context.dataPath,
        itemPath: context.itemPath,
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
        // Indexed positions address one element directly in schema space (tuple
        // and inline-array positions), so they stay item-relative; iterated
        // arrays restart the item-relative suffix. Tuple slots themselves still
        // do not resolve against runtime data — their rendering is unchanged.
        includeDataIndex ? [String(index)] : context.itemPath,
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
        [...context.itemPath, property],
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
      [],
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
          itemPath: [property],
          property,
          topLevel: true,
          arrayItems: false,
        }),
      )
    : [];
  const otherMarkers = Object.entries(inputSchema)
    .filter(([key]) => key !== "properties")
    .flatMap(([key, value]) =>
      visitSchemaEntry(key, value, {
        path: [],
        dataPath: [],
        itemPath: [],
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
    if (marker.arrayItems) {
      slot.arrayItems = true;
      if (marker.itemPath.length > 0) slot.itemPath = marker.itemPath;
    }
  }
  return slot;
}

export function slotsOf(inputSchema: Record<string, unknown>): Slot[] {
  return markersOf(inputSchema).filter(isValidMarker).map(slotFromMarker);
}

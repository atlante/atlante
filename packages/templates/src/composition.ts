import type { TemplateRegistry } from "./loader.js";
import { TEMPLATE_ID_PATTERN } from "./schema.js";

export type Slot = { property: string; templateId: string };

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
  property: string;
  template: unknown;
  topLevel: boolean;
};

function isObject(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

function isValidTemplateId(value: unknown): value is string {
  return typeof value === "string" && TEMPLATE_ID_PATTERN.test(value);
}

function markersOf(inputSchema: Record<string, unknown>): SlotMarker[] {
  const markers: SlotMarker[] = [];
  const properties = inputSchema.properties;

  const visit = (
    node: unknown,
    path: string[],
    property: string,
    topLevel: boolean,
  ): void => {
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries())
        visit(item, [...path, String(index)], property, false);
      return;
    }
    if (!isObject(node)) return;
    if (Object.hasOwn(node, "template")) {
      markers.push({
        path,
        property: path.at(-1) ?? property,
        template: node.template,
        topLevel,
      });
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      visit(
        value,
        key === "properties" ? path : [...path, key],
        property,
        false,
      );
    }
  };

  if (isObject(properties)) {
    for (const [property, node] of Object.entries(properties))
      visit(node, [property], property, true);
  }

  for (const [key, value] of Object.entries(inputSchema)) {
    if (key !== "properties") visit(value, [key], key, false);
  }
  return markers;
}

/**
 * A slot is a top-level property of `inputSchema.properties` whose schema is
 * `{ "template": "namespace/name" }`. Nested slots are out of scope for v0.1;
 * recursion happens through template ids instead.
 */
export function slotsOf(inputSchema: Record<string, unknown>): Slot[] {
  return markersOf(inputSchema)
    .filter(
      (marker): marker is SlotMarker & { template: string } =>
        marker.topLevel && isValidTemplateId(marker.template),
    )
    .map((marker) => ({
      property: marker.property,
      templateId: marker.template,
    }));
}

/** Depth-first walk over the slot graph, collecting every issue it finds. */
export function walkComposition(
  registry: TemplateRegistry,
  rootId: string,
  stack: string[] = [],
  slotPath: string[] = [],
): CompositionIssue[] {
  if (stack.includes(rootId)) {
    const chain = [...stack, rootId];
    return [
      {
        code: "cyclic-template",
        message: `circular template composition: ${chain.join(" -> ")}`,
        templateId: rootId,
        property: slotPath.at(-1),
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
        property: slotPath.at(-1),
        slotPath,
      },
    ];
  }

  const issues: CompositionIssue[] = [];

  for (const marker of markersOf(template.inputSchema)) {
    if (!marker.topLevel) {
      const suffix = isValidTemplateId(marker.template)
        ? `slot reference to "${marker.template}"`
        : "slot marker";
      issues.push({
        code: "invalid-input-schema",
        message: `template "${rootId}": ${suffix} is nested below the top level of inputSchema; slots must be top-level properties in v0.1`,
        templateId: rootId,
        property: [...slotPath, ...marker.path].at(-1),
        slotPath: [...slotPath, ...marker.path],
      });
      continue;
    }

    if (!isValidTemplateId(marker.template)) {
      const actual =
        typeof marker.template === "string"
          ? JSON.stringify(marker.template)
          : `${typeof marker.template} ${JSON.stringify(marker.template)}`;
      issues.push({
        code: "invalid-input-schema",
        message: `template "${rootId}": slot "${marker.property}" has invalid template marker ${actual}; expected a non-empty namespaced id matching namespace/name`,
        templateId: rootId,
        property: [...slotPath, marker.property].at(-1),
        slotPath: [...slotPath, marker.property],
      });
    }
  }

  for (const slot of slotsOf(template.inputSchema)) {
    issues.push(
      ...walkComposition(
        registry,
        slot.templateId,
        [...stack, rootId],
        [...slotPath, slot.property],
      ),
    );
  }
  return issues;
}

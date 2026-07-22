import type { TemplateRegistry } from "./loader.ts";
import type { TemplateManifest } from "./manifest.ts";

export type Slot = { property: string; templateId: string };

export type CompositionIssue = {
  code: "unknown-template" | "cyclic-template" | "invalid-input-schema";
  message: string;
  templateId: string;
  property?: string;
  slotPath?: string[];
  chain?: string[];
};

function isSlot(node: unknown): node is { template: string } {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as { template?: unknown }).template === "string"
  );
}

/**
 * A slot is a top-level property of `inputSchema.properties` whose schema is
 * `{ "template": "namespace/name" }`. Nested slots are out of scope for v0.1;
 * recursion happens through template ids instead.
 */
export function slotsOf(manifest: TemplateManifest): Slot[] {
  const properties = manifest.inputSchema.properties;
  if (typeof properties !== "object" || properties === null) return [];

  const slots: Slot[] = [];
  for (const [property, node] of Object.entries(properties)) {
    if (isSlot(node)) slots.push({ property, templateId: node.template });
  }
  return slots;
}

/**
 * Finds `{ "template": "namespace/name" }` nodes nested below the top level
 * of `inputSchema.properties` — the ones `slotsOf` deliberately does not
 * treat as slots. Ajv runs with `strict: false`, so an unknown `template`
 * keyword left in place would silently accept any value underneath it
 * instead of being validated; nested slots must instead be an explicit
 * rejection.
 */
function nestedSlotReferences(
  inputSchema: Record<string, unknown>,
): { templateId: string; path: string[] }[] {
  const topLevelSlotNodes = new Set(slotsOfSchema(inputSchema));

  const found: { templateId: string; path: string[] }[] = [];
  const visit = (node: unknown, path: string[]): void => {
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries())
        visit(item, [...path, String(index)]);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    if (isSlot(node)) {
      if (!topLevelSlotNodes.has(node)) {
        found.push({ templateId: node.template, path });
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      visit(value, key === "properties" ? path : [...path, key]);
    }
  };

  visit(inputSchema, []);
  return found;
}

/** The raw top-level slot node objects of an `inputSchema`, for identity checks. */
function slotsOfSchema(inputSchema: Record<string, unknown>): unknown[] {
  const properties = inputSchema.properties;
  if (typeof properties !== "object" || properties === null) return [];
  return Object.values(properties).filter(isSlot);
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

  for (const nested of nestedSlotReferences(template.manifest.inputSchema)) {
    issues.push({
      code: "invalid-input-schema",
      message: `template "${rootId}": slot reference to "${nested.templateId}" is nested below the top level of inputSchema; slots must be top-level properties in v0.1`,
      templateId: rootId,
      property: [...slotPath, ...nested.path].at(-1),
      slotPath: [...slotPath, ...nested.path],
    });
  }

  for (const slot of slotsOf(template.manifest)) {
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

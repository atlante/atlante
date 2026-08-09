import type { ResolvedResourceDocument } from "@atlante/resources";
import type { DirectTemplateRegistry } from "./template-compat.js";

/**
 * Compatibility view for callers that inspect a loaded project. Resource
 * preparation never reads this view; it renders the resolved template graph.
 */
export function resourceTemplateRegistry(
  resources: ResolvedResourceDocument,
): DirectTemplateRegistry {
  const templates = new Map<
    string,
    { inputSchema: Record<string, unknown>; source: string }
  >();
  for (const template of resources.templates) {
    const id = String(template.locator);
    if (templates.has(id)) continue;
    templates.set(id, {
      inputSchema: template.facet.inputSchema,
      source: template.facet.source,
    });
  }
  return {
    get: (id) => templates.get(id),
    ids: () => [...templates.keys()].sort(),
  };
}

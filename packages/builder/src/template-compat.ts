import type {
  JsonObject,
  TemplateRegistry as ResourceTemplateRegistry,
} from "@atlante/resources";

export type DirectTemplateRegistry = {
  get(id: string):
    | {
        readonly inputSchema: Record<string, unknown>;
        readonly source?: string;
      }
    | undefined;
  ids(): string[];
};

/** Adapts the direct test/helper shape to the resource renderer seam. */
export function toResourceTemplateRegistry(
  registry: DirectTemplateRegistry,
): ResourceTemplateRegistry {
  return {
    get(id) {
      const template = registry.get(id);
      if (!template) return undefined;
      return {
        id,
        locator: id,
        origin: {
          kind: "project",
          path: `${id}/template.jsonc`,
        },
        kind: "template",
        inputSchema: template.inputSchema as JsonObject,
        source: template.source ?? "",
        directory: "",
      };
    },
    ids: () => registry.ids(),
  };
}

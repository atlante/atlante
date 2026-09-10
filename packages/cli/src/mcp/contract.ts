const MCP_CONTRACT_VERSION = "atlante-mcp/v1" as const;
export const MCP_DEFAULT_PROTOCOL_VERSION = "2024-11-05" as const;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
] as const;

export const MCP_MAX_MESSAGE_BYTES = 256 * 1024;
export const MCP_MAX_QUERY_LENGTH = 256;
export const MCP_MAX_IDENTIFIER_LENGTH = 256;
export const MCP_MAX_RESOURCE_RESULTS = 100;
export const MCP_INSPECT_INCLUDE_SECTIONS = [
  "authored",
  "effective",
  "resolved",
  "provenance",
  "artifact-files",
] as const;

export type McpProtocolVersion =
  (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

export type McpToolName =
  | "inspect_project"
  | "list_resources"
  | "validate"
  | "search_docs"
  | "read_doc"
  | "get_schema";

export type InspectIncludeSection =
  (typeof MCP_INSPECT_INCLUDE_SECTIONS)[number];

export type InspectProjectInput = Readonly<{
  include?: readonly InspectIncludeSection[];
}>;

export type McpToolStatus =
  | "ok"
  | "empty"
  | "diagnostic"
  | "invalid"
  | "unavailable";

export type McpDiagnostic = Readonly<{
  severity?: "error" | "warning";
  code: string;
  message: string;
  source?: string;
  path?: string;
  pointer?: string;
  location?: Readonly<{ line: number; column: number }>;
  expected?: string;
  next?: string;
  cause?: string;
}>;

export type McpToolEnvelope<T = unknown> = Readonly<{
  contract_version: typeof MCP_CONTRACT_VERSION;
  tool: McpToolName;
  status: McpToolStatus;
  data?: T;
  diagnostics?: readonly McpDiagnostic[];
}>;

export type McpJsonSchema = Readonly<Record<string, unknown>>;

export type McpToolDefinition = Readonly<{
  name: McpToolName;
  description: string;
  inputSchema: McpJsonSchema;
}>;

export type ListResourcesInput = Readonly<{ limit?: number }>;
export type SearchDocsInput = Readonly<{ query: string; limit?: number }>;
export type ReadDocInput = Readonly<{
  document_id: string;
  section_id?: string;
  max_bytes?: number;
}>;
export type GetSchemaInput = Readonly<{ uri: string }>;

export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: "inspect_project",
    description:
      "Inspect the active Atlante project: diagnostics, capabilities, configuration metadata, resource counts, and generated artifact freshness. Compact by default; pass include to add heavy sections such as the resolved document or provenance.",
    inputSchema: {
      type: "object",
      properties: {
        include: {
          type: "array",
          items: { type: "string", enum: MCP_INSPECT_INCLUDE_SECTIONS },
          maxItems: MCP_INSPECT_INCLUDE_SECTIONS.length,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_resources",
    description:
      "List the templates, instances, and bindings that the active Atlante project resolved successfully, with ids, locators, and origins. Use a small limit for a cheap overview; results include total_count and truncated.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MCP_MAX_RESOURCE_RESULTS,
          default: MCP_MAX_RESOURCE_RESULTS,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "validate",
    description:
      "Run authoritative Atlante validation without rendering, materializing, or writing files.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "search_docs",
    description:
      "Search the bundled offline Atlante documentation catalog, including SPECIFICATION.md; matches include the document_id and section_id to pass to read_doc. Deterministic keyword search, no LLM.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: MCP_MAX_QUERY_LENGTH,
        },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_doc",
    description:
      "Read a documentation or specification page or section from the bundled offline catalog by exact id; discover ids with search_docs. Oversize reads fail with the doc-response-too-large diagnostic rather than truncating; retry with section_id.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          minLength: 1,
          maxLength: MCP_MAX_IDENTIFIER_LENGTH,
        },
        section_id: {
          type: "string",
          minLength: 1,
          maxLength: MCP_MAX_IDENTIFIER_LENGTH,
        },
        max_bytes: {
          type: "integer",
          minimum: 1,
          maximum: 65536,
        },
      },
      required: ["document_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_schema",
    description:
      "Return a supported versioned Atlante JSON Schema from the bundled offline schema set by exact URI, such as the schema_uri reported by inspect_project; remote URIs are never fetched. Use it when authoring or hand-checking atlante.jsonc.",
    inputSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          minLength: 1,
          maxLength: MCP_MAX_IDENTIFIER_LENGTH,
        },
      },
      required: ["uri"],
      additionalProperties: false,
    },
  },
];

export function toolEnvelope<T>(
  tool: McpToolName,
  status: McpToolStatus,
  data?: T,
  diagnostics: readonly McpDiagnostic[] = [],
): McpToolEnvelope<T> {
  return {
    contract_version: MCP_CONTRACT_VERSION,
    tool,
    status,
    ...(data === undefined ? {} : { data }),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export function diagnostic(
  code: string,
  message: string,
  extra: Omit<McpDiagnostic, "code" | "message"> = {},
): McpDiagnostic {
  return { code, message, ...extra };
}

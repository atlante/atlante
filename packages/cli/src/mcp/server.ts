import { createInterface } from "node:readline";
import packageJson from "../../package.json" with { type: "json" };
import {
  diagnostic,
  type GetSchemaInput,
  type InspectProjectInput,
  type ListResourcesInput,
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_INSPECT_INCLUDE_SECTIONS,
  MCP_MAX_IDENTIFIER_LENGTH,
  MCP_MAX_MESSAGE_BYTES,
  MCP_MAX_QUERY_LENGTH,
  MCP_MAX_RESOURCE_RESULTS,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  MCP_TOOL_DEFINITIONS,
  type McpDiagnostic,
  type McpProtocolVersion,
  type McpToolEnvelope,
  type McpToolName,
  type ReadDocInput,
  type SearchDocsInput,
  toolEnvelope,
} from "./contract.js";
import { createMcpOperations, type McpOperations } from "./project.js";

export type McpOutput = Readonly<{
  write: (chunk: string) => unknown;
}>;

export type McpServerOptions = Readonly<{
  projectRoot?: string;
  operations?: McpOperations;
  stdout?: McpOutput;
  stderr?: McpOutput;
  version?: string;
}>;

export type McpRunOptions = McpServerOptions &
  Readonly<{ input?: NodeJS.ReadableStream }>;

type RequestId = string | number | null;

type JsonRpcRequest = Readonly<{
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id?: RequestId;
}>;

type JsonRpcError = Readonly<{
  code: number;
  message: string;
  data?: unknown;
}>;

type JsonRpcResponse = Readonly<{
  jsonrpc: "2.0";
  id: RequestId;
  result?: unknown;
  error?: JsonRpcError;
}>;

type RecordValue = Record<string, unknown>;

const textEncoder = new TextEncoder();

function fitsResponseLimit(serialized: string): boolean {
  return textEncoder.encode(serialized).byteLength + 1 <= MCP_MAX_MESSAGE_BYTES;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return false;
  if (typeof value.method !== "string" || value.method.length === 0)
    return false;
  return !Object.hasOwn(value, "id") || isRequestId(value.id);
}

function hasId(request: JsonRpcRequest): request is JsonRpcRequest & {
  id: RequestId;
} {
  return Object.hasOwn(request, "id");
}

function paramsOf(request: JsonRpcRequest): RecordValue | undefined {
  if (request.params === undefined) return {};
  return isRecord(request.params) ? request.params : undefined;
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

function unknownKeys(value: RecordValue, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value).filter((key) => !allowedSet.has(key));
}

type ArgumentValidation =
  | { ok: true; value: RecordValue }
  | { ok: false; result: McpToolEnvelope };

function invalidArguments(tool: McpToolName, message: string): McpToolEnvelope {
  return toolEnvelope(tool, "invalid", undefined, [
    diagnostic("invalid-arguments", message),
  ]);
}

function validArguments(value: RecordValue): ArgumentValidation {
  return { ok: true, value };
}

function invalidArgumentResult(result: McpToolEnvelope): ArgumentValidation {
  return { ok: false, result };
}

function unknownArgumentResult(
  tool: McpToolName,
  value: RecordValue,
  allowed: readonly string[],
): McpToolEnvelope | undefined {
  const keys = unknownKeys(value, allowed);
  return keys.length === 0
    ? undefined
    : invalidArguments(tool, `unknown argument(s): ${keys.join(", ")}`);
}

function validateNoArguments(
  tool: McpToolName,
  value: RecordValue,
): ArgumentValidation {
  const unknown = unknownArgumentResult(tool, value, []);
  return unknown ? invalidArgumentResult(unknown) : validArguments(value);
}

function validateInspectProject(value: RecordValue): ArgumentValidation {
  const unknown = unknownArgumentResult("inspect_project", value, ["include"]);
  if (unknown) return invalidArgumentResult(unknown);
  if (value.include !== undefined) {
    const include = value.include;
    const known =
      Array.isArray(include) &&
      include.length <= MCP_INSPECT_INCLUDE_SECTIONS.length &&
      include.every((item) =>
        (MCP_INSPECT_INCLUDE_SECTIONS as readonly unknown[]).includes(item),
      );
    if (!known)
      return invalidArgumentResult(
        invalidArguments(
          "inspect_project",
          `include must be an array drawn from: ${MCP_INSPECT_INCLUDE_SECTIONS.join(", ")}`,
        ),
      );
  }
  return validArguments(value);
}

function validateListResources(value: RecordValue): ArgumentValidation {
  const unknown = unknownArgumentResult("list_resources", value, ["limit"]);
  if (unknown) return invalidArgumentResult(unknown);
  if (
    value.limit !== undefined &&
    !integerInRange(value.limit, 1, MCP_MAX_RESOURCE_RESULTS)
  )
    return invalidArgumentResult(
      invalidArguments(
        "list_resources",
        `limit must be an integer from 1 to ${MCP_MAX_RESOURCE_RESULTS}`,
      ),
    );
  return validArguments(value);
}

function validateSearchDocs(value: RecordValue): ArgumentValidation {
  const unknown = unknownArgumentResult("search_docs", value, [
    "query",
    "limit",
  ]);
  if (unknown) return invalidArgumentResult(unknown);
  if (!boundedString(value.query, 1, MCP_MAX_QUERY_LENGTH))
    return invalidArgumentResult(
      invalidArguments(
        "search_docs",
        `query must be a non-empty string of at most ${MCP_MAX_QUERY_LENGTH} characters`,
      ),
    );
  if (value.limit !== undefined && !integerInRange(value.limit, 1, 20))
    return invalidArgumentResult(
      invalidArguments("search_docs", "limit must be an integer from 1 to 20"),
    );
  return validArguments(value);
}

function validateReadDoc(value: RecordValue): ArgumentValidation {
  const unknown = unknownArgumentResult("read_doc", value, [
    "document_id",
    "section_id",
    "max_bytes",
  ]);
  if (unknown) return invalidArgumentResult(unknown);
  if (!boundedString(value.document_id, 1, MCP_MAX_IDENTIFIER_LENGTH))
    return invalidArgumentResult(
      invalidArguments(
        "read_doc",
        `document_id must be a non-empty string of at most ${MCP_MAX_IDENTIFIER_LENGTH} characters`,
      ),
    );
  if (
    value.section_id !== undefined &&
    !boundedString(value.section_id, 1, MCP_MAX_IDENTIFIER_LENGTH)
  )
    return invalidArgumentResult(
      invalidArguments(
        "read_doc",
        `section_id must be a non-empty string of at most ${MCP_MAX_IDENTIFIER_LENGTH} characters`,
      ),
    );
  if (
    value.max_bytes !== undefined &&
    !integerInRange(value.max_bytes, 1, 65536)
  )
    return invalidArgumentResult(
      invalidArguments(
        "read_doc",
        "max_bytes must be an integer from 1 to 65536",
      ),
    );
  return validArguments(value);
}

function validateGetSchema(value: RecordValue): ArgumentValidation {
  const unknown = unknownArgumentResult("get_schema", value, ["uri"]);
  if (unknown) return invalidArgumentResult(unknown);
  if (!boundedString(value.uri, 1, MCP_MAX_IDENTIFIER_LENGTH))
    return invalidArgumentResult(
      invalidArguments(
        "get_schema",
        `uri must be a non-empty string of at most ${MCP_MAX_IDENTIFIER_LENGTH} characters`,
      ),
    );
  return validArguments(value);
}

function validateArguments(
  tool: McpToolName,
  value: unknown,
): ArgumentValidation {
  if (!isRecord(value))
    return invalidArgumentResult(
      invalidArguments(tool, "tool arguments must be a JSON object"),
    );

  switch (tool) {
    case "inspect_project":
      return validateInspectProject(value);
    case "validate":
      return validateNoArguments(tool, value);
    case "list_resources":
      return validateListResources(value);
    case "search_docs":
      return validateSearchDocs(value);
    case "read_doc":
      return validateReadDoc(value);
    case "get_schema":
      return validateGetSchema(value);
  }
}

function isToolName(value: unknown): value is McpToolName {
  return MCP_TOOL_DEFINITIONS.some((tool) => tool.name === value);
}

function rpcError(code: number, message: string, data?: unknown): JsonRpcError {
  return { code, message, ...(data === undefined ? {} : { data }) };
}

function toolResult(envelope: McpToolEnvelope): Record<string, unknown> {
  const isError =
    envelope.status === "diagnostic" ||
    envelope.status === "invalid" ||
    envelope.status === "unavailable";
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    isError,
  };
}

function oversizedToolResult(tool: McpToolName): Record<string, unknown> {
  return toolResult(
    toolEnvelope(tool, "unavailable", undefined, [
      diagnostic(
        "response-too-large",
        `the ${tool} response exceeds the ${MCP_MAX_MESSAGE_BYTES}-byte limit`,
      ),
    ]),
  );
}

function selectedProtocolVersion(value: unknown): McpProtocolVersion {
  if (value === undefined) return MCP_DEFAULT_PROTOCOL_VERSION;
  if (
    typeof value === "string" &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value)
  )
    return value as McpProtocolVersion;
  return MCP_SUPPORTED_PROTOCOL_VERSIONS.at(-1) as McpProtocolVersion;
}

function valueLabel(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

function diagnosticsFromUnknown(cause: unknown): McpDiagnostic {
  return diagnostic(
    "internal-error",
    cause instanceof Error ? cause.message : "MCP operation failed",
  );
}

function operationFor(
  operations: McpOperations,
  tool: McpToolName,
  input: RecordValue,
): McpToolEnvelope {
  switch (tool) {
    case "inspect_project":
      return operations.inspectProject(input as InspectProjectInput);
    case "list_resources":
      return operations.listResources(input as ListResourcesInput);
    case "validate":
      return operations.validate();
    case "search_docs":
      return operations.searchDocs(input as SearchDocsInput);
    case "read_doc":
      return operations.readDoc(input as ReadDocInput);
    case "get_schema":
      return operations.getSchema(input as GetSchemaInput);
  }
}

/** Small JSON-RPC adapter for the six read-only Atlante MCP tools. */
class McpServer {
  private readonly operations: McpOperations;
  private readonly stdout: McpOutput;
  private readonly stderr: McpOutput;
  private readonly version: string;
  private continueReading = true;

  constructor(options: McpServerOptions = {}) {
    this.operations =
      options.operations ??
      createMcpOperations(options.projectRoot ?? process.cwd());
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.version = options.version ?? packageJson.version;
  }

  private writeResponse(
    response: JsonRpcResponse,
    oversizedFallback?: JsonRpcResponse,
  ): void {
    const serialized = JSON.stringify(response);
    if (fitsResponseLimit(serialized)) {
      this.stdout.write(`${serialized}\n`);
      return;
    }

    const fallback =
      oversizedFallback ??
      ({
        jsonrpc: "2.0",
        id: response.id,
        error: rpcError(-32000, "MCP response exceeds the maximum size"),
      } satisfies JsonRpcResponse);
    const serializedFallback = JSON.stringify(fallback);
    if (fitsResponseLimit(serializedFallback)) {
      this.stdout.write(`${serializedFallback}\n`);
      return;
    }

    // Request IDs are not independently bounded, so use null if even the
    // ordinary fallback cannot fit within the response budget.
    this.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: rpcError(-32000, "MCP response exceeds the maximum size"),
      })}\n`,
    );
  }

  private writeError(id: RequestId, error: JsonRpcError): void {
    this.writeResponse({ jsonrpc: "2.0", id, error });
  }

  private writeOperationalError(cause: unknown): void {
    this.stderr.write(
      `atlante mcp: ${cause instanceof Error ? cause.message : "operation failed"}\n`,
    );
  }

  private result(
    request: JsonRpcRequest,
    result: unknown,
    oversizedFallback?: unknown,
  ): void {
    if (hasId(request))
      this.writeResponse(
        { jsonrpc: "2.0", id: request.id, result },
        oversizedFallback === undefined
          ? undefined
          : { jsonrpc: "2.0", id: request.id, result: oversizedFallback },
      );
  }

  private initialize(request: JsonRpcRequest): void {
    const params = paramsOf(request);
    if (!params) {
      if (hasId(request))
        this.writeError(
          request.id,
          rpcError(-32602, "initialize params must be a JSON object"),
        );
      return;
    }
    const version = selectedProtocolVersion(params.protocolVersion);
    this.result(request, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "atlante", version: this.version },
      instructions:
        "Use search_docs followed by read_doc for Atlante guidance, and get_schema for exact document shape. All Atlante MCP tools are read-only.",
    });
  }

  private listTools(request: JsonRpcRequest): void {
    const params = paramsOf(request);
    if (!params) {
      if (hasId(request))
        this.writeError(
          request.id,
          rpcError(-32602, "tools/list params must be a JSON object"),
        );
      return;
    }
    this.result(request, { tools: MCP_TOOL_DEFINITIONS });
  }

  private callTool(request: JsonRpcRequest): void {
    const params = paramsOf(request);
    if (!params) {
      if (hasId(request))
        this.writeError(
          request.id,
          rpcError(-32602, "tools/call params must be a JSON object"),
        );
      return;
    }
    if (!isToolName(params.name)) {
      if (hasId(request))
        this.writeError(
          request.id,
          rpcError(-32602, `unknown MCP tool: ${valueLabel(params.name)}`),
        );
      return;
    }
    const oversizedFallback = oversizedToolResult(params.name);
    const argumentsValue =
      params.arguments === undefined ? {} : params.arguments;
    const validated = validateArguments(params.name, argumentsValue);
    if (!validated.ok) {
      this.result(request, toolResult(validated.result), oversizedFallback);
      return;
    }

    let envelope: McpToolEnvelope;
    try {
      envelope = operationFor(this.operations, params.name, validated.value);
    } catch (cause) {
      this.writeOperationalError(cause);
      envelope = toolEnvelope(params.name, "unavailable", undefined, [
        diagnosticsFromUnknown(cause),
      ]);
    }
    this.result(request, toolResult(envelope), oversizedFallback);
  }

  private handleRequest(request: JsonRpcRequest): void {
    switch (request.method) {
      case "initialize":
        this.initialize(request);
        return;
      case "notifications/initialized":
        return;
      case "tools/list":
        this.listTools(request);
        return;
      case "tools/call":
        this.callTool(request);
        return;
      case "ping": {
        const params = paramsOf(request);
        if (!params) {
          if (hasId(request))
            this.writeError(
              request.id,
              rpcError(-32602, "ping params must be a JSON object"),
            );
          return;
        }
        this.result(request, {});
        return;
      }
      case "shutdown":
        this.result(request, {});
        this.continueReading = false;
        return;
      case "exit":
        this.continueReading = false;
        return;
      case "notifications/cancelled":
        return;
      default:
        if (hasId(request))
          this.writeError(
            request.id,
            rpcError(-32601, `method not found: ${request.method}`),
          );
    }
  }

  /** Handles one newline-delimited input message; false asks the reader to stop. */
  async handleLine(line: string): Promise<boolean> {
    if (line.length === 0) return this.continueReading;
    if (textEncoder.encode(line).byteLength > MCP_MAX_MESSAGE_BYTES) {
      this.writeError(
        null,
        rpcError(-32600, "MCP message exceeds the maximum size"),
      );
      return this.continueReading;
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.writeError(null, rpcError(-32700, "invalid JSON"));
      return this.continueReading;
    }
    if (!isJsonRpcRequest(value)) {
      this.writeError(null, rpcError(-32600, "invalid JSON-RPC request"));
      return this.continueReading;
    }
    this.handleRequest(value);
    return this.continueReading;
  }
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  return new McpServer(options);
}

/** Runs the MCP server until stdin closes or the client sends shutdown/exit. */
export async function runMcpServer(options: McpRunOptions = {}): Promise<void> {
  const server = new McpServer(options);
  const input = options.input ?? process.stdin;
  const reader = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!(await server.handleLine(line))) break;
    }
  } finally {
    reader.close();
  }
}

import { join } from "node:path";
import { openCodeConfigPaths } from "@atlante/opencode/config";
import {
  createOpenCodeMcpServer,
  type OpenCodeDialect,
  openCodeMcpPath,
} from "@atlante/opencode/dialect";
import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from "jsonc-parser";
import packageJson from "../../package.json" with { type: "json" };
import { formatInitError } from "./init-error.js";

const ATLANTE_MCP_SERVER_ID = "atlante" as const;
const ATLANTE_MCP_COMMAND = [
  "npx",
  "--yes",
  `atlante@${packageJson.version}`,
  "mcp",
] as const;

export type OpenCodeMcpFileSystem = Readonly<{
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
}>;

export type OpenCodeMcpSnapshot = Readonly<{
  exists: boolean;
  contents?: string;
}>;

export type OpenCodeMcpPlan = Readonly<{
  path: string;
  previous: OpenCodeMcpSnapshot;
  contents: string;
  write: boolean;
  registered: boolean;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isStringMap(value: unknown): boolean {
  return (
    isObject(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function onlyAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function optionalStringFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every(
    (field) => value[field] === undefined || typeof value[field] === "string",
  );
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOAuthConfig(value: unknown, dialect: OpenCodeDialect): boolean {
  if (value === false) return true;
  if (!isObject(value)) return false;
  const callbackField = dialect === "v1" ? "callbackPort" : "callback_port";
  const stringFields =
    dialect === "v1"
      ? ["clientId", "clientSecret", "scope", "redirectUri"]
      : ["client_id", "client_secret", "scope", "redirect_uri"];
  if (!onlyAllowedKeys(value, [...stringFields, callbackField])) return false;
  if (!optionalStringFields(value, stringFields)) return false;
  if (
    value[callbackField] !== undefined &&
    (!positiveSafeInteger(value[callbackField]) || value[callbackField] > 65535)
  )
    return false;
  return true;
}

function timeoutError(
  value: unknown,
  dialect: OpenCodeDialect,
): string | undefined {
  if (dialect === "v1") {
    if (value !== undefined && !positiveSafeInteger(value))
      return 'the "timeout" field must be a positive safe integer';
    return undefined;
  }
  if (!isObject(value))
    return 'the "timeout" field must be a positive safe integer or an object of positive safe integers';
  if (!onlyAllowedKeys(value, ["startup", "catalog", "execution"]))
    return 'the "timeout" object contains an unknown field';
  for (const field of ["startup", "catalog", "execution"]) {
    if (value[field] !== undefined && !positiveSafeInteger(value[field]))
      return `the "timeout.${field}" field must be a positive safe integer`;
  }
  return undefined;
}

function protocolError(value: unknown): string | undefined {
  return value === undefined ||
    value === "legacy" ||
    value === "auto" ||
    value === "2026-07-28"
    ? undefined
    : 'the "protocol" field must be "legacy", "auto", or "2026-07-28"';
}

function commonMcpEntryError(
  value: Record<string, unknown>,
  dialect: OpenCodeDialect,
): string | undefined {
  if (dialect === "v1") {
    if (value.enabled !== undefined && typeof value.enabled !== "boolean")
      return 'the "enabled" field must be a boolean';
    if (value.timeout !== undefined)
      return timeoutError(value.timeout, dialect);
    return undefined;
  }
  if (value.disabled !== undefined && typeof value.disabled !== "boolean")
    return 'the "disabled" field must be a boolean';
  if (value.codemode !== undefined && typeof value.codemode !== "boolean")
    return 'the "codemode" field must be a boolean';
  const protocolCause = protocolError(value.protocol);
  if (protocolCause !== undefined) return protocolCause;
  if (value.timeout !== undefined) return timeoutError(value.timeout, dialect);
  return undefined;
}

function localMcpEntryError(
  value: Record<string, unknown>,
  dialect: OpenCodeDialect,
): string | undefined {
  const commonError = commonMcpEntryError(value, dialect);
  if (commonError !== undefined) return commonError;
  if (!isStringArray(value.command))
    return 'a local server requires a string "command" array';
  if (value.cwd !== undefined && typeof value.cwd !== "string")
    return 'the "cwd" field must be a string';
  if (value.environment !== undefined && !isStringMap(value.environment))
    return 'the "environment" field must be an object of strings';
  return undefined;
}

function remoteMcpEntryError(
  value: Record<string, unknown>,
  dialect: OpenCodeDialect,
): string | undefined {
  const commonError = commonMcpEntryError(value, dialect);
  if (commonError !== undefined) return commonError;
  if (typeof value.url !== "string")
    return 'a remote server requires a string "url"';
  if (value.headers !== undefined && !isStringMap(value.headers))
    return 'the "headers" field must be an object of strings';
  if (value.oauth !== undefined && !isOAuthConfig(value.oauth, dialect))
    return 'the "oauth" field has an invalid shape';
  return undefined;
}

function isEnabledOnlyMcpEntry(
  value: Record<string, unknown>,
  dialect: OpenCodeDialect,
): boolean {
  const key = dialect === "v1" ? "enabled" : "disabled";
  return Object.keys(value).length === 1 && Object.hasOwn(value, key);
}

function enabledOnlyMcpEntryError(
  value: Record<string, unknown>,
  dialect: OpenCodeDialect,
): string | undefined {
  const key = dialect === "v1" ? "enabled" : "disabled";
  return typeof value[key] === "boolean"
    ? undefined
    : `the "${key}" field must be a boolean`;
}

function mcpObjectEntryError(
  value: Record<string, unknown>,
  dialect: OpenCodeDialect,
): string | undefined {
  if (value.type !== "local" && value.type !== "remote")
    return 'the "type" field must be "local" or "remote"';

  const allowedKeys =
    dialect === "v1"
      ? value.type === "local"
        ? ["type", "command", "cwd", "environment", "enabled", "timeout"]
        : ["type", "url", "enabled", "headers", "oauth", "timeout"]
      : value.type === "local"
        ? [
            "type",
            "command",
            "cwd",
            "environment",
            "disabled",
            "codemode",
            "protocol",
            "timeout",
          ]
        : [
            "type",
            "url",
            "disabled",
            "headers",
            "oauth",
            "codemode",
            "protocol",
            "timeout",
          ];
  const unknownKey = Object.keys(value).find(
    (key) => !allowedKeys.includes(key),
  );
  if (unknownKey !== undefined)
    return `the "${unknownKey}" field is not valid for a ${value.type} server`;

  return value.type === "local"
    ? localMcpEntryError(value, dialect)
    : remoteMcpEntryError(value, dialect);
}

function mcpEntryError(
  value: unknown,
  dialect: OpenCodeDialect,
): string | undefined {
  if (!isObject(value)) return "the server entry must be an object";
  if (isEnabledOnlyMcpEntry(value, dialect))
    return enabledOnlyMcpEntryError(value, dialect);
  return mcpObjectEntryError(value, dialect);
}

function firstInvalidMcpServer(
  servers: Record<string, unknown>,
): { id: string; cause: string } | undefined {
  for (const [id, value] of Object.entries(servers)) {
    const cause = mcpEntryError(value, "v2");
    if (cause !== undefined) return { id, cause };
  }
  return undefined;
}

/**
 * Validates the host's `mcp` object under the selected dialect. In V2 the
 * `servers` map and top-level `timeout` settings are V2 containers, and every
 * other entry is a preserved legacy V1 server. In V1 those names are ordinary
 * server names, so entries are read as V1 servers first and a V2 map or
 * settings block from the other dialect remains preservable.
 */
function firstInvalidMcpEntry(
  mcp: Record<string, unknown> | undefined,
  dialect: OpenCodeDialect,
): { id: string; cause: string } | undefined {
  for (const [id, value] of Object.entries(mcp ?? {})) {
    if (dialect === "v2") {
      if (id === "servers") {
        if (!isObject(value))
          return {
            id,
            cause: 'the "servers" field must be an object of server entries',
          };
        const invalidServer = firstInvalidMcpServer(value);
        if (invalidServer !== undefined)
          return {
            id: `servers.${invalidServer.id}`,
            cause: invalidServer.cause,
          };
        continue;
      }
      if (id === "timeout") {
        const cause = timeoutError(value, "v2");
        if (cause !== undefined) return { id, cause };
        continue;
      }
      const cause = mcpEntryError(value, "v1");
      if (cause !== undefined) return { id, cause };
      continue;
    }

    const legacyCause = mcpEntryError(value, "v1");
    if (legacyCause === undefined) continue;
    if (id === "servers" && isObject(value)) {
      if (firstInvalidMcpServer(value) === undefined) continue;
    } else if (id === "timeout" && timeoutError(value, "v2") === undefined) {
      continue;
    }
    return { id, cause: legacyCause };
  }
  return undefined;
}

function snapshot(
  path: string,
  fileSystem: OpenCodeMcpFileSystem,
): OpenCodeMcpSnapshot {
  if (!fileSystem.existsSync(path)) return { exists: false };
  return { exists: true, contents: fileSystem.readFileSync(path, "utf8") };
}

function existingOpenCodeConfigPaths(
  directory: string,
  fileSystem: OpenCodeMcpFileSystem,
): string[] {
  return openCodeConfigPaths(directory).filter(fileSystem.existsSync);
}

function parseErrorSummary(
  text: string,
  errors: readonly ParseError[],
): string {
  return errors
    .map((error) => {
      const line = text.slice(0, error.offset).split("\n").length;
      return `${printParseErrorCode(error.error)} at line ${line}`;
    })
    .join(", ");
}

function invalidConfiguration(
  path: string,
  cause: string,
  expected: string,
): { error: string } {
  return {
    error: formatInitError(
      "invalid-opencode-configuration",
      "could not register the Atlante MCP server",
      {
        source: path,
        expected,
        next: "fix the OpenCode configuration and run `atlante init` again",
        cause,
      },
    ),
  };
}

function sameCommand(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === ATLANTE_MCP_COMMAND.length &&
    value.every((part, index) => part === ATLANTE_MCP_COMMAND[index])
  );
}

function isRegisteredMcp(value: unknown, dialect: OpenCodeDialect): boolean {
  const descriptor =
    dialect === "v1"
      ? { key: "enabled", value: true, opposite: "disabled" }
      : { key: "disabled", value: false, opposite: "enabled" };
  return (
    isObject(value) &&
    value.type === "local" &&
    sameCommand(value.command) &&
    (value[descriptor.key] === undefined ||
      value[descriptor.key] === descriptor.value) &&
    value[descriptor.opposite] === undefined
  );
}

function valueAtPath(
  value: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = value;
  for (const part of path) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function mcpPathLabel(path: readonly string[]): string {
  return path.join(".");
}

function conflictingManagedEntry(
  path: string,
  mcpPath: readonly string[],
): { error: string } {
  const label = mcpPathLabel(mcpPath);
  return invalidConfiguration(
    path,
    `the "${label}" entry conflicts with Atlante's managed server command`,
    `"${label}" must be a local server using the version-pinned Atlante command`,
  );
}

function parseConfiguration(
  path: string,
  text: string,
  dialect: OpenCodeDialect,
): { value: Record<string, unknown> } | { error: string } {
  const errors: ParseError[] = [];
  const parsed = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    return invalidConfiguration(
      path,
      `malformed JSONC: ${parseErrorSummary(text, errors)}`,
      "a valid JSON or JSONC object with an optional mcp object",
    );
  }
  if (!isObject(parsed)) {
    return invalidConfiguration(
      path,
      "the document is not a JSON object",
      "a valid JSON or JSONC object with an optional mcp object",
    );
  }

  if (parsed.mcp !== undefined && !isObject(parsed.mcp)) {
    return invalidConfiguration(
      path,
      'the "mcp" field must be an object',
      '"mcp" must be an object whose server entries are objects',
    );
  }

  const mcp = parsed.mcp as Record<string, unknown> | undefined;
  const invalidEntry = firstInvalidMcpEntry(mcp, dialect);
  if (invalidEntry) {
    return invalidConfiguration(
      path,
      `the "mcp.${invalidEntry.id}" entry is invalid: ${invalidEntry.cause}`,
      '"mcp" must be an object whose server entries are objects',
    );
  }

  const managedPath = openCodeMcpPath(dialect, ATLANTE_MCP_SERVER_ID);
  const existing = valueAtPath(parsed, managedPath);
  if (existing !== undefined && !isRegisteredMcp(existing, dialect))
    return conflictingManagedEntry(path, managedPath);
  return { value: parsed };
}

const FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
} as const;

function newConfiguration(): string {
  return `{
  "$schema": "https://opencode.ai/config.json"
}
`;
}

/**
 * Prepares a preservation-safe OpenCode JSON/JSONC edit. The caller owns the
 * eventual write so init can include it in its existing rollback transaction.
 */
export function prepareOpenCodeMcp(
  directory: string,
  fileSystem: OpenCodeMcpFileSystem,
  dialect: OpenCodeDialect = "v2",
): OpenCodeMcpPlan | { error: string } {
  const managedPath = openCodeMcpPath(dialect, ATLANTE_MCP_SERVER_ID);
  const configurations: {
    path: string;
    previous: OpenCodeMcpSnapshot;
    contents: string;
    value: Record<string, unknown>;
  }[] = [];
  for (const path of existingOpenCodeConfigPaths(directory, fileSystem)) {
    const previous = snapshot(path, fileSystem);
    const contents = previous.contents ?? "";
    const parsedResult = parseConfiguration(path, contents, dialect);
    if ("error" in parsedResult) return parsedResult;
    configurations.push({
      path,
      previous,
      contents,
      value: parsedResult.value,
    });
  }

  const target = configurations[0];
  if (target && valueAtPath(target.value, managedPath) !== undefined) {
    return {
      path: target.path,
      previous: target.previous,
      contents: target.contents,
      write: false,
      registered: false,
    };
  }

  const path = target?.path ?? join(directory, "opencode.jsonc");
  const previous = target?.previous ?? { exists: false };
  const text = target?.contents ?? newConfiguration();
  const edits = modify(
    text,
    [...managedPath],
    createOpenCodeMcpServer(dialect, ATLANTE_MCP_COMMAND),
    { formattingOptions: FORMATTING_OPTIONS },
  );
  return {
    path,
    previous,
    contents: applyEdits(text, edits),
    write: true,
    registered: true,
  };
}

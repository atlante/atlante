import { join } from "node:path";
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

const ATLANTE_MCP_SERVER = {
  type: "local",
  command: ["npx", "--yes", `atlante@${packageJson.version}`, "mcp"],
  enabled: true,
} as const;

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

function isOAuthConfig(value: unknown): boolean {
  if (value === false) return true;
  if (!isObject(value)) return false;
  if (
    !onlyAllowedKeys(value, [
      "clientId",
      "clientSecret",
      "scope",
      "callbackPort",
      "redirectUri",
    ])
  )
    return false;
  if (
    !optionalStringFields(value, [
      "clientId",
      "clientSecret",
      "scope",
      "redirectUri",
    ])
  )
    return false;
  return (
    value.callbackPort === undefined ||
    (positiveSafeInteger(value.callbackPort) && value.callbackPort <= 65535)
  );
}

function commonMcpEntryError(
  value: Record<string, unknown>,
): string | undefined {
  if (value.enabled !== undefined && typeof value.enabled !== "boolean")
    return 'the "enabled" field must be a boolean';
  if (value.timeout !== undefined && !positiveSafeInteger(value.timeout))
    return 'the "timeout" field must be a positive safe integer';
  return undefined;
}

function localMcpEntryError(
  value: Record<string, unknown>,
): string | undefined {
  const commonError = commonMcpEntryError(value);
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
): string | undefined {
  const commonError = commonMcpEntryError(value);
  if (commonError !== undefined) return commonError;
  if (typeof value.url !== "string")
    return 'a remote server requires a string "url"';
  if (value.headers !== undefined && !isStringMap(value.headers))
    return 'the "headers" field must be an object of strings';
  if (value.oauth !== undefined && !isOAuthConfig(value.oauth))
    return 'the "oauth" field has an invalid shape';
  return undefined;
}

function isEnabledOnlyMcpEntry(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 1 && Object.hasOwn(value, "enabled");
}

function enabledOnlyMcpEntryError(
  value: Record<string, unknown>,
): string | undefined {
  return typeof value.enabled === "boolean"
    ? undefined
    : 'the "enabled" field must be a boolean';
}

function mcpObjectEntryError(
  value: Record<string, unknown>,
): string | undefined {
  if (value.type !== "local" && value.type !== "remote")
    return 'the "type" field must be "local" or "remote"';

  const allowedKeys =
    value.type === "local"
      ? ["type", "command", "cwd", "environment", "enabled", "timeout"]
      : ["type", "url", "enabled", "headers", "oauth", "timeout"];
  const unknownKey = Object.keys(value).find(
    (key) => !allowedKeys.includes(key),
  );
  if (unknownKey !== undefined)
    return `the "${unknownKey}" field is not valid for a ${value.type} server`;

  return value.type === "local"
    ? localMcpEntryError(value)
    : remoteMcpEntryError(value);
}

function mcpEntryError(value: unknown): string | undefined {
  if (!isObject(value)) return "the server entry must be an object";
  if (isEnabledOnlyMcpEntry(value)) return enabledOnlyMcpEntryError(value);
  return mcpObjectEntryError(value);
}

function firstInvalidMcpEntry(
  mcp: Record<string, unknown> | undefined,
): { id: string; cause: string } | undefined {
  for (const [id, value] of Object.entries(mcp ?? {})) {
    const cause = mcpEntryError(value);
    if (cause !== undefined) return { id, cause };
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

/** OpenCode prefers JSONC when both project configuration files are present. */
function resolveOpenCodeConfigPath(
  directory: string,
  fileSystem: OpenCodeMcpFileSystem,
): string {
  const jsonc = join(directory, "opencode.jsonc");
  if (fileSystem.existsSync(jsonc)) return jsonc;
  const json = join(directory, "opencode.json");
  if (fileSystem.existsSync(json)) return json;
  return jsonc;
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
    value.length === ATLANTE_MCP_SERVER.command.length &&
    value.every((part, index) => part === ATLANTE_MCP_SERVER.command[index])
  );
}

function isRegisteredMcp(value: unknown): boolean {
  return (
    isObject(value) &&
    value.type === ATLANTE_MCP_SERVER.type &&
    sameCommand(value.command) &&
    (value.enabled === undefined || value.enabled === true)
  );
}

function parseConfiguration(
  path: string,
  text: string,
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
  const invalidEntry = firstInvalidMcpEntry(mcp);
  if (invalidEntry) {
    return invalidConfiguration(
      path,
      `the "mcp.${invalidEntry.id}" entry is invalid: ${invalidEntry.cause}`,
      '"mcp" must be an object whose server entries are objects',
    );
  }

  const existing = mcp?.[ATLANTE_MCP_SERVER_ID];
  if (existing !== undefined && !isRegisteredMcp(existing)) {
    return invalidConfiguration(
      path,
      `the "mcp.${ATLANTE_MCP_SERVER_ID}" entry conflicts with Atlante's managed server command`,
      `"mcp.${ATLANTE_MCP_SERVER_ID}" must be a local server using the version-pinned Atlante command`,
    );
  }
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
): OpenCodeMcpPlan | { error: string } {
  const path = resolveOpenCodeConfigPath(directory, fileSystem);
  const previous = snapshot(path, fileSystem);
  const text = previous.exists ? (previous.contents ?? "") : newConfiguration();
  const parsedResult = parseConfiguration(path, text);
  if ("error" in parsedResult) return parsedResult;
  const parsed = parsedResult.value;

  const mcp = parsed.mcp as Record<string, unknown> | undefined;
  if (mcp?.[ATLANTE_MCP_SERVER_ID] !== undefined) {
    return { path, previous, contents: text, write: false, registered: false };
  }

  const edits = modify(
    text,
    ["mcp", ATLANTE_MCP_SERVER_ID],
    ATLANTE_MCP_SERVER,
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

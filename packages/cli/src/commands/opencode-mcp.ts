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

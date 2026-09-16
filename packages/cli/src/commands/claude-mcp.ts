import { join } from "node:path";
import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from "jsonc-parser";
import { formatInitError } from "./init-error.js";
import { ATLANTE_MCP_COMMAND } from "./opencode-mcp.js";

const ATLANTE_MCP_SERVER_ID = "atlante" as const;

/**
 * Project-scoped Claude Code MCP file. Unlike OpenCode's layered JSON/JSONC
 * configs, Claude Code reads exactly this path for shared servers.
 */
const CLAUDE_MCP_PATH = ".mcp.json";

export type ClaudeMcpFileSystem = Readonly<{
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
}>;

export type ClaudeMcpSnapshot = Readonly<{
  exists: boolean;
  contents?: string;
}>;

export type ClaudeMcpPlan = Readonly<{
  path: string;
  previous: ClaudeMcpSnapshot;
  contents: string;
  write: boolean;
  registered: boolean;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function managedEntry(): Record<string, unknown> {
  return {
    command: ATLANTE_MCP_COMMAND[0],
    args: [...ATLANTE_MCP_COMMAND.slice(1)],
  };
}

function isManagedEntry(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.command !== ATLANTE_MCP_COMMAND[0]) return false;
  const args = value.args;
  const expected = ATLANTE_MCP_COMMAND.slice(1);
  return (
    Array.isArray(args) &&
    args.length === expected.length &&
    args.every((part, index) => part === expected[index])
  );
}

function invalidConfiguration(
  path: string,
  message: string,
  expected: string,
): { error: string } {
  return {
    error: formatInitError("invalid-host-configuration", message, {
      source: path,
      expected,
      next: "fix the reported entry and run `atlante init` again",
    }),
  };
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
    .join("; ");
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
      `malformed JSON: ${parseErrorSummary(text, errors)}`,
      'a valid JSON object with an optional "mcpServers" object',
    );
  }
  if (!isObject(parsed)) {
    return invalidConfiguration(
      path,
      "the document is not a JSON object",
      'a valid JSON object with an optional "mcpServers" object',
    );
  }
  if (parsed.mcpServers !== undefined && !isObject(parsed.mcpServers)) {
    return invalidConfiguration(
      path,
      'the "mcpServers" field must be an object',
      '"mcpServers" must be an object whose server entries are objects',
    );
  }
  const servers = parsed.mcpServers as Record<string, unknown> | undefined;
  if (servers) {
    for (const [id, entry] of Object.entries(servers)) {
      if (!isObject(entry)) {
        return invalidConfiguration(
          path,
          `the "mcpServers.${id}" entry is invalid: expected an object`,
          '"mcpServers" must be an object whose server entries are objects',
        );
      }
    }
    const existing = servers[ATLANTE_MCP_SERVER_ID];
    if (existing !== undefined && !isManagedEntry(existing)) {
      return invalidConfiguration(
        path,
        `the "mcpServers.${ATLANTE_MCP_SERVER_ID}" entry conflicts with Atlante's managed server command`,
        `"mcpServers.${ATLANTE_MCP_SERVER_ID}" must be a local server using the version-pinned Atlante command`,
      );
    }
  }
  return { value: parsed };
}

const FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
} as const;

/**
 * Prepares a preservation-safe `.mcp.json` edit registering the read-only
 * Atlante server for Claude Code. The caller owns the eventual write so init
 * can include it in its existing rollback transaction. Native materialization
 * stays separate from this runtime integration.
 */
export function prepareClaudeMcp(
  directory: string,
  fileSystem: ClaudeMcpFileSystem,
): ClaudeMcpPlan | { error: string } {
  const path = join(directory, CLAUDE_MCP_PATH);
  const text = fileSystem.existsSync(path)
    ? fileSystem.readFileSync(path, "utf8")
    : "{}\n";
  const previous: ClaudeMcpSnapshot = fileSystem.existsSync(path)
    ? { exists: true, contents: text }
    : { exists: false };
  const parsedResult = parseConfiguration(path, text);
  if ("error" in parsedResult) return parsedResult;

  const servers = parsedResult.value.mcpServers as
    | Record<string, unknown>
    | undefined;
  if (servers?.[ATLANTE_MCP_SERVER_ID] !== undefined) {
    return { path, previous, contents: text, write: false, registered: false };
  }

  const edits = modify(
    text,
    ["mcpServers", ATLANTE_MCP_SERVER_ID],
    managedEntry(),
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

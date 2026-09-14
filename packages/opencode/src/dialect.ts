import { execFileSync } from "node:child_process";

export type OpenCodeDialect = "v1" | "v2";

export type OpenCodeVersion = Readonly<{
  major: number;
  minor: number;
  patch: number;
  raw: string;
}>;

export type OpenCodeVersionErrorCode =
  | "binary-unavailable"
  | "invalid-version"
  | "unsupported-version";

export class OpenCodeVersionError extends Error {
  readonly code: OpenCodeVersionErrorCode;
  readonly binaryPath?: string;
  readonly version?: OpenCodeVersion;

  constructor(
    code: OpenCodeVersionErrorCode,
    message: string,
    options: {
      binaryPath?: string;
      cause?: unknown;
      version?: OpenCodeVersion;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OpenCodeVersionError";
    this.code = code;
    this.binaryPath = options.binaryPath;
    this.version = options.version;
  }
}

export type OpenCodeVersionProbe = (binaryPath: string) => string;

export type OpenCodeDialectDescriptor = Readonly<{
  agentsKey: "agent" | "agents";
  permissionsKey: "permission" | "permissions";
  shellAction: "bash" | "shell";
  subagentAction: "task" | "subagent";
  mcpServersPath: readonly string[];
  mcpEnabledKey: "enabled" | "disabled";
  mcpEnabledValue: boolean;
}>;

const DIALECT_DESCRIPTORS: Readonly<
  Record<OpenCodeDialect, OpenCodeDialectDescriptor>
> = Object.freeze({
  v1: Object.freeze({
    agentsKey: "agent",
    permissionsKey: "permission",
    shellAction: "bash",
    subagentAction: "task",
    mcpServersPath: ["mcp"],
    mcpEnabledKey: "enabled",
    mcpEnabledValue: true,
  }),
  v2: Object.freeze({
    agentsKey: "agents",
    permissionsKey: "permissions",
    shellAction: "shell",
    subagentAction: "subagent",
    mcpServersPath: ["mcp", "servers"],
    mcpEnabledKey: "disabled",
    mcpEnabledValue: false,
  }),
});

const defaultVersionProbe: OpenCodeVersionProbe = (binaryPath) =>
  execFileSync(binaryPath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** Parses output such as `opencode v2.0.3` or a bare semantic version. */
export function parseOpenCodeVersion(output: string): OpenCodeVersion {
  const raw = output.trim();
  const match = raw.match(
    /(?:^|\s)v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:$|\s)/,
  );
  if (!match) {
    throw new OpenCodeVersionError(
      "invalid-version",
      `could not determine a stable OpenCode version from: ${raw || "empty output"}`,
    );
  }

  const versionText = match[1];
  if (versionText === undefined) {
    throw new OpenCodeVersionError(
      "invalid-version",
      `could not determine a stable OpenCode version from: ${raw || "empty output"}`,
    );
  }
  const components = versionText.split(".");
  const major = Number(components[0]);
  const minor = Number(components[1]);
  const patch = Number(components[2]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    throw new OpenCodeVersionError(
      "invalid-version",
      `could not determine a stable OpenCode version from: ${raw || "empty output"}`,
    );
  }

  return {
    major,
    minor,
    patch,
    raw,
  };
}

/** Returns the field names and config paths for one supported dialect. */
export function openCodeDialectDescriptor(
  dialect: OpenCodeDialect,
): OpenCodeDialectDescriptor {
  return DIALECT_DESCRIPTORS[dialect];
}

/** Returns the config path to one named MCP server for a supported dialect. */
export function openCodeMcpPath(
  dialect: OpenCodeDialect,
  serverId: string,
): readonly string[] {
  return [...DIALECT_DESCRIPTORS[dialect].mcpServersPath, serverId];
}

/** Builds a dialect-native local MCP server entry without owning its command. */
export function createOpenCodeMcpServer(
  dialect: OpenCodeDialect,
  command: readonly string[],
): Record<string, unknown> {
  const descriptor = DIALECT_DESCRIPTORS[dialect];
  return {
    type: "local",
    command: [...command],
    [descriptor.mcpEnabledKey]: descriptor.mcpEnabledValue,
  };
}

/**
 * Resolves only the explicitly supported major lines. V1 starts at the first
 * version that supports the dual plugin entrypoint, while V2 is limited to the
 * 2.x line until a future migration establishes another contract.
 */
export function resolveOpenCodeDialect(
  version: OpenCodeVersion,
): OpenCodeDialect {
  if (
    version.major === 1 &&
    (version.minor > 18 ||
      (version.minor === 18 && version.patch >= 29))
  ) {
    return "v1";
  }
  if (version.major === 2) return "v2";

  throw new OpenCodeVersionError(
    "unsupported-version",
    `unsupported OpenCode version ${version.raw}; supported versions are V1 >=1.18.29 <2.0.0 or V2 >=2.0.0 <3.0.0`,
    { version },
  );
}

/** Detects and resolves a host version through one `--version` invocation. */
export function detectOpenCode(
  binaryPath = "opencode",
  probe: OpenCodeVersionProbe = defaultVersionProbe,
): { version: OpenCodeVersion; dialect: OpenCodeDialect } {
  let output: string;
  try {
    output = probe(binaryPath);
  } catch (cause) {
    throw new OpenCodeVersionError(
      "binary-unavailable",
      `could not run ${binaryPath} --version`,
      { binaryPath, cause },
    );
  }

  let version: OpenCodeVersion;
  try {
    version = parseOpenCodeVersion(output);
  } catch (cause) {
    if (cause instanceof OpenCodeVersionError) {
      throw new OpenCodeVersionError(
        cause.code,
        `${cause.message} (${binaryPath})`,
        { binaryPath, cause },
      );
    }
    throw cause;
  }

  try {
    return { version, dialect: resolveOpenCodeDialect(version) };
  } catch (cause) {
    if (cause instanceof OpenCodeVersionError) {
      throw new OpenCodeVersionError(
        cause.code,
        `${cause.message} (${binaryPath})`,
        { binaryPath, cause, version },
      );
    }
    throw cause;
  }
}

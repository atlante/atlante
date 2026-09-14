import { expect, test } from "bun:test";
import {
  createOpenCodeMcpServer,
  detectOpenCode,
  openCodeDialectDescriptor,
  openCodeMcpPath,
  OpenCodeVersionError,
  parseOpenCodeVersion,
  resolveOpenCodeDialect,
} from "../src/dialect.js";

test("parses the version reported by the OpenCode binary", () => {
  expect(parseOpenCodeVersion("opencode v2.0.3\n")).toEqual({
    major: 2,
    minor: 0,
    patch: 3,
    raw: "opencode v2.0.3",
  });
});

test.each([
  ["1.18.29", "v1"],
  ["1.19.0", "v1"],
  ["2.0.0", "v2"],
  ["2.0.3", "v2"],
] as const)("resolves supported version %s to %s", (version, dialect) => {
  expect(resolveOpenCodeDialect(parseOpenCodeVersion(version))).toBe(dialect);
});

test.each(["1.18.28", "3.0.0", "0.9.0"])(
  "rejects unsupported version %s",
  (version) => {
    expect(() =>
      resolveOpenCodeDialect(parseOpenCodeVersion(version)),
    ).toThrow(OpenCodeVersionError);
  },
);

test("rejects output without a stable semantic version", () => {
  expect(() => parseOpenCodeVersion("OpenCode development build")).toThrow(
    OpenCodeVersionError,
  );
});

test("rejects semver components with leading zeroes", () => {
  expect(() => parseOpenCodeVersion("opencode v01.18.029")).toThrow(
    OpenCodeVersionError,
  );
});

test.each([
  ["v1", "agent", "permission", "bash", "task", ["mcp"], "enabled", true],
  [
    "v2",
    "agents",
    "permissions",
    "shell",
    "subagent",
    ["mcp", "servers"],
    "disabled",
    false,
  ],
] as const)(
  "exposes the %s dialect field and path mapping",
  (
    dialect,
    agentsKey,
    permissionsKey,
    shellAction,
    subagentAction,
    mcpServersPath,
    mcpEnabledKey,
    mcpEnabledValue,
  ) => {
    expect(openCodeDialectDescriptor(dialect)).toEqual({
      agentsKey,
      permissionsKey,
      shellAction,
      subagentAction,
      mcpServersPath,
      mcpEnabledKey,
      mcpEnabledValue,
    });
  },
);

test.each([
  ["v1", ["mcp", "atlante"]],
  ["v2", ["mcp", "servers", "atlante"]],
] as const)("locates the %s MCP server", (dialect, path) => {
  expect(openCodeMcpPath(dialect, "atlante")).toEqual(path);
});

test("constructs native MCP entries without changing the command", () => {
  expect(createOpenCodeMcpServer("v1", ["npx", "atlante", "mcp"])).toEqual({
    type: "local",
    command: ["npx", "atlante", "mcp"],
    enabled: true,
  });
  expect(createOpenCodeMcpServer("v2", ["npx", "atlante", "mcp"])).toEqual({
    type: "local",
    command: ["npx", "atlante", "mcp"],
    disabled: false,
  });
});

test("probes a binary once through the injected version command", () => {
  const calls: string[] = [];
  const result = detectOpenCode("/tmp/opencode", (binaryPath) => {
    calls.push(binaryPath);
    return "opencode v1.18.29\n";
  });

  expect(calls).toEqual(["/tmp/opencode"]);
  expect(result.dialect).toBe("v1");
  expect(result.version.raw).toBe("opencode v1.18.29");
});

test("retains the binary path when version resolution rejects the host", () => {
  expect(() =>
    detectOpenCode("/tmp/opencode", () => "opencode v3.0.0\n"),
  ).toThrow(/\/tmp\/opencode/);
  try {
    detectOpenCode("/tmp/opencode", () => "opencode v3.0.0\n");
  } catch (error) {
    expect(error).toMatchObject({
      code: "unsupported-version",
      binaryPath: "/tmp/opencode",
    });
  }
});

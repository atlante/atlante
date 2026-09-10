import { describe, expect, test } from "bun:test";
import { MCP_MAX_MESSAGE_BYTES } from "../src/mcp/contract.js";
import type { McpOperations } from "../src/mcp/project.js";
import { createMcpServer } from "../src/mcp/server.js";

type Output = { write: (chunk: string) => boolean };

function envelope(tool: string, data: unknown = {}): Record<string, unknown> {
  return {
    contract_version: "atlante-mcp/v1",
    tool,
    status: "ok",
    data,
  };
}

function harness(overrides: Partial<McpOperations> = {}): {
  server: ReturnType<typeof createMcpServer>;
  output: string[];
  errors: string[];
} {
  const output: string[] = [];
  const errors: string[] = [];
  const stdout: Output = {
    write: (chunk) => {
      output.push(chunk);
      return true;
    },
  };
  const stderr: Output = {
    write: (chunk) => {
      errors.push(chunk);
      return true;
    },
  };
  const operations = {
    inspectProject: () => envelope("inspect_project", { project: "fixture" }),
    listResources: () => envelope("list_resources", { resources: [] }),
    validate: () => envelope("validate", { valid: true }),
    searchDocs: () => envelope("search_docs", { matches: [] }),
    readDoc: () => envelope("read_doc", { content: "fixture" }),
    getSchema: () => envelope("get_schema", { schema: {} }),
    ...overrides,
  };
  return {
    server: createMcpServer({ operations, stdout, stderr }),
    output,
    errors,
  };
}

function response(output: string[]): Record<string, unknown> {
  const line = output.shift();
  if (!line) throw new Error("expected an MCP response");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("MCP stdio protocol", () => {
  test("initializes, lists tools, dispatches calls, and keeps stdout protocol-only", async () => {
    const { server, output, errors } = harness();

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      }),
    );
    const initialized = response(output);
    expect(initialized).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "atlante" },
        capabilities: { tools: { listChanged: false } },
      },
    });

    await server.handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const listing = response(output);
    const tools = (listing.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map(({ name }) => name)).toEqual([
      "inspect_project",
      "list_resources",
      "validate",
      "search_docs",
      "read_doc",
      "get_schema",
    ]);

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "validate", arguments: {} },
      }),
    );
    const call = response(output);
    expect(call).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        isError: false,
        structuredContent: {
          contract_version: "atlante-mcp/v1",
          tool: "validate",
          status: "ok",
        },
      },
    });
    const text = (call.result as { content: Array<{ text: string }> })
      .content[0]?.text;
    expect(JSON.parse(text ?? "{}")).toMatchObject({
      tool: "validate",
      status: "ok",
    });
    expect(errors).toEqual([]);
    expect(output).toEqual([]);
  });

  test("negotiates an unsupported client version to the newest supported version", async () => {
    const { server, output } = harness();

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "initialize",
        params: { protocolVersion: "2026-07-28" },
      }),
    );

    expect(response(output)).toMatchObject({
      id: 7,
      result: { protocolVersion: "2025-06-18" },
    });
  });

  test("returns structured invalid-input results and JSON-RPC errors", async () => {
    const { server, output } = harness();

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "bad-args",
        method: "tools/call",
        params: {
          name: "search_docs",
          arguments: { query: "docs", unexpected: true },
        },
      }),
    );
    expect(response(output)).toMatchObject({
      id: "bad-args",
      result: {
        isError: true,
        structuredContent: {
          tool: "search_docs",
          status: "invalid",
        },
      },
    });

    await server.handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "unknown/method" }),
    );
    expect(response(output)).toMatchObject({
      id: 4,
      error: { code: -32601 },
    });

    await server.handleLine("not-json");
    expect(response(output)).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700 },
    });

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "search_docs",
          arguments: { query: "x".repeat(257) },
        },
      }),
    );
    expect(response(output)).toMatchObject({
      id: 5,
      result: {
        isError: true,
        structuredContent: { tool: "search_docs", status: "invalid" },
      },
    });

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "list_resources", arguments: { limit: 101 } },
      }),
    );
    expect(response(output)).toMatchObject({
      id: 6,
      result: {
        isError: true,
        structuredContent: { tool: "list_resources", status: "invalid" },
      },
    });

    await server.handleLine("x".repeat(MCP_MAX_MESSAGE_BYTES + 1));
    expect(response(output)).toMatchObject({
      id: null,
      error: { code: -32600 },
    });

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: { toString: "not-callable" }, arguments: {} },
      }),
    );
    expect(response(output)).toMatchObject({
      id: 8,
      error: { code: -32602 },
    });

    await server.handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
    );
    expect(response(output)).toMatchObject({ id: 9, result: {} });
  });

  test("does not answer protocol notifications and supports ping and shutdown", async () => {
    const { server, output } = harness();

    await server.handleLine(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(output).toEqual([]);

    await server.handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "ping" }),
    );
    expect(response(output)).toMatchObject({ id: 5, result: {} });

    const keepReading = await server.handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 6, method: "shutdown" }),
    );
    expect(response(output)).toMatchObject({ id: 6, result: {} });
    expect(keepReading).toBe(false);
  });

  test("keeps protocol output structured when an operation fails", async () => {
    const { server, output, errors } = harness({
      validate: () => {
        throw new Error("fixture operation failed");
      },
    });

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "validate", arguments: {} },
      }),
    );

    expect(response(output)).toMatchObject({
      id: 10,
      result: {
        isError: true,
        structuredContent: {
          tool: "validate",
          status: "unavailable",
          diagnostics: [{ code: "internal-error" }],
        },
      },
    });
    expect(errors).toEqual(["atlante mcp: fixture operation failed\n"]);
  });

  test("bounds oversized tool responses with a structured diagnostic", async () => {
    const { server, output, errors } = harness({
      inspectProject: () =>
        envelope("inspect_project", {
          payload: "x".repeat(MCP_MAX_MESSAGE_BYTES),
        }),
    });

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "inspect_project", arguments: {} },
      }),
    );

    expect(
      new TextEncoder().encode(output[0] ?? "").byteLength,
    ).toBeLessThanOrEqual(MCP_MAX_MESSAGE_BYTES);
    expect(response(output)).toMatchObject({
      id: 11,
      result: {
        isError: true,
        structuredContent: {
          tool: "inspect_project",
          status: "unavailable",
          diagnostics: [{ code: "response-too-large" }],
        },
      },
    });
    expect(errors).toEqual([]);
  });

  test("bounds oversized validation diagnostics with a structured diagnostic", async () => {
    const { server, output } = harness();
    const oversizedKey = "x".repeat(MCP_MAX_MESSAGE_BYTES - 2048);
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "validate", arguments: { [oversizedKey]: true } },
    });

    expect(new TextEncoder().encode(request).byteLength).toBeLessThanOrEqual(
      MCP_MAX_MESSAGE_BYTES,
    );
    await server.handleLine(request);

    expect(
      new TextEncoder().encode(output[0] ?? "").byteLength,
    ).toBeLessThanOrEqual(MCP_MAX_MESSAGE_BYTES);
    expect(response(output)).toMatchObject({
      id: 13,
      result: {
        isError: true,
        structuredContent: {
          tool: "validate",
          status: "unavailable",
          diagnostics: [{ code: "response-too-large" }],
        },
      },
    });
  });

  test("uses a null id when an oversized response cannot retain the request id", async () => {
    const { server, output } = harness();
    let requestId = "x".repeat(MCP_MAX_MESSAGE_BYTES);
    let request = JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/list",
    });
    while (
      new TextEncoder().encode(request).byteLength > MCP_MAX_MESSAGE_BYTES
    ) {
      requestId = requestId.slice(0, -1);
      request = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/list",
      });
    }

    expect(new TextEncoder().encode(request).byteLength).toBeLessThanOrEqual(
      MCP_MAX_MESSAGE_BYTES,
    );
    await server.handleLine(request);

    expect(
      new TextEncoder().encode(output[0] ?? "").byteLength,
    ).toBeLessThanOrEqual(MCP_MAX_MESSAGE_BYTES);
    expect(response(output)).toMatchObject({
      id: null,
      error: { code: -32000 },
    });
  });

  test("rejects null tool arguments instead of treating them as an empty object", async () => {
    const { server, output } = harness();

    await server.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "validate", arguments: null },
      }),
    );

    expect(response(output)).toMatchObject({
      id: 12,
      result: {
        isError: true,
        structuredContent: {
          tool: "validate",
          status: "invalid",
          diagnostics: [{ code: "invalid-arguments" }],
        },
      },
    });
  });

  test("validates inspect_project arguments and forwards include sections", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const { server, output } = harness({
      inspectProject: (input) => {
        calls.push({ ...input });
        return envelope("inspect_project", { include: input.include ?? null });
      },
    });

    const call = (id: number, args: Record<string, unknown>) =>
      server.handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "inspect_project", arguments: args },
        }),
      );

    await call(20, { include: [], unexpected: true });
    expect(response(output)).toMatchObject({
      id: 20,
      result: {
        isError: true,
        structuredContent: {
          tool: "inspect_project",
          status: "invalid",
          diagnostics: [{ code: "invalid-arguments" }],
        },
      },
    });

    await call(21, { include: "resolved" });
    expect(response(output)).toMatchObject({
      id: 21,
      result: { isError: true, structuredContent: { status: "invalid" } },
    });

    await call(22, { include: ["resolved", "bogus"] });
    expect(response(output)).toMatchObject({
      id: 22,
      result: { isError: true, structuredContent: { status: "invalid" } },
    });

    await call(23, { include: ["resolved", "artifact-files"] });
    expect(response(output)).toMatchObject({
      id: 23,
      result: {
        isError: false,
        structuredContent: {
          tool: "inspect_project",
          status: "ok",
          data: { include: ["resolved", "artifact-files"] },
        },
      },
    });
    expect(calls.at(-1)).toEqual({ include: ["resolved", "artifact-files"] });

    await call(24, {});
    expect(response(output)).toMatchObject({
      id: 24,
      result: { isError: false, structuredContent: { status: "ok" } },
    });
    expect(calls.at(-1)).toEqual({});

    await call(25, { include: [] });
    expect(response(output)).toMatchObject({
      id: 25,
      result: {
        isError: false,
        structuredContent: { status: "ok", data: { include: [] } },
      },
    });
    expect(calls.at(-1)).toEqual({ include: [] });
  });
});

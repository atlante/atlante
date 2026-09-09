import { afterEach, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_URI } from "@atlante/schema";

const created: string[] = [];
const builtCliEntry = fileURLToPath(
  new URL("../dist/bin/atlante.js", import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

beforeAll(() => {
  if (existsSync(builtCliEntry)) return;
  const build = spawnSync("bun", ["run", "build"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (build.status !== 0)
    throw new Error(`could not build the Node CLI launcher: ${build.stderr}`);
});

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "atlante-mcp-"));
  created.push(directory);
  writeFileSync(
    join(directory, "atlante.jsonc"),
    `${JSON.stringify(
      {
        $schema: SCHEMA_URI,
        values: {
          project: "mcp-fixture",
          absolute: "/outside/atlante-mcp-absolute-sentinel",
          active: `${directory}/active-file-sentinel`,
        },
        agents: {
          reviewer: {
            $template: "@atlante/pack/agent",
            description:
              "Reviews changes from [/outside/atlante-mcp-nested-sentinel].",
            identity: `You review changes in ${directory}/nested-file-sentinel.`,
            mission: "Find defects.",
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({
      name: "atlante-mcp-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  mkdirSync(join(directory, "node_modules", "@atlante"), {
    recursive: true,
  });
  cpSync(
    firstPartyPackRoot,
    join(directory, "node_modules", "@atlante", "pack"),
    { recursive: true },
  );
  return directory;
}

type RpcResponse = {
  id?: string | number | null;
  result?: {
    structuredContent?: {
      status?: string;
      data?: Record<string, unknown>;
      diagnostics?: Array<{ code: string }>;
    };
    isError?: boolean;
  };
  error?: { code: number };
};

function runServer(directory: string): {
  responses: RpcResponse[];
  stdout: string;
  stderr: string;
} {
  const input = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "inspect_project", arguments: {} },
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "list_resources", arguments: {} },
    },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "validate", arguments: {} },
    },
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "search_docs",
        arguments: { query: "api-review" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "read_doc",
        arguments: {
          document_id: "guides/building-a-harness",
          section_id: "add-reusable-review-guidance",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "get_schema", arguments: { uri: SCHEMA_URI } },
    },
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "get_schema",
        arguments: { uri: "https://atlante.sh/schema/v0.1/unknown.json" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 10, method: "shutdown" },
  ]
    .map((request) => JSON.stringify(request))
    .join("\n");
  const result = spawnSync("node", [builtCliEntry, "mcp"], {
    cwd: directory,
    encoding: "utf8",
    input: `${input}\n`,
  });
  if (result.error) throw result.error;
  expect(result.status).toBe(0);
  const stdout = result.stdout as string;
  return {
    responses: stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RpcResponse),
    stdout,
    stderr: result.stderr as string,
  };
}

test("serves the six read-only tools from the active workspace", () => {
  const directory = fixture();
  const beforeEntries = readdirSync(directory, { recursive: true }).sort();
  const beforeConfig = readFileSync(join(directory, "atlante.jsonc"), "utf8");
  const { responses, stdout, stderr } = runServer(directory);
  const byId = new Map(responses.map((response) => [response.id, response]));

  expect(responses).toHaveLength(10);
  expect(byId.get(1)).toMatchObject({
    result: {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "atlante" },
    },
  });
  const listingResult = byId.get(2)?.result;
  if (!listingResult) throw new Error("expected tools/list response");
  expect(
    (listingResult as { tools: Array<{ name: string }> }).tools.map(
      ({ name }) => name,
    ),
  ).toEqual([
    "inspect_project",
    "list_resources",
    "validate",
    "search_docs",
    "read_doc",
    "get_schema",
  ]);

  expect(byId.get(3)).toMatchObject({
    result: {
      structuredContent: {
        tool: "inspect_project",
        status: "ok",
        data: {
          project_root: ".",
          configuration: {
            path: "atlante.jsonc",
            schema_uri: SCHEMA_URI,
            authored: {
              values: {
                absolute: "<absolute-path>",
                active: "<absolute-path>",
              },
              agents: {
                reviewer: {
                  description: "Reviews changes from [<absolute-path>].",
                  identity: "You review changes in <absolute-path>",
                },
              },
            },
            effective: {
              values: {
                absolute: "<absolute-path>",
                active: "<absolute-path>",
              },
            },
            resolved: {
              values: {
                absolute: "<absolute-path>",
                active: "<absolute-path>",
              },
            },
            provenance: expect.arrayContaining([
              {
                pointer: "/values/project",
                origin: { kind: "project", path: "atlante.jsonc" },
              },
            ]),
          },
          capabilities: {
            documentation: { status: "available" },
            schema: { status: "available" },
          },
        },
      },
    },
  });
  expect(byId.get(4)).toMatchObject({
    result: {
      structuredContent: {
        tool: "list_resources",
        status: expect.stringMatching(/^(ok|empty)$/),
        data: {
          resources: expect.arrayContaining([
            expect.objectContaining({ kind: "binding", id: "reviewer" }),
          ]),
        },
      },
    },
  });
  expect(byId.get(5)).toMatchObject({
    result: {
      structuredContent: {
        tool: "validate",
        status: "ok",
        data: { valid: true, config_path: "atlante.jsonc", project_root: "." },
      },
    },
  });
  expect(byId.get(6)).toMatchObject({
    result: {
      structuredContent: {
        tool: "search_docs",
        status: "ok",
        data: {
          query: "api-review",
          matches: expect.arrayContaining([
            expect.objectContaining({
              document_id: "guides/building-a-harness",
            }),
          ]),
        },
      },
    },
  });
  expect(byId.get(7)).toMatchObject({
    result: {
      structuredContent: {
        tool: "read_doc",
        status: "ok",
        data: {
          document_id: "guides/building-a-harness",
          section_id: "add-reusable-review-guidance",
          content: expect.stringContaining("api-review"),
        },
      },
    },
  });
  expect(byId.get(8)).toMatchObject({
    result: {
      structuredContent: {
        tool: "get_schema",
        status: "ok",
        data: {
          uri: SCHEMA_URI,
          schema: expect.objectContaining({
            $id: SCHEMA_URI,
            title: "Atlante configuration document",
          }),
        },
      },
    },
  });
  expect(byId.get(9)).toMatchObject({
    result: {
      isError: true,
      structuredContent: {
        tool: "get_schema",
        status: "diagnostic",
        diagnostics: [{ code: "schema-not-supported" }],
      },
    },
  });
  expect(stdout).not.toContain(directory);
  expect(stdout).not.toContain("/outside/atlante-mcp-absolute-sentinel");
  expect(stdout).not.toContain("/outside/atlante-mcp-nested-sentinel");
  expect(stdout).not.toContain("/active-file-sentinel");
  expect(stdout).not.toContain("/nested-file-sentinel");
  expect(stderr).toBe("");
  expect(readdirSync(directory, { recursive: true }).sort()).toEqual(
    beforeEntries,
  );
  expect(readFileSync(join(directory, "atlante.jsonc"), "utf8")).toBe(
    beforeConfig,
  );
  expect(existsSync(join(directory, ".atlante"))).toBe(false);
  expect(existsSync(join(directory, ".opencode"))).toBe(false);
});

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import { createMcpOperations } from "../src/mcp/project.js";

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixtureWithNativeManifest(): string {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "atlante-mcp-native-")),
  );
  created.push(directory);
  writeFileSync(
    join(directory, "atlante.jsonc"),
    `${JSON.stringify(
      {
        $schema: SCHEMA_URI,
        values: { project: "native-fixture" },
      },
      null,
      2,
    )}\n`,
  );
  const content = "# fixture agent\n";
  mkdirSync(join(directory, ".opencode", "agents"), { recursive: true });
  writeFileSync(join(directory, ".opencode", "agents", "reviewer.md"), content);
  mkdirSync(join(directory, ".atlante"), { recursive: true });
  writeFileSync(
    join(directory, ".atlante", "opencode-native.json"),
    `${JSON.stringify(
      {
        format: "atlante-opencode-native",
        version: 1,
        files: [
          {
            kind: "agent",
            id: "reviewer",
            path: ".opencode/agents/reviewer.md",
            sha256: createHash("sha256").update(content).digest("hex"),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return directory;
}

describe("inspect_project artifact-files section", () => {
  test("omits generated file hashes by default and includes them on request", () => {
    const operations = createMcpOperations(fixtureWithNativeManifest());

    const def = operations.inspectProject({});
    if (def.status !== "ok" || !def.data)
      throw new Error(`expected an ok response: ${JSON.stringify(def)}`);
    expect(def.data.artifacts.status).toBe("fresh");
    expect(def.data.artifacts.file_count).toBe(1);
    expect(def.data.artifacts).not.toHaveProperty("files");

    const included = operations.inspectProject({
      include: ["artifact-files"],
    });
    if (included.status !== "ok" || !included.data)
      throw new Error(`expected an ok response: ${JSON.stringify(included)}`);
    expect(included.data.artifacts).toMatchObject({
      status: "fresh",
      files: [
        {
          kind: "agent",
          id: "reviewer",
          path: ".opencode/agents/reviewer.md",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      ],
    });
  });
});

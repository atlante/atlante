import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import {
  type ClaudeMcpFileSystem,
  prepareClaudeMcp,
} from "../src/commands/claude-mcp.js";

function memoryFileSystem(
  files: Record<string, string> = {},
): ClaudeMcpFileSystem & { written: Record<string, string> } {
  const store = new Map(Object.entries(files));
  const written: Record<string, string> = {};
  return {
    existsSync: (path) => store.has(path),
    readFileSync: (path) => {
      const contents = store.get(path);
      if (contents === undefined) throw new Error(`missing file: ${path}`);
      return contents;
    },
    written,
  };
}

const managedArgs = ["--yes", `atlante@${packageJson.version}`, "mcp"];

describe("prepareClaudeMcp", () => {
  test("creates .mcp.json with the managed server when missing", () => {
    const fileSystem = memoryFileSystem();

    const plan = prepareClaudeMcp("/project", fileSystem);

    if (!("path" in plan)) throw new Error(`unexpected error: ${plan.error}`);
    expect(plan.path).toBe(join("/project", ".mcp.json"));
    expect(plan.write).toBe(true);
    expect(plan.registered).toBe(true);
    expect(JSON.parse(plan.contents)).toEqual({
      mcpServers: { atlante: { command: "npx", args: managedArgs } },
    });
  });

  test("preserves existing servers while registering atlante", () => {
    const fileSystem = memoryFileSystem({
      [join("/project", ".mcp.json")]: `${JSON.stringify({
        mcpServers: { other: { command: "other-server" } },
      })}\n`,
    });

    const plan = prepareClaudeMcp("/project", fileSystem);

    if (!("path" in plan)) throw new Error(`unexpected error: ${plan.error}`);
    expect(plan.write).toBe(true);
    expect(plan.registered).toBe(true);
    const parsed = JSON.parse(plan.contents) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers.other).toEqual({ command: "other-server" });
    expect(parsed.mcpServers.atlante).toEqual({
      command: "npx",
      args: managedArgs,
    });
  });

  test("is idempotent when atlante is already registered", () => {
    const contents = `${JSON.stringify({
      mcpServers: { atlante: { command: "npx", args: managedArgs } },
    })}\n`;
    const fileSystem = memoryFileSystem({
      [join("/project", ".mcp.json")]: contents,
    });

    const plan = prepareClaudeMcp("/project", fileSystem);

    if (!("path" in plan)) throw new Error(`unexpected error: ${plan.error}`);
    expect(plan.write).toBe(false);
    expect(plan.registered).toBe(false);
    expect(plan.contents).toBe(contents);
  });

  test("rejects malformed JSON with an error", () => {
    const fileSystem = memoryFileSystem({
      [join("/project", ".mcp.json")]: "{ not json",
    });

    const plan = prepareClaudeMcp("/project", fileSystem);

    expect("error" in plan).toBe(true);
  });

  test("rejects a non-object document or mcpServers field", () => {
    for (const contents of [
      "[]\n",
      `${JSON.stringify({ mcpServers: [] })}\n`,
      `${JSON.stringify({ mcpServers: { atlante: "npx" } })}\n`,
    ]) {
      const fileSystem = memoryFileSystem({
        [join("/project", ".mcp.json")]: contents,
      });
      expect(prepareClaudeMcp("/project", fileSystem)).toMatchObject({
        error: expect.any(String),
      });
    }
  });

  test("rejects a conflicting atlante entry with an error", () => {
    const fileSystem = memoryFileSystem({
      [join("/project", ".mcp.json")]: `${JSON.stringify({
        mcpServers: { atlante: { command: "other Atlante fork" } },
      })}\n`,
    });

    const plan = prepareClaudeMcp("/project", fileSystem);

    expect(plan).toMatchObject({ error: expect.stringContaining("atlante") });
  });
});

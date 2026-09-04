import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_URI } from "@atlante/schema";
import { loadDocument } from "../src/index.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

type LoadedFirstPartyDocument = ReturnType<typeof loadDocument> & {
  resources?: {
    effectiveRaw: Record<string, unknown>;
    bindings: {
      agents: Record<
        string,
        { description: string; template: { locator: string } }
      >;
      skills: Record<
        string,
        { description: string; template: { locator: string } }
      >;
    };
  };
};

function firstPartyProject(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-validator-first-party-"));
  created.push(root);
  writeFileSync(
    join(root, "atlante.jsonc"),
    `${JSON.stringify(
      { $schema: SCHEMA_URI, extends: "@atlante/pack" },
      null,
      2,
    )}\n`,
  );
  cpSync(firstPartyPackRoot, join(root, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-validator-first-party-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:*" },
    })}\n`,
  );
  return join(root, "atlante.jsonc");
}

function loadFirstPartyProject(): LoadedFirstPartyDocument {
  return loadDocument(firstPartyProject()) as LoadedFirstPartyDocument;
}

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("first-party pack integration", () => {
  test("resolves exactly one architect agent binding, the four phase skills, and the harness skill", () => {
    const result = loadFirstPartyProject();

    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.document?.agents ?? {}).sort()).toEqual([
      "architect",
    ]);
    expect(Object.keys(result.document?.skills ?? {}).sort()).toEqual([
      "brainstorm",
      "build",
      "harness",
      "plan",
      "review",
    ]);
  });

  test("resolves the architect binding through the generic agent template with a non-empty description", () => {
    const result = loadFirstPartyProject();
    const architect = result.resources?.bindings.agents.architect;

    expect(String(architect?.template.locator)).toBe("@atlante/pack/agent");
    expect(architect?.description).toBeTruthy();
  });

  test.each(["brainstorm", "plan", "build", "review", "harness"] as const)(
    "resolves %s through the generic skill template with a non-empty instance-owned description",
    (id) => {
      const result = loadFirstPartyProject();
      const binding = result.resources?.bindings.skills?.[id];

      expect(result.resources?.effectiveRaw.skills?.[id]).toEqual({
        $instance: `@atlante/pack/${id}`,
      });
      expect(String(binding?.template.locator)).toBe("@atlante/pack/skill");
      expect(binding?.description).toBeTruthy();
    },
  );
});

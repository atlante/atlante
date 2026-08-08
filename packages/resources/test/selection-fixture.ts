import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectResourcePack,
  type JsonObject,
  type JsonValue,
  resolveResourceInstance,
} from "../src/index.js";

const schemaUri = "https://json-schema.org/draft/2020-12/schema";

function writeTemplate(
  root: string,
  name: string,
  schema: Record<string, unknown>,
): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "template.jsonc"),
    `${JSON.stringify({ $schema: schemaUri, ...schema })}\n`,
  );
  writeFileSync(join(directory, "template.md"), "{{value}}\n");
}

function writeInstance(
  root: string,
  name: string,
  input: Record<string, unknown>,
): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "instance.jsonc"),
    `${JSON.stringify(input)}\n`,
  );
}

export function resolvedSelectionFixture(
  composition: "oneOf" | "anyOf" | "allOf" = "oneOf",
  selectedBranch: "first" | "second" = "second",
): { payload: JsonObject; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "atlante-selection-"));
  const config = join(root, "atlante.jsonc");
  writeFileSync(config, "{}\n");

  writeTemplate(root, "leaf-first", {
    type: "object",
    properties: { value: { type: "string" } },
  });
  writeTemplate(root, "leaf-second", {
    type: "object",
    properties: { value: { type: "string" } },
  });
  writeInstance(root, "leaf-first", {
    $template: "../leaf-first",
    value: "selected",
  });
  writeInstance(root, "leaf-second", {
    $template: "../leaf-second",
    value: "selected",
  });
  writeTemplate(root, "branch-first", {
    type: "object",
    properties: {
      nested: {
        [composition]: [
          {
            type: "object",
            properties: { value: { template: "../leaf-first" } },
          },
          {
            type: "object",
            properties: { value: { template: "../leaf-second" } },
          },
        ],
      },
    },
  });
  writeTemplate(root, "branch-second", {
    type: "object",
    properties: {
      nested: {
        [composition]: [
          {
            type: "object",
            properties: { value: { template: "../leaf-first" } },
          },
          {
            type: "object",
            properties: { value: { template: "../leaf-second" } },
          },
        ],
      },
    },
  });
  writeTemplate(root, "parent", {
    type: "object",
    properties: {
      choice: {
        [composition]: [
          {
            type: "object",
            properties: { payload: { template: "../branch-first" } },
          },
          {
            type: "object",
            properties: { payload: { template: "../branch-second" } },
          },
        ],
      },
    },
  });

  writeInstance(root, "selected", {
    $template: `../branch-${selectedBranch}`,
    nested: {
      value: { $instance: `../leaf-${selectedBranch}` },
    },
  });
  writeInstance(root, "source", {
    $template: "../parent",
    choice: { payload: { $instance: "../selected" } },
  });

  try {
    const input = resolveResourceInstance({
      pack: createProjectResourcePack(root),
      locator: "./source",
      authoringFile: config,
    }).input;
    const choice = input.choice;
    if (typeof choice !== "object" || choice === null || Array.isArray(choice))
      throw new Error("selection fixture choice missing");
    const payload = (choice as { readonly payload?: JsonValue }).payload;
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    )
      throw new Error("selection fixture payload missing");
    return {
      payload: payload as JsonObject,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

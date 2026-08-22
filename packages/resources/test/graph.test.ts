import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  JsonObject,
  ResourceFailureCode,
  ResourceResolutionError,
} from "../src/index.js";
import {
  createProjectResourcePack,
  resolveResourceDocument,
  resolveResourceInstance,
} from "../src/index.js";

const created: string[] = [];
const schemaUri = "https://json-schema.org/draft/2020-12/schema";

function rootOf(): { root: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), "atlante-graph-"));
  created.push(root);
  const source = join(root, "source.jsonc");
  writeFileSync(source, "{}\n");
  return { root, source };
}

function facet(
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

function template(
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
  writeFileSync(join(directory, "template.md"), "template\n");
}

function preset(
  root: string,
  name: string,
  input: Record<string, unknown>,
): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "atlante.jsonc"), `${JSON.stringify(input)}\n`);
}

function expectFailure(
  action: () => unknown,
  code: ResourceFailureCode,
): ResourceResolutionError {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && "failure" in error) {
      const failure = (error as ResourceResolutionError).failure;
      expect(failure.code).toBe(code);
      return error as ResourceResolutionError;
    }
  }
  throw new Error(`expected ${code} failure`);
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("resource graph", () => {
  test("reports typed mixed reference cycles and complete chains", () => {
    const { root, source } = rootOf();
    template(root, "template", {
      type: "object",
      properties: { child: { template: "../template" } },
    });
    facet(root, "instance", {
      $template: "../template",
      child: "../instance",
    });

    const failure = expectFailure(
      () =>
        resolveResourceInstance({
          pack: createProjectResourcePack(root),
          locator: "./instance",
          authoringFile: source,
        }),
      "resource-cycle",
    );

    const cycleChain = failure.failure.chain;
    if (!cycleChain) throw new Error("cycle chain missing");
    expect(cycleChain.map(({ kind }) => kind)).toEqual([
      "instance",
      "template",
      "template",
    ]);
    expect(cycleChain.map(({ origin }) => origin.path as string)).toEqual([
      "instance/instance.jsonc",
      "template/template.jsonc",
      "template/template.jsonc",
    ]);
  });

  test("allows exactly 32 reference hops and rejects the 33rd", () => {
    const { root, source } = rootOf();
    template(root, "template", { type: "object" });
    for (const count of [32, 33]) {
      for (let index = 0; index < count; index++) {
        facet(
          root,
          `instance-${count}-${index}`,
          index === count - 1
            ? { $template: "../template" }
            : { $instance: `../instance-${count}-${index + 1}` },
        );
      }

      const action = () =>
        resolveResourceInstance({
          pack: createProjectResourcePack(root),
          locator: `./instance-${count}-0`,
          authoringFile: source,
        });
      if (count === 32) {
        expect(action).not.toThrow();
      } else {
        const failure = expectFailure(action, "resource-depth-exceeded");
        const depthChain = failure.failure.chain;
        if (!depthChain) throw new Error("depth chain missing");
        expect(depthChain.length).toBe(34);
      }
    }
  });

  test("keeps graph failures deterministic and isolated across repeated calls", () => {
    const { root, source } = rootOf();
    template(root, "template", { type: "object" });
    facet(root, "a", { $instance: "../b" });
    facet(root, "b", { $instance: "../a" });
    const action = () =>
      resolveResourceInstance({
        pack: createProjectResourcePack(root),
        locator: "./a",
        authoringFile: source,
      });

    const first = expectFailure(action, "resource-cycle");
    const second = expectFailure(action, "resource-cycle");
    expect(JSON.stringify(first.failure)).toBe(JSON.stringify(second.failure));
    expect(first.failure).not.toBe(second.failure);
    expect(first.failure.chain).not.toBe(second.failure.chain);
  });

  test("keeps preset cycle chains typed across local and package resources", () => {
    const { root, source } = rootOf();
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({
        name: "atlante-graph-fixture",
        version: "1.0.0",
        dependencies: { "acme-pack": "1.0.0" },
      })}\n`,
    );
    const packageRoot = join(root, "node_modules", "acme-pack");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "acme-pack",
        version: "1.0.0",
        atlante: { format: 1 },
      })}\n`,
    );
    preset(root, "local", { extends: "acme-pack" });
    preset(packageRoot, ".", { extends: "./bridge" });
    preset(packageRoot, "bridge", { extends: "acme-pack" });

    const failure = expectFailure(
      () =>
        resolveResourceDocument({
          pack: createProjectResourcePack(root),
          rootFile: realpathSync(source),
          rootDocument: { extends: "./local" } as JsonObject,
        }),
      "resource-cycle",
    );

    const chain = failure.failure.chain;
    if (!chain) throw new Error("cycle chain missing");
    expect(chain.map(({ kind }) => kind)).toEqual([
      "preset",
      "preset",
      "preset",
      "preset",
      "preset",
    ]);
    expect(chain.map(({ locator }) => String(locator))).toEqual([
      "./",
      "./local",
      "acme-pack",
      "./bridge",
      "acme-pack",
    ]);
    expect(
      chain.map(({ origin }) => `${origin.kind}:${String(origin.path)}`),
    ).toEqual([
      "project:source.jsonc",
      "project:local/atlante.jsonc",
      "package:acme-pack@1.0.0/atlante.jsonc",
      "package:acme-pack@1.0.0/bridge/atlante.jsonc",
      "package:acme-pack@1.0.0/atlante.jsonc",
    ]);
  });

  test("measures preset depth per independent extends branch", () => {
    const { root, source } = rootOf();
    const siblings: string[] = [];
    for (let index = 0; index < 40; index++) {
      const name = `sibling-${index}`;
      preset(root, name, {});
      siblings.push(`./${name}`);
    }

    const resolve = (extendsValue: readonly string[]) =>
      resolveResourceDocument({
        pack: createProjectResourcePack(root),
        rootFile: realpathSync(source),
        rootDocument: { extends: extendsValue } as JsonObject,
      });

    expect(() => resolve(siblings)).not.toThrow();

    const deep: string[] = [];
    for (let index = 0; index < 33; index++) {
      const name = `deep-${index}`;
      preset(root, name, {
        ...(index === 32 ? {} : { extends: `../deep-${index + 1}` }),
      });
      deep.push(`./${name}`);
    }

    const failure = expectFailure(
      () => resolve([...siblings, deep[0] as string]),
      "resource-depth-exceeded",
    );
    expect(failure.failure.chain?.length).toBe(34);
    expect(String(failure.failure.chain?.[1]?.origin.path)).toBe(
      "deep-0/atlante.jsonc",
    );
  });
});

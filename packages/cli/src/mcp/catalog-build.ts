import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateDocumentationCatalog } from "./catalog.js";

type Arguments = Readonly<{ root: string; output: string }>;

function argumentValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function argumentsOf(argv: readonly string[]): Arguments {
  const root = argumentValue(argv, "--root");
  const output = argumentValue(argv, "--output");
  if (!root || !output)
    throw new Error("catalog build requires --root and --output");
  return { root: resolve(root), output: resolve(output) };
}

if (import.meta.main) {
  try {
    const args = argumentsOf(process.argv.slice(2));
    const catalog = generateDocumentationCatalog(args.root);
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(catalog, null, 2)}\n`);
  } catch (cause) {
    console.error(
      `could not generate the documentation catalog: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    process.exitCode = 1;
  }
}

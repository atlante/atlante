#!/usr/bin/env bun
import { spawn } from "bun";

const names = process.argv.slice(2);

if (names.length === 0) {
  console.error("usage: bun scripts/parallel.ts <script> [script...]");
  process.exit(2);
}

const children = names.map((name) =>
  spawn(["bun", "run", name], { stdout: "inherit", stderr: "inherit" }),
);

const results = await Promise.all(
  children.map((child) => child.exited.then((code) => code ?? 1)),
);

const failed = names
  .map((name, index) => ({ name, code: results[index] }))
  .filter(({ code }) => code !== 0);

if (failed.length > 0) {
  for (const { name, code } of failed) {
    console.error(`parallel: "${name}" failed with exit code ${code}`);
  }
  process.exit(1);
}

console.log(`parallel: ${names.length}/${names.length} scripts passed`);

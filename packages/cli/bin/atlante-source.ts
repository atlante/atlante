#!/usr/bin/env bun
import { registerDashboard } from "../src/commands/dashboard.js";
import { createProgram } from "../src/main.js";

export function createSourceProgram() {
  const program = createProgram();
  registerDashboard(program);
  return program;
}

if (import.meta.main) {
  await createSourceProgram().parseAsync(process.argv);
}

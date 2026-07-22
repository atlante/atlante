#!/usr/bin/env bun
import { createProgram } from "../src/main.ts";

await createProgram().parseAsync(process.argv);

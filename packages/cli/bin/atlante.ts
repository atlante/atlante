#!/usr/bin/env node
import { createProgram } from "../src/main.js";

await createProgram().parseAsync(process.argv);

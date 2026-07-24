#!/usr/bin/env bun
const mainModule = await import(
  import.meta.url.includes("/dist/") ? "../main.js" : "../src/main.js"
);

await mainModule.createProgram().parseAsync(process.argv);

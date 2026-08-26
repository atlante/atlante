// api/_lib/playground.ts
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
var ALLOWED_INPUTS = /* @__PURE__ */ new Set(["atlante.jsonc", "opencode.jsonc"]);
var MAX_FILES = 2;
var MAX_FILE_BYTES = 32 * 1024;
var MAX_OUTPUT_BYTES = 64 * 1024;
var MAX_TREE_FILES = 24;
var MAX_TREE_FILE_BYTES = 64 * 1024;
var STEP_TIMEOUT_MS = 2e4;
var require2 = createRequire(import.meta.url);
function cliEntry() {
  const manifest = require2.resolve("@atlante/cli/package.json");
  return join(dirname(manifest), "dist", "bin", "atlante.js");
}
function parsePlaygroundRequest(raw) {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("body must be a JSON object");
  }
  const body = raw;
  const step = body.step;
  if (step !== "init" && step !== "validate" && step !== "build") {
    throw new Error("step must be init, validate, or build");
  }
  const rawFiles = body.files ?? [];
  if (!Array.isArray(rawFiles) || rawFiles.length > MAX_FILES) {
    throw new Error(`files must be an array of at most ${MAX_FILES}`);
  }
  const files = [];
  for (const entry of rawFiles) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("invalid file entry");
    }
    const { path, content } = entry;
    if (typeof path !== "string" || !ALLOWED_INPUTS.has(path)) {
      throw new Error(`unsupported file: ${String(path)}`);
    }
    if (typeof content !== "string" || content.length === 0) {
      throw new Error(`empty file: ${path}`);
    }
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      throw new Error(`file too large: ${path}`);
    }
    files.push({ path, content });
  }
  return { step, files };
}
function execStep(dir, step) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry(), step, "."], {
      cwd: dir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    let size = 0;
    let timedOut = false;
    const collect = (chunk) => {
      const room = MAX_OUTPUT_BYTES - size;
      if (room <= 0) return;
      size += chunk.length;
      chunks.push(chunk.subarray(0, room));
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, STEP_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, output: String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        timedOut,
        output: Buffer.concat(chunks).toString("utf8")
      });
    });
  });
}
async function collectTree(root) {
  const files = [];
  async function walk(dir) {
    if (files.length >= MAX_TREE_FILES) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= MAX_TREE_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const buffer = await readFile(full);
      files.push({
        path: relative(root, full).split("\\").join("/"),
        content: buffer.subarray(0, MAX_TREE_FILE_BYTES).toString("utf8")
      });
    }
  }
  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
function sanitize(output, dirs) {
  const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dirPattern = new RegExp(dirs.map(escaped).join("|"), "g");
  return output.split(dirPattern).join(".").replaceAll("/./", "/").replace(/^\.\//, "./").trimEnd();
}
async function runPlaygroundStep(request) {
  const dir = await mkdtemp(join(tmpdir(), "atlante-playground-"));
  const dirs = [dir, await realpath(dir)];
  try {
    for (const file of request.files) {
      await writeFile(join(dir, file.path), file.content, "utf8");
    }
    const started = Date.now();
    const run = await execStep(dir, request.step);
    const files = run.exitCode === 0 ? await collectTree(dir) : [];
    return {
      ok: run.exitCode === 0,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      output: sanitize(run.output, dirs),
      files,
      durationMs: Date.now() - started
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// api/playground.ts
var MAX_BODY_BYTES = 256 * 1024;
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
function sameOrigin(request) {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return true;
  const forwarded = request.headers["x-forwarded-host"];
  const host = typeof forwarded === "string" ? forwarded : request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
async function handler(request, response) {
  const send = (status, payload) => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify(payload));
  };
  if (request.method !== "POST") {
    send(405, { error: "method not allowed" });
    return;
  }
  if (!sameOrigin(request)) {
    send(403, { error: "cross-origin requests are not allowed" });
    return;
  }
  let raw;
  try {
    raw = JSON.parse((await readBody(request)).toString("utf8"));
  } catch {
    send(400, { error: "invalid JSON body" });
    return;
  }
  let parsed;
  try {
    parsed = parsePlaygroundRequest(raw);
  } catch (error) {
    send(400, {
      error: error instanceof Error ? error.message : "invalid request"
    });
    return;
  }
  try {
    send(200, await runPlaygroundStep(parsed));
  } catch (error) {
    send(500, {
      error: error instanceof Error ? error.message : "playground failure"
    });
  }
}
export {
  handler as default
};

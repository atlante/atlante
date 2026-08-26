import { spawn } from "node:child_process";
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

export type PlaygroundStep = "init" | "validate" | "build";

export interface PlaygroundFile {
  path: string;
  content: string;
}

export interface PlaygroundRequest {
  step: PlaygroundStep;
  files: PlaygroundFile[];
  force: boolean;
}


export interface PlaygroundResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  files: PlaygroundFile[];
  durationMs: number;
}

const ALLOWED_INPUTS = new Set(["atlante.jsonc", "opencode.jsonc"]);
const MAX_FILES = 2;
const MAX_FILE_BYTES = 32 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_TREE_FILES = 24;
const MAX_TREE_FILE_BYTES = 64 * 1024;
const STEP_TIMEOUT_MS = 20_000;

const require = createRequire(import.meta.url);

/** The published CLI resolves @atlante/pack from its own installation, so
 * any working directory works as a project sandbox. */
function cliEntry(): string {
  const manifest: string = require.resolve("@atlante/cli/package.json");
  return join(dirname(manifest), "dist", "bin", "atlante.js");
}

export function parsePlaygroundRequest(raw: unknown): PlaygroundRequest {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  const step = body.step;
  if (step !== "init" && step !== "validate" && step !== "build") {
    throw new Error("step must be init, validate, or build");
  }
  const rawFiles = body.files ?? [];
  if (!Array.isArray(rawFiles) || rawFiles.length > MAX_FILES) {
    throw new Error(`files must be an array of at most ${MAX_FILES}`);
  }
  const files: PlaygroundFile[] = [];
  for (const entry of rawFiles) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("invalid file entry");
    }
    const { path, content } = entry as Record<string, unknown>;
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
  const force = body.force === true;
  if (force && step !== "init") {
    throw new Error("force is only supported for init");
  }
  return { step, files, force };
}


interface ExecResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

function execStep(
  dir: string,
  step: PlaygroundStep,
  force: boolean,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const args =
      step === "init"
        ? ["init", ".", ...(force ? ["--force"] : [])]
        : [step, "."];
    const child = spawn(process.execPath, [cliEntry(), ...args], {

      cwd: dir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const collect = (chunk: Buffer): void => {
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
        output: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });
}

async function collectTree(root: string): Promise<PlaygroundFile[]> {
  const files: PlaygroundFile[] = [];
  async function walk(dir: string): Promise<void> {
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
        content: buffer.subarray(0, MAX_TREE_FILE_BYTES).toString("utf8"),
      });
    }
  }
  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function sanitize(output: string, dirs: string[]): string {
  const escaped = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dirPattern = new RegExp(dirs.map(escaped).join("|"), "g");

  return output
    .split(dirPattern)
    .join(".")
    .replaceAll("/./", "/")
    .replace(/^\.\//, "./")
    .trimEnd();
}

export async function runPlaygroundStep(
  request: PlaygroundRequest,
): Promise<PlaygroundResult> {
  const dir = await mkdtemp(join(tmpdir(), "atlante-playground-"));
  const dirs = [dir, await realpath(dir)];
  try {
    for (const file of request.files) {
      await writeFile(join(dir, file.path), file.content, "utf8");
    }
    const started = Date.now();
    const run = await execStep(dir, request.step, request.force);

    const files = run.exitCode === 0 ? await collectTree(dir) : [];
    return {
      ok: run.exitCode === 0,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      output: sanitize(run.output, dirs),

      files,
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

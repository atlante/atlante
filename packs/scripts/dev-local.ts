import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRegistryManifest,
  type RegistryManifest,
} from "../src/data/registry";
import { type LocalPackSource, syncPacks } from "./sync-packs";

const PACKS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SNAPSHOT_PATH = join(PACKS_ROOT, "src/data/registry-snapshot.json");

type LocalPackageJson = Record<string, unknown> & {
  name: string;
  version: string;
};

function packageRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readLocalPackPackage(packageRoot: string): LocalPackageJson {
  const absoluteRoot = resolve(packageRoot);
  try {
    if (!statSync(absoluteRoot).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new Error(`Local pack directory does not exist: ${absoluteRoot}`);
  }

  const packageJsonPath = join(absoluteRoot, "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Local pack package.json is unavailable: ${packageJsonPath}`,
      );
    }
    throw new Error(`Local pack package.json is invalid: ${packageJsonPath}`);
  }

  const packageJson = packageRecord(parsed);
  if (
    !packageJson ||
    typeof packageJson.name !== "string" ||
    packageJson.name.length === 0 ||
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error(
      `Local pack package.json must declare name and version: ${packageJsonPath}`,
    );
  }
  return packageJson as LocalPackageJson;
}

function streamText(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

type InterruptState = {
  signal?: NodeJS.Signals;
  child?: ChildProcess;
};

function signalExitCode(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : 143;
}

function packFilename(result: unknown): string | undefined {
  const entries = Array.isArray(result)
    ? result
    : Object.values(packageRecord(result) ?? {});
  const first = packageRecord(entries[0]);
  return typeof first?.filename === "string" ? first.filename : undefined;
}

type ChildProcessHandler = (child: ChildProcess | undefined) => void;

async function createPublicationTarball(
  packageRoot: string,
  onChild: ChildProcessHandler,
): Promise<Buffer> {
  const outputDir = mkdtempSync(join(tmpdir(), "atlante-local-pack-tarball-"));
  try {
    const npmPack = spawn(
      "npm",
      ["pack", "--json", "--pack-destination", outputDir, "."],
      { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    onChild(npmPack);
    const [stdout, stderr, exitCode] = await Promise.all([
      streamText(npmPack.stdout),
      streamText(npmPack.stderr),
      waitForExit(npmPack),
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `npm pack failed for ${packageRoot}: ${stderr.trim() || stdout.trim()}`,
      );
    }

    let result: unknown;
    try {
      result = JSON.parse(stdout) as unknown;
    } catch {
      throw new Error("npm pack returned invalid JSON");
    }
    const filename = packFilename(result);
    if (!filename) throw new Error("npm pack did not report a tarball path");

    const tarballPath = resolve(outputDir, filename);
    if (!existsSync(tarballPath)) {
      throw new Error(`npm pack did not create ${tarballPath}`);
    }
    return readFileSync(tarballPath);
  } finally {
    onChild(undefined);
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function localManifest(
  manifest: RegistryManifest,
  packageName: string,
): RegistryManifest {
  const entry = manifest.packs.find(
    (candidate) => candidate.package === packageName,
  );
  if (!entry) {
    throw new Error(
      `Local pack ${packageName} is not declared in packs/src/data/registry-manifest.json`,
    );
  }
  return { packs: [entry] };
}

export async function syncLocalPack(options: {
  websiteRoot?: string;
  packageRoot: string;
  now?: () => string;
  onChild?: ChildProcessHandler;
}): Promise<void> {
  const websiteRoot = options.websiteRoot ?? PACKS_ROOT;
  const packageRoot = resolve(options.packageRoot);
  const packageJson = readLocalPackPackage(packageRoot);
  const manifest = localManifest(
    loadRegistryManifest(websiteRoot),
    packageJson.name,
  );
  const tarball = await createPublicationTarball(
    packageRoot,
    options.onChild ?? (() => undefined),
  );
  const localSource: LocalPackSource = { packageJson, tarball };

  await syncPacks({
    websiteRoot,
    manifest,
    localPacks: new Map([[packageJson.name, localSource]]),
    now: options.now,
  });
}

export async function withTemporarySnapshot<T>(
  snapshotPath: string,
  callback: () => T | Promise<T>,
): Promise<T> {
  const hadSnapshot = existsSync(snapshotPath);
  const original = hadSnapshot ? readFileSync(snapshotPath) : undefined;
  try {
    return await callback();
  } finally {
    if (original === undefined) {
      rmSync(snapshotPath, { force: true });
    } else {
      writeFileSync(snapshotPath, original);
    }
  }
}

async function runLocalExplorer(
  args: string[],
  interruption: InterruptState,
): Promise<number> {
  const packageArgument = args.shift();
  if (!packageArgument) {
    throw new Error(
      "Usage: bun run --cwd packs dev:local -- <local-pack-directory> [astro dev options]",
    );
  }

  const brandSync = spawn(process.execPath, ["run", "sync:brand"], {
    cwd: PACKS_ROOT,
    stdio: "inherit",
  });
  interruption.child = brandSync;
  if ((await waitForExit(brandSync)) !== 0) {
    throw new Error("packs: local brand synchronization failed");
  }
  interruption.child = undefined;
  if (interruption.signal) return signalExitCode(interruption.signal);

  await syncLocalPack({
    packageRoot: resolve(process.cwd(), packageArgument),
    onChild: (child) => {
      interruption.child = child;
    },
  });
  if (interruption.signal) return signalExitCode(interruption.signal);
  const explorer = spawn(process.execPath, ["run", "astro", "dev", ...args], {
    cwd: PACKS_ROOT,
    stdio: "inherit",
  });
  interruption.child = explorer;
  const exitCode = await waitForExit(explorer);
  interruption.child = undefined;
  return interruption.signal ? signalExitCode(interruption.signal) : exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const interruption: InterruptState = {};
  const handleSignal = (signal: NodeJS.Signals): void => {
    interruption.signal ??= signal;
    interruption.child?.kill(signal);
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  try {
    const exitCode = await withTemporarySnapshot(SNAPSHOT_PATH, () =>
      runLocalExplorer(args, interruption),
    );
    process.exitCode = interruption.signal
      ? signalExitCode(interruption.signal)
      : exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = interruption.signal
      ? signalExitCode(interruption.signal)
      : 1;
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }
}

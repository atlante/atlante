import { describe, expect, it } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLocalPackPackage,
  syncLocalPack,
  withTemporarySnapshot,
} from "./dev-local";

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("readLocalPackPackage", () => {
  it("rejects a missing local package directory", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-local-pack-"));
    expect(() => readLocalPackPackage(join(root, "missing"))).toThrow(
      "Local pack directory does not exist",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a directory without a package manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-local-pack-"));
    expect(() => readLocalPackPackage(root)).toThrow(
      "Local pack package.json is unavailable",
    );
    rmSync(root, { recursive: true, force: true });
  });
});

describe("syncLocalPack", () => {
  it("packs the first-party package and ingests its published report locally", async () => {
    const websiteRoot = mkdtempSync(join(tmpdir(), "atlante-local-website-"));
    const packsRoot = join(import.meta.dirname, "..");
    mkdirSync(join(websiteRoot, "src", "data"), { recursive: true });
    writeFileSync(
      join(websiteRoot, "src", "data", "registry-manifest.json"),
      JSON.stringify({
        packs: [{ package: "@atlante/pack", official: true, tags: ["test"] }],
      }),
    );

    await syncLocalPack({
      websiteRoot,
      packageRoot: join(packsRoot, "../packages/pack"),
      now: () => "2026-09-12T00:00:00.000Z",
    });

    const snapshot = JSON.parse(
      readFileSync(
        join(websiteRoot, "src", "data", "registry-snapshot.json"),
        "utf8",
      ),
    ) as { packs: Array<{ name: string; evaluation?: { source: string } }> };
    expect(snapshot.packs[0]?.name).toBe("@atlante/pack");
    expect(snapshot.packs[0]?.evaluation?.source).toBe("self-reported");
    rmSync(websiteRoot, { recursive: true, force: true });
  });
});

describe("dev-local process cleanup", () => {
  it("interrupts npm pack instead of waiting for the package hook", async () => {
    const packsRoot = join(import.meta.dirname, "..");
    const packageRoot = mkdtempSync(join(tmpdir(), "atlante-slow-pack-"));
    const markerPath = join(packageRoot, "npm-pack-started");
    const snapshotPath = join(packsRoot, "src/data/registry-snapshot.json");
    const originalSnapshot = readFileSync(snapshotPath);
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@atlante/pack",
        version: "9.9.9",
        atlante: { format: 1 },
        scripts: {
          prepack:
            "node -e \"require('node:fs').writeFileSync('npm-pack-started', String(process.pid)); setTimeout(() => {}, 8000)\"",
        },
      }),
    );
    writeFileSync(join(packageRoot, "atlante.jsonc"), '{"agents":{}}\n');
    writeFileSync(join(packageRoot, "README.md"), "# Slow local pack\n");

    const localProcess = spawn(
      process.execPath,
      [join(packsRoot, "scripts/dev-local.ts"), packageRoot, "--help"],
      { cwd: packsRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    localProcess.stdout?.resume();
    localProcess.stderr?.resume();
    let processExited = false;
    const exited = waitForExit(localProcess).finally(() => {
      processExited = true;
    });

    try {
      await waitForFile(markerPath);
      const startedAt = Date.now();
      expect(localProcess.kill("SIGTERM")).toBe(true);
      expect(await exited).toBe(143);
      expect(Date.now() - startedAt).toBeLessThan(3000);
      expect(readFileSync(snapshotPath)).toEqual(originalSnapshot);
    } finally {
      if (!processExited) localProcess.kill("SIGKILL");
      await exited.catch(() => undefined);
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });
});

describe("withTemporarySnapshot", () => {
  it("restores the exact snapshot after the preview exits with an error", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-local-snapshot-"));
    const snapshotPath = join(root, "registry-snapshot.json");
    const original = '{"packs":["committed"]}\n';
    writeFileSync(snapshotPath, original);

    await expect(
      withTemporarySnapshot(snapshotPath, async () => {
        writeFileSync(snapshotPath, '{"packs":["local"]}\n');
        throw new Error("stop preview");
      }),
    ).rejects.toThrow("stop preview");

    expect(readFileSync(snapshotPath, "utf8")).toBe(original);
    rmSync(root, { recursive: true, force: true });
  });

  it("removes a snapshot created only for the preview", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-local-snapshot-"));
    const snapshotPath = join(root, "registry-snapshot.json");

    await withTemporarySnapshot(snapshotPath, async () => {
      writeFileSync(snapshotPath, '{"packs":["local"]}\n');
    });

    expect(existsSync(snapshotPath)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

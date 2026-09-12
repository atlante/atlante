import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  loadRegistryManifest,
  loadRegistrySnapshot,
  type RegistryManifest,
  type RegistrySnapshot,
} from "../src/data/registry";
import { syncPacks } from "./sync-packs";

const PACKAGE = "@acme/test-pack";
const REPOSITORY_URL = "git+https://github.com/acme/test-pack.git";

const PACK_JSONC = `{
  // the default preset binds one agent and two skills
  "agents": {
    "architect": { "$instance": "@acme/test-pack/architect" },
  },
  "skills": {
    "build": { "$instance": "@acme/test-pack/build" },
    "review": { "$instance": "@acme/test-pack/review" },
  }
}`;

const VALID_EVAL_REPORT = {
  runId: "2026-09-11T10-00-00-a3b1",
  meta: {
    atlante: "0.3.1",
    host: "opencode",
    model: "test/model",
    modelVersion: "model-x",
  },
  scenarios: {
    "scope-discipline": { passRate: 1 },
    "policy-invariant": { passRate: 0.5 },
  },
};

function packWithEvaluation(reportPath = "eval/report.json"): string {
  return PACK_JSONC.replace(
    "\n}",
    `,
  "eval": {
    "scenarios": "eval/scenarios/*.eval.json",
    "report": "${reportPath}"
  }
}`,
  );
}

const REVIEW_JSONC = `{
  "$template": "@acme/test-pack/skill",
  "skills": { "strict": { "$instance": "strict" } }
}`;

const README = `# @acme/test-pack

Test pack README.

<script>alert("nope")</script>

[Acme](https://acme.example)`;
const TEMPLATES = {
  "skill/template.jsonc": '{\n  "type": "object"\n}',
  "skill/template.md": "# {{mission}}",
};

const MANIFEST: RegistryManifest = {
  packs: [{ package: PACKAGE, official: false, tags: ["test"] }],
};

const FIXED_NOW = "2026-09-11T12:00:00.000Z";

function registryDoc(overrides: Record<string, unknown> = {}): unknown {
  return {
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        name: PACKAGE,
        version: "1.0.0",
        description: "A test pack",
        license: "MIT",
        maintainers: [{ name: "acme-maintainer" }],
        repository: { url: REPOSITORY_URL },
        atlante: { format: 1 },
        dist: { tarball: "https://registry.test/@acme/test-pack/-/tarball" },
      },
    },
    time: {
      "1.0.0": "2026-09-01T00:00:00.000Z",
      modified: "2026-09-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

async function fixtureTarball(
  options: { packConfig?: string; report?: unknown } = {},
): Promise<Buffer> {
  const source = mkdtempSync(join(tmpdir(), "atlante-packs-src-"));
  const packageDir = join(source, "package");
  const writeFile = (relative: string, content: string): void => {
    const path = join(packageDir, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  };
  writeFile(
    "package.json",
    JSON.stringify({
      name: PACKAGE,
      version: "1.0.0",
      atlante: { format: 1 },
    }),
  );
  writeFile("atlante.jsonc", options.packConfig ?? PACK_JSONC);
  if (options.report !== undefined)
    writeFile("eval/report.json", JSON.stringify(options.report));
  writeFile("review/atlante.jsonc", REVIEW_JSONC);
  writeFile("README.md", README);
  for (const [path, content] of Object.entries(TEMPLATES)) {
    writeFile(path, content);
  }
  const tarballPath = join(source, "pack.tgz");
  await tar.c(
    {
      gzip: true,
      file: tarballPath,
      cwd: source,
      portable: true,
    },
    ["package"],
  );
  const tarball = readFileSync(tarballPath);
  rmSync(source, { recursive: true, force: true });
  return tarball;
}

function fakeFetch(
  tarball: Buffer,
  overrides: {
    registry?: unknown;
    downloadsStatus?: number;
    githubStatus?: number;
  } = {},
): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://registry.npmjs.org/")) {
      return Promise.resolve(
        new Response(JSON.stringify(overrides.registry ?? registryDoc()), {
          status: 200,
        }),
      );
    }
    if (url.startsWith("https://api.npmjs.org/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ downloads: 4200 }), {
          status: overrides.downloadsStatus ?? 200,
        }),
      );
    }
    if (url.startsWith("https://api.github.com/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            stargazers_count: 210,
            pushed_at: "2026-09-08T00:00:00.000Z",
          }),
          { status: overrides.githubStatus ?? 200 },
        ),
      );
    }
    if (url.endsWith("/tarball")) {
      return Promise.resolve(
        new Response(new Uint8Array(tarball), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }) as typeof fetch;
}

function tempWebsiteRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-packs-website-"));
  mkdirSync(join(root, "src", "data"), { recursive: true });
  return root;
}

describe("syncPacks", () => {
  it("synchronizes a pack from npm, GitHub, and its tarball", async () => {
    const websiteRoot = tempWebsiteRoot();
    const tarball = await fixtureTarball();
    const result = await syncPacks({
      websiteRoot,
      manifest: MANIFEST,
      fetch: fakeFetch(tarball),
      now: () => FIXED_NOW,
    });

    expect(result.packs).toBe(1);
    expect(result.reusedPacks).toBe(0);

    const snapshot = loadRegistrySnapshot(websiteRoot);
    expect(snapshot.syncedAt).toBe(FIXED_NOW);
    const pack = snapshot.packs[0];
    expect(pack.name).toBe(PACKAGE);
    expect(pack.official).toBe(false);
    expect(pack.version).toBe("1.0.0");
    expect(pack.license).toBe("MIT");
    expect(pack.maintainers).toEqual(["acme-maintainer"]);
    expect(pack.repository).toEqual({
      url: REPOSITORY_URL,
      slug: "acme/test-pack",
    });
    expect(pack.metrics).toEqual({
      downloads: 4200,
      stars: 210,
      publishedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    });

    expect(pack.presets).toEqual([
      {
        name: "default",
        locator: PACKAGE,
        default: true,
        bindings: { agents: 1, skills: 2 },
      },
      {
        name: "review",
        locator: `${PACKAGE}/review`,
        default: false,
        bindings: { agents: 0, skills: 1 },
      },
    ]);

    expect(pack.readmeHtml).not.toContain("<script>");
    expect(pack.readmeHtml).toContain("<h1>");
    expect(pack.readmeHtml).toContain('href="https://acme.example"');

    const paths = pack.files.map((file) => file.path);
    expect(paths[0]).toBe("atlante.jsonc");
    expect(paths).toContain("review/atlante.jsonc");
    expect(paths).toContain("skill/template.jsonc");
    expect(paths).toContain("README.md");
    expect(paths.every((path) => path !== "package.json")).toBe(true);
    expect(pack.evaluation).toBeUndefined();

    rmSync(websiteRoot, { recursive: true, force: true });
  });

  it("ingests a valid self-reported eval report with provenance", async () => {
    const websiteRoot = tempWebsiteRoot();
    const tarball = await fixtureTarball({
      packConfig: packWithEvaluation(),
      report: VALID_EVAL_REPORT,
    });
    const result = await syncPacks({
      websiteRoot,
      manifest: MANIFEST,
      fetch: fakeFetch(tarball),
      now: () => FIXED_NOW,
    });

    expect(result.snapshot.packs[0]?.evaluation).toEqual({
      source: "self-reported",
      reportPath: "eval/report.json",
      runId: "2026-09-11T10-00-00-a3b1",
      runDate: "2026-09-11T10:00:00.000Z",
      atlante: "0.3.1",
      host: "opencode",
      model: "test/model",
      modelVersion: "model-x",
      scenarios: {
        "scope-discipline": { passRate: 1 },
        "policy-invariant": { passRate: 0.5 },
      },
    });

    rmSync(websiteRoot, { recursive: true, force: true });
  });

  it("omits optional evaluation when the declared report is missing", async () => {
    const websiteRoot = tempWebsiteRoot();
    const tarball = await fixtureTarball({
      packConfig: packWithEvaluation(),
    });
    const result = await syncPacks({
      websiteRoot,
      manifest: MANIFEST,
      fetch: fakeFetch(tarball),
      now: () => FIXED_NOW,
    });

    expect(result.snapshot.packs[0]?.evaluation).toBeUndefined();
    rmSync(websiteRoot, { recursive: true, force: true });
  });

  it("fails closed for malformed or unsafe reports without rejecting the pack", async () => {
    for (const [packConfig, report] of [
      [
        packWithEvaluation(),
        { ...VALID_EVAL_REPORT, scenarios: { broken: { passRate: 2 } } },
      ],
      [packWithEvaluation(), { ...VALID_EVAL_REPORT, meta: undefined }],
      [packWithEvaluation("../report.json"), VALID_EVAL_REPORT],
      [packWithEvaluation("eval\\report.json"), VALID_EVAL_REPORT],
      [packWithEvaluation("C:/report.json"), VALID_EVAL_REPORT],
      [
        packWithEvaluation(),
        { ...VALID_EVAL_REPORT, runId: "2026-02-31T10-00-00-a3b1" },
      ],
    ] as const) {
      const websiteRoot = tempWebsiteRoot();
      const tarball = await fixtureTarball({ packConfig, report });
      const result = await syncPacks({
        websiteRoot,
        manifest: MANIFEST,
        fetch: fakeFetch(tarball),
        now: () => FIXED_NOW,
      });

      expect(result.snapshot.packs[0]?.evaluation).toBeUndefined();
      rmSync(websiteRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the previous snapshot when live data fails verification", async () => {
    const websiteRoot = tempWebsiteRoot();
    const previous: RegistrySnapshot = {
      syncedAt: "2026-09-10T00:00:00.000Z",
      packs: [
        {
          name: PACKAGE,
          official: false,
          tags: ["test"],
          description: "previous",
          version: "0.9.0",
          license: null,
          maintainers: [],
          repository: null,
          npmUrl: `https://www.npmjs.com/package/${PACKAGE}`,
          metrics: {
            downloads: null,
            stars: null,
            publishedAt: null,
            updatedAt: null,
          },
          presets: [],
          readmeHtml: "",
          files: [],
        },
      ],
    };
    writeFileSync(
      join(websiteRoot, "src", "data", "registry-snapshot.json"),
      JSON.stringify(previous),
    );

    const tarball = await fixtureTarball();
    const badRegistry = registryDoc();
    (
      badRegistry as { versions: Record<string, Record<string, unknown>> }
    ).versions["1.0.0"].atlante = { format: 2 };

    const result = await syncPacks({
      websiteRoot,
      manifest: MANIFEST,
      fetch: fakeFetch(tarball, { registry: badRegistry }),
      now: () => FIXED_NOW,
    });

    expect(result.reusedPacks).toBe(1);
    const snapshot = loadRegistrySnapshot(websiteRoot);
    expect(snapshot.syncedAt).toBe(previous.syncedAt);
    expect(snapshot.packs[0].description).toBe("previous");

    rmSync(websiteRoot, { recursive: true, force: true });
  });

  it("fails when live synchronization fails with no previous snapshot", async () => {
    const websiteRoot = tempWebsiteRoot();
    const tarball = await fixtureTarball();
    const badRegistry = registryDoc();
    (
      badRegistry as { versions: Record<string, Record<string, unknown>> }
    ).versions["1.0.0"].atlante = { format: 2 };

    expect(
      syncPacks({
        websiteRoot,
        manifest: MANIFEST,
        fetch: fakeFetch(tarball, { registry: badRegistry }),
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow("no previous snapshot is available");

    rmSync(websiteRoot, { recursive: true, force: true });
  });

  it("keeps metric enrichment optional when npm downloads or GitHub fail", async () => {
    const websiteRoot = tempWebsiteRoot();
    const tarball = await fixtureTarball();
    const result = await syncPacks({
      websiteRoot,
      manifest: MANIFEST,
      fetch: fakeFetch(tarball, { downloadsStatus: 503, githubStatus: 404 }),
      now: () => FIXED_NOW,
    });

    expect(result.snapshot.packs[0].metrics).toEqual({
      downloads: null,
      stars: null,
      publishedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: null,
    });

    rmSync(websiteRoot, { recursive: true, force: true });
  });
});

describe("registry data access", () => {
  it("loads the authored manifest from the workspace", () => {
    const packsRoot = join(import.meta.dirname, "..");
    const manifest = loadRegistryManifest(packsRoot);
    expect(manifest.packs[0].package).toBe("@atlante/pack");
  });

  it("rejects a manifest without pack entries", () => {
    const root = tempWebsiteRoot();
    writeFileSync(
      join(root, "src", "data", "registry-manifest.json"),
      JSON.stringify({ packs: [] }),
    );
    expect(() => loadRegistryManifest(root)).toThrow(
      "Registry manifest declares no packs",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects an unreadable snapshot", () => {
    const root = tempWebsiteRoot();
    expect(() => loadRegistrySnapshot(root)).toThrow(
      "Registry snapshot is unavailable",
    );
    rmSync(root, { recursive: true, force: true });
  });
});

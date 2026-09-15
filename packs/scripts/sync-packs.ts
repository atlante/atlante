import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import * as tar from "tar";
import {
  loadRegistryManifest,
  loadRegistrySnapshot,
  type RegistryFile,
  type RegistryManifest,
  type RegistryPack,
  type RegistrySnapshot,
} from "../src/data/registry";

type SyncPacksOptions = {
  websiteRoot?: string;
  manifest?: RegistryManifest;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => string;
  localPacks?: ReadonlyMap<string, LocalPackSource>;
};

export type LocalPackSource = {
  packageJson: Record<string, unknown>;
  tarball: Buffer;
};

type SyncPacksResult = {
  snapshotPath: string;
  packs: number;
  reusedPacks: number;
  snapshot: RegistrySnapshot;
};

const MAX_PREVIEW_FILES = 24;
const MAX_PREVIEW_CHARS = 8192;

const NPM_REGISTRY_BASE = "https://registry.npmjs.org";
const NPM_DOWNLOADS_BASE = "https://api.npmjs.org/downloads/point/last-month";
const GITHUB_API_BASE = "https://api.github.com/repos";

const STRICT_SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const README_SANITIZER_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "em",
    "strong",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "hr",
    "br",
    "del",
    "sup",
    "sub",
    "details",
    "summary",
    "kbd",
    "picture",
    "source",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "srcset", "alt", "title", "width", "height"],
    code: ["class"],
    span: ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
};

type NpmRegistryDoc = {
  "dist-tags"?: Record<string, string>;
  versions?: Record<
    string,
    {
      name?: string;
      version?: string;
      description?: string;
      license?: string;
      maintainers?: Array<{ name?: string }>;
      repository?: { url?: string };
      atlante?: { format?: unknown };
      dist?: { tarball?: string };
    }
  >;
  time?: Record<string, string>;
};

type NpmDownloadsDoc = { downloads?: number };

type GitHubRepoDoc = {
  stargazers_count?: number;
  pushed_at?: string;
};

/**
 * Strips `//` and `/* *\/` comments from JSONC while keeping string contents
 * intact, then removes trailing commas so the result is plain JSON.
 */
function parseJsonc<T>(source: string): T {
  let stripped = "";
  let index = 0;
  let inString = false;
  let blockOpen = false;
  let lineOpen = false;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      stripped += char;
      if (char === "\\") {
        stripped += next ?? "";
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (blockOpen) {
      if (char === "*" && next === "/") {
        blockOpen = false;
        index += 2;
        continue;
      }
      if (char === "\n") stripped += "\n";
      index += 1;
      continue;
    }
    if (lineOpen) {
      if (char === "\n") {
        lineOpen = false;
        stripped += "\n";
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      stripped += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockOpen = true;
      index += 2;
      continue;
    }
    if (char === "/" && next === "/") {
      lineOpen = true;
      index += 2;
      continue;
    }
    stripped += char;
    index += 1;
  }

  return JSON.parse(stripped.replace(/,(\s*[}\]])/g, "$1")) as T;
}

type PresetDocument = {
  agents?: Record<string, unknown>;
  skills?: Record<string, unknown>;
  eval?: unknown;
};

/**
 * Maps a git repository URL to the `owner/name` GitHub slug; returns null for
 * non-GitHub or unparseable URLs.
 */
function repositorySlug(url: string): string | null {
  const withoutFragment = url.split("#")[0];
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(
    withoutFragment,
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

function isPreviewCandidate(path: string): boolean {
  const name = basename(path);
  return (
    name === "atlante.jsonc" ||
    name === "atlante.json" ||
    name === "instance.jsonc" ||
    name === "template.jsonc" ||
    name === "template.md" ||
    name === "README.md"
  );
}

type ExtractedPack = {
  files: RegistryFile[];
  /** Full README content for the overview, independent of file preview caps. */
  readmeContent?: string;
  presets: Array<{
    name: string;
    default: boolean;
    bindings: { agents: number; skills: number };
  }>;
  evaluation?: RegistryPack["evaluation"];
  /** Authored repo-relative eval source path, composed into a URL at sync. */
  evaluationSource?: string;
};

type RecordValue = Record<string, unknown>;

function recordValue(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function packageRepositoryUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return stringValue(recordValue(value)?.url);
}

function packageMaintainers(value: unknown): Array<{ name?: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((person) => {
    if (typeof person === "string") return { name: person };
    const record = recordValue(person);
    return { name: stringValue(record?.name) };
  });
}

function localRegistryDoc(
  packageName: string,
  source: LocalPackSource,
): NpmRegistryDoc {
  const packageJson = source.packageJson;
  const version = stringValue(packageJson.version) ?? "";
  const repositoryUrl = packageRepositoryUrl(packageJson.repository);
  const maintainers = packageMaintainers(
    packageJson.maintainers ?? packageJson.contributors,
  );

  return {
    "dist-tags": { latest: version },
    versions: {
      [version]: {
        name: stringValue(packageJson.name),
        version,
        description: stringValue(packageJson.description),
        license: stringValue(packageJson.license),
        maintainers,
        repository: repositoryUrl ? { url: repositoryUrl } : undefined,
        atlante: recordValue(packageJson.atlante) as
          | { format?: unknown }
          | undefined,
        dist: { tarball: `local://${packageName}` },
      },
    },
  };
}

function isSafePackPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  )
    return false;
  return path
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== ".." &&
        segment !== ".git" &&
        segment !== "node_modules",
    );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function reportRunDate(runId: string): string | undefined {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-[0-9a-f]{4}$/.exec(runId);
  if (!match) return undefined;
  const parts = match.slice(1, 7).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    return undefined;
  return date.toISOString();
}

/** Keeps the registry contract small and ignores unverifiable pack reports. */
function readPackEvaluation(
  metadata: unknown,
  reportPath: string,
  extractDir: string,
  packRootPrefix: string,
): RegistryPack["evaluation"] {
  if (!isSafePackPath(reportPath)) return undefined;
  let report: unknown;
  try {
    report = JSON.parse(
      readFileSync(join(extractDir, packRootPrefix, reportPath), "utf8"),
    ) as unknown;
  } catch {
    return undefined;
  }

  const metadataRecord = recordValue(metadata);
  const reportRecord = recordValue(report);
  const meta = recordValue(reportRecord?.meta);
  const metaConfig = recordValue(meta?.config);
  const rawScenarios = recordValue(reportRecord?.scenarios);
  const runId = reportRecord?.runId;
  if (
    metadataRecord?.report !== reportPath ||
    !nonEmptyString(runId) ||
    !meta ||
    !nonEmptyString(meta.atlante) ||
    !nonEmptyString(meta.host) ||
    !nonEmptyString(meta.model) ||
    !nonEmptyString(meta.modelVersion) ||
    !metaConfig ||
    !positiveNumber(metaConfig.trials) ||
    !positiveNumber(metaConfig.timeoutMs) ||
    !positiveNumber(metaConfig.maxSessions) ||
    !positiveNumber(metaConfig.maxTokens) ||
    !rawScenarios
  )
    return undefined;
  const runDate = reportRunDate(runId);
  if (!runDate) return undefined;

  const scenarios: Record<string, { passRate: number; description?: string }> =
    {};
  for (const [name, value] of Object.entries(rawScenarios)) {
    const scenario = recordValue(value);
    const passRate = scenario?.passRate;
    if (
      name.length === 0 ||
      typeof passRate !== "number" ||
      !Number.isFinite(passRate) ||
      passRate < 0 ||
      passRate > 1
    )
      return undefined;
    const description = scenario?.description;
    scenarios[name] = {
      passRate,
      ...(typeof description === "string" && description.length > 0
        ? { description }
        : {}),
    };
  }
  if (Object.keys(scenarios).length === 0) return undefined;

  return {
    source: "self-reported",
    reportPath,
    runId,
    runDate,
    atlante: meta.atlante,
    host: meta.host,
    model: meta.model,
    modelVersion: meta.modelVersion,
    config: {
      trials: metaConfig.trials,
      timeoutMs: metaConfig.timeoutMs,
      maxSessions: metaConfig.maxSessions,
      maxTokens: metaConfig.maxTokens,
    },
    scenarios,
  };
}

/**
 * Extracts the pack tree from the npm tarball: preset discovery (every
 * directory containing an `atlante.jsonc`/`atlante.json`), preset binding
 * counts, and the capped set of inspectable pack files.
 */
function extractTarball(tarball: Buffer, packageName: string): ExtractedPack {
  const workDir = mkdtempSync(join(tmpdir(), "atlante-packs-"));
  try {
    const tarballPath = join(workDir, "pack.tgz");
    writeFileSync(tarballPath, tarball);
    const extractDir = join(workDir, "unpacked");
    mkdirSync(extractDir, { recursive: true });
    tar.x({ sync: true, gzip: true, file: tarballPath, cwd: extractDir });

    // npm tarballs extract to a single root directory; flatten its name away.
    const rootEntries = readdirSync(extractDir);
    const rootDir =
      rootEntries.length === 1 &&
      statSync(join(extractDir, rootEntries[0])).isDirectory()
        ? rootEntries[0]
        : "";
    const packRootPrefix = rootDir === "" ? "" : `${rootDir}/`;

    const entries: string[] = [];
    const walk = (relative: string): void => {
      const absolute = join(extractDir, relative);
      for (const name of readdirSync(absolute)) {
        const entryPath = relative === "" ? name : `${relative}/${name}`;
        if (statSync(join(extractDir, entryPath)).isDirectory()) {
          walk(entryPath);
        } else {
          entries.push(entryPath);
        }
      }
    };
    walk(rootDir);
    const packFiles = entries.map((entry) =>
      packRootPrefix === "" ? entry : entry.slice(packRootPrefix.length),
    );

    const presetDirs = new Map<string, { path: string; file: string }>();
    for (const file of packFiles) {
      const name = basename(file);
      if (name === "atlante.jsonc" || name === "atlante.json") {
        const dir = dirname(file) === "." ? "" : dirname(file);
        presetDirs.set(dir, {
          path: join(extractDir, packRootPrefix, file),
          file,
        });
      }
    }

    const rootPreset = presetDirs.get("");
    const rootDocument = rootPreset
      ? parseJsonc<PresetDocument>(readFileSync(rootPreset.path, "utf8"))
      : undefined;

    const presets = [...presetDirs.entries()]
      .map(([dir, { path }]) => {
        const doc = parseJsonc<PresetDocument>(readFileSync(path, "utf8"));
        return {
          name: dir === "" ? "default" : dir,
          default: dir === "",
          bindings: {
            agents: Object.keys(doc.agents ?? {}).length,
            skills: Object.keys(doc.skills ?? {}).length,
          },
        };
      })
      .sort((a, b) => {
        if (a.default !== b.default) return a.default ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const previewSources = packFiles
      .filter((file) => isPreviewCandidate(file))
      .sort((a, b) => {
        const aRoot = dirname(a) === ".";
        const bRoot = dirname(b) === ".";
        if (aRoot !== bRoot) return aRoot ? -1 : 1;
        return a.localeCompare(b);
      });

    const files: RegistryFile[] = previewSources
      .slice(0, MAX_PREVIEW_FILES)
      .map((file) => {
        const content = readFileSync(
          join(extractDir, packRootPrefix, file),
          "utf8",
        );
        return {
          path: file,
          content: content.length > MAX_PREVIEW_CHARS ? null : content,
        };
      });
    const readmePath = packFiles.includes("README.md")
      ? join(extractDir, packRootPrefix, "README.md")
      : undefined;

    if (presets.length === 0) {
      throw new Error(
        `${packageName}: no presets discovered; a pack must expose atlante.jsonc or atlante.json`,
      );
    }

    const evaluationMetadata = recordValue(rootDocument?.eval);
    const evaluationReportPath = evaluationMetadata?.report;
    const evaluation =
      nonEmptyString(evaluationReportPath) &&
      isSafePackPath(evaluationReportPath)
        ? readPackEvaluation(
            evaluationMetadata,
            evaluationReportPath,
            extractDir,
            packRootPrefix,
          )
        : undefined;

    // Authored repo-relative path of the eval sources; the sync composes the
    // deep link against the release tag once the published version is known.
    const evaluationSource = evaluationMetadata?.source;

    return {
      files,
      ...(readmePath
        ? { readmeContent: readFileSync(readmePath, "utf8") }
        : {}),
      presets,
      ...(evaluation ? { evaluation } : {}),
      ...(nonEmptyString(evaluationSource) && isSafePackPath(evaluationSource)
        ? { evaluationSource }
        : {}),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  headers?: Record<string, string>,
): Promise<unknown> {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return (await response.json()) as unknown;
}

/**
 * Synchronizes the curated manifest against npm and public GitHub data and
 * writes the registry snapshot consumed by the pack pages. A pack whose live
 * fetch fails is served from the previous snapshot; when no previous data
 * exists, the failure is fatal so the build never publishes an unverifiable
 * pack. The snapshot timestamp stays at the last fully successful
 * synchronization.
 */
export async function syncPacks(
  options: SyncPacksOptions = {},
): Promise<SyncPacksResult> {
  const websiteRoot =
    options.websiteRoot ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const fetchImpl = options.fetch ?? fetch;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date().toISOString());
  const manifest = options.manifest ?? loadRegistryManifest(websiteRoot);

  const snapshotPath = join(
    websiteRoot,
    "src",
    "data",
    "registry-snapshot.json",
  );
  let previous: RegistrySnapshot | null = null;
  try {
    previous = loadRegistrySnapshot(websiteRoot);
  } catch {
    previous = null;
  }
  const previousByName = new Map(
    (previous?.packs ?? []).map((pack) => [pack.name, pack]),
  );

  const packs: RegistryPack[] = [];
  let reusedPacks = 0;

  for (const entry of manifest.packs) {
    const packageName = entry.package;
    const localSource = options.localPacks?.get(packageName);
    let pack: RegistryPack | null = null;
    try {
      const registryDoc = localSource
        ? localRegistryDoc(packageName, localSource)
        : ((await fetchJson(
            `${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}`,
            fetchImpl,
          )) as NpmRegistryDoc);
      const latest = registryDoc["dist-tags"]?.latest;
      const version = latest ? registryDoc.versions?.[latest] : undefined;
      if (!latest || !version) {
        throw new Error(`${packageName}: no published version on npm`);
      }
      if (version.name !== packageName) {
        throw new Error(
          `${packageName}: registry served a mismatched name (${version.name})`,
        );
      }
      if (!STRICT_SEMVER.test(version.version ?? "")) {
        throw new Error(
          `${packageName}: version ${version.version} is not strict semver`,
        );
      }
      if (version.atlante?.format !== 1) {
        throw new Error(
          `${packageName}: npm manifest does not declare atlante.format: 1`,
        );
      }
      if (!version.dist?.tarball) {
        throw new Error(`${packageName}: registry metadata has no tarball URL`);
      }

      let downloads: number | null = null;
      if (!localSource) {
        try {
          const downloadsDoc = (await fetchJson(
            `${NPM_DOWNLOADS_BASE}/${encodeURIComponent(packageName)}`,
            fetchImpl,
          )) as NpmDownloadsDoc;
          downloads =
            typeof downloadsDoc.downloads === "number"
              ? downloadsDoc.downloads
              : null;
        } catch {
          downloads = null;
        }
      }

      const repositoryUrl = version.repository?.url ?? null;
      const repositorySlugValue = repositoryUrl
        ? repositorySlug(repositoryUrl)
        : null;
      let stars: number | null = null;
      let updatedAt: string | null = null;
      if (!localSource && repositorySlugValue) {
        try {
          const headers: Record<string, string> = {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          };
          if (env.GITHUB_TOKEN) {
            headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
          }
          const repoDoc = (await fetchJson(
            `${GITHUB_API_BASE}/${repositorySlugValue}`,
            fetchImpl,
            headers,
          )) as GitHubRepoDoc;
          stars =
            typeof repoDoc.stargazers_count === "number"
              ? repoDoc.stargazers_count
              : null;
          updatedAt =
            typeof repoDoc.pushed_at === "string" ? repoDoc.pushed_at : null;
        } catch {
          stars = null;
          updatedAt = null;
        }
      }

      let tarball: Buffer;
      if (localSource) {
        tarball = localSource.tarball;
      } else {
        const tarballResponse = await fetchImpl(version.dist.tarball);
        if (!tarballResponse.ok) {
          throw new Error(
            `${packageName}: tarball fetch responded ${tarballResponse.status}`,
          );
        }
        tarball = Buffer.from(await tarballResponse.arrayBuffer());
      }
      const extracted = extractTarball(tarball, packageName);

      // The eval source link pins the release tag (v<version>), so the
      // published self-reported results stay inspectable at that version.
      let evaluation = extracted.evaluation;
      if (evaluation && repositorySlugValue && extracted.evaluationSource) {
        evaluation = {
          ...evaluation,
          sourceUrl: `https://github.com/${repositorySlugValue}/tree/v${version.version ?? latest}/${extracted.evaluationSource}`,
        };
      }

      pack = {
        name: packageName,
        official: entry.official,
        tags: [...entry.tags],
        description: version.description ?? "",
        version: version.version ?? latest,
        license: typeof version.license === "string" ? version.license : null,
        maintainers: (version.maintainers ?? [])
          .map((maintainer) => maintainer.name ?? "")
          .filter((name) => name !== ""),
        repository:
          repositoryUrl === null
            ? null
            : { url: repositoryUrl, slug: repositorySlugValue },
        npmUrl: `https://www.npmjs.com/package/${packageName}`,
        metrics: {
          downloads,
          stars,
          publishedAt:
            typeof registryDoc.time?.[latest] === "string"
              ? (registryDoc.time?.[latest] ?? null)
              : null,
          updatedAt,
        },
        presets: extracted.presets.map((preset) => ({
          ...preset,
          locator: preset.default
            ? packageName
            : `${packageName}/${preset.name}`,
        })),
        readmeHtml: extracted.readmeContent
          ? sanitizeHtml(
              marked.parse(extracted.readmeContent) as string,
              README_SANITIZER_OPTIONS,
            )
          : "",
        files: extracted.files,
        ...(evaluation ? { evaluation } : {}),
      };
    } catch (error) {
      if (localSource) {
        const detail = error instanceof Error ? `: ${error.message}` : "";
        throw new Error(
          `${packageName}: local synchronization failed${detail}`,
        );
      }
      const fallback = previousByName.get(packageName);
      if (!fallback) {
        throw new Error(
          `${packageName}: live synchronization failed and no previous snapshot is available`,
        );
      }
      reusedPacks += 1;
      packs.push(fallback);
      continue;
    }
    packs.push(pack);
  }

  const snapshot: RegistrySnapshot = {
    syncedAt: reusedPacks === 0 ? now() : (previous?.syncedAt ?? now()),
    packs,
  };
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  return {
    snapshotPath,
    packs: packs.length,
    reusedPacks,
    snapshot,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await syncPacks();
  const reused =
    result.reusedPacks > 0
      ? ` (${result.reusedPacks} reused from the previous snapshot)`
      : "";
  console.log(
    `sync-packs: synchronized ${result.packs} pack(s)${reused} → ${result.snapshotPath}`,
  );
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RegistryMetrics = {
  downloads: number | null;
  stars: number | null;
  publishedAt: string | null;
  updatedAt: string | null;
};

export type RegistryBindings = {
  agents: number;
  skills: number;
};

export type RegistryPreset = {
  name: string;
  locator: string;
  default: boolean;
  bindings: RegistryBindings;
};

export type RegistryFile = {
  path: string;
  content: string | null;
};

export type RegistryEvaluationScenario = {
  passRate: number;
  description?: string;
};

export type RegistryEvaluation = {
  source: "self-reported";
  reportPath: string;
  runId: string;
  runDate: string;
  atlante: string;
  host: string;
  model: string;
  modelVersion: string;
  /** Effective run budget as recorded in the report. */
  config: {
    trials: number;
    timeoutMs: number;
    maxSessions: number;
    maxTokens: number;
  };
  scenarios: Record<string, RegistryEvaluationScenario>;
  /** GitHub tree URL of the authored evaluation sources, when resolvable. */
  sourceUrl?: string;
};

export type RegistryPack = {
  name: string;
  official: boolean;
  tags: string[];
  description: string;
  version: string;
  license: string | null;
  maintainers: string[];
  repository: { url: string; slug: string | null } | null;
  npmUrl: string;
  metrics: RegistryMetrics;
  presets: RegistryPreset[];
  readmeHtml: string;
  files: RegistryFile[];
  evaluation?: RegistryEvaluation;
};

export type RegistrySnapshot = {
  syncedAt: string;
  packs: RegistryPack[];
};

export type RegistryManifest = {
  packs: RegistryManifestEntry[];
};

export type RegistryManifestEntry = {
  package: string;
  official: boolean;
  tags: string[];
};

const SNAPSHOT_PATH = "src/data/registry-snapshot.json";
const MANIFEST_PATH = "src/data/registry-manifest.json";

function assertSnapshot(value: unknown): RegistrySnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error("Registry snapshot is not an object");
  }
  const snapshot = value as Partial<RegistrySnapshot>;
  if (typeof snapshot.syncedAt !== "string" || snapshot.syncedAt === "") {
    throw new Error("Registry snapshot is missing syncedAt");
  }
  if (!Array.isArray(snapshot.packs)) {
    throw new Error("Registry snapshot is missing packs");
  }
  return value as RegistrySnapshot;
}

/**
 * Reads the registry snapshot. sync-packs regenerates it at build time and
 * uses the committed copy as the network fallback; the pack pages consume it
 * as their build-time source. Never edit it directly.
 */
export function loadRegistrySnapshot(websiteRoot: string): RegistrySnapshot {
  const path = join(websiteRoot, SNAPSHOT_PATH);
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Registry snapshot is unavailable: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`Registry snapshot is not valid JSON: ${path}`);
  }
  return assertSnapshot(parsed);
}

function assertManifest(value: unknown): RegistryManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Registry manifest is not an object");
  }
  const manifest = value as Partial<RegistryManifest>;
  if (!Array.isArray(manifest.packs) || manifest.packs.length === 0) {
    throw new Error("Registry manifest declares no packs");
  }
  for (const entry of manifest.packs) {
    const candidate = entry as Partial<RegistryManifestEntry> | null;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.package !== "string" ||
      candidate.package === "" ||
      typeof candidate.official !== "boolean" ||
      !Array.isArray(candidate.tags) ||
      !candidate.tags.every((tag) => typeof tag === "string")
    ) {
      throw new Error("Registry manifest has an invalid pack entry");
    }
  }
  return value as RegistryManifest;
}

/**
 * Reads the curated pack manifest. It is authored, committed configuration.
 */
export function loadRegistryManifest(websiteRoot: string): RegistryManifest {
  const path = join(websiteRoot, MANIFEST_PATH);
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Registry manifest is unavailable: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`Registry manifest is not valid JSON: ${path}`);
  }
  return assertManifest(parsed);
}

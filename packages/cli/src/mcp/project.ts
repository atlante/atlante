import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  type LoadedProject,
  loadProject,
  type ProjectContext,
} from "@atlante/builder";
import {
  OpenCodeMaterializationError,
  readOpenCodeNative,
} from "@atlante/opencode";
import type {
  ResolvedResourceDocument,
  ResourceOrigin,
} from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";
import {
  CONFIG_FILENAMES,
  type Diagnostic,
  hasErrors,
  parseJsonc,
} from "@atlante/validator";
import { firstPartyProjectContext } from "../first-party-pack.js";
import {
  DOCUMENTATION_MAX_RESPONSE_BYTES,
  type DocumentationCatalogLoadResult,
  loadDocumentationCatalog,
  readDocumentation,
  searchDocumentation,
} from "./catalog.js";
import {
  diagnostic,
  type GetSchemaInput,
  type InspectIncludeSection,
  type InspectProjectInput,
  type McpDiagnostic,
  type McpToolEnvelope,
  type ReadDocInput,
  type SearchDocsInput,
  toolEnvelope,
} from "./contract.js";
import { getBundledSchema, type SchemaLookupResult } from "./schema.js";

export type McpOrigin = Readonly<{
  kind: ResourceOrigin["kind"];
  path: string;
}>;

export type McpResource = Readonly<{
  kind: "template" | "instance" | "binding";
  id: string;
  locator: string;
  origin: McpOrigin;
  collection?: string;
  description?: string;
  template_locator?: string;
}>;

export type McpArtifact = Readonly<{
  status: "fresh" | "stale" | "missing" | "invalid" | "unavailable";
  manifest_path: ".atlante/opencode-native.json";
  file_count: number;
  files?: readonly Readonly<{
    kind: "agent" | "skill";
    id: string;
    path: string;
    sha256: string;
  }>[];
  diagnostic?: McpDiagnostic;
}>;

export type McpCapability = Readonly<{
  status:
    | "available"
    | "empty"
    | "invalid"
    | "missing"
    | "stale"
    | "unavailable";
  detail?: string;
  diagnostic?: McpDiagnostic;
}>;

export type InspectProjectData = Readonly<{
  project_root: ".";
  configuration: Readonly<{
    exists: boolean;
    path: string | null;
    schema_uri: string | null;
    version: string | null;
    authored?: unknown;
    effective?: unknown;
    resolved?: unknown;
    provenance?: readonly Readonly<{
      pointer: string;
      origin: McpOrigin;
    }>[];
  }>;
  diagnostics: readonly McpDiagnostic[];
  capabilities: Readonly<{
    validation: McpCapability;
    resources: McpCapability;
    documentation: McpCapability;
    schema: McpCapability;
    generated_artifacts: McpCapability;
  }>;
  artifacts: McpArtifact;
}>;

export type ListResourcesData = Readonly<{
  resources: readonly McpResource[];
  total_count: number;
  truncated: boolean;
}>;

export type ValidateData = Readonly<{
  valid: boolean;
  config_path: string | null;
  project_root: ".";
}>;

export type SearchDocsData = Readonly<{
  query: string;
  matches: ReturnType<typeof searchDocumentation>;
}>;

export type McpOperations = Readonly<{
  inspectProject: (
    input: InspectProjectInput,
  ) => McpToolEnvelope<InspectProjectData>;
  listResources: (
    input: Readonly<{ limit?: number }>,
  ) => McpToolEnvelope<ListResourcesData> | McpToolEnvelope;
  validate: () => McpToolEnvelope<ValidateData>;
  searchDocs: (input: SearchDocsInput) => McpToolEnvelope<SearchDocsData>;
  readDoc: (input: ReadDocInput) => McpToolEnvelope;
  getSchema: (input: GetSchemaInput) => McpToolEnvelope;
}>;

type ActiveProject = Readonly<{
  root: string;
  loaded: LoadedProject;
  configCandidates: readonly string[];
}>;

type UnavailableProject = Readonly<{
  root: string;
  diagnostic: McpDiagnostic;
}>;

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function projectPath(root: string, path: string): string {
  const candidate = normalizedPath(relative(root, resolve(path)));
  if (candidate === "") return ".";
  if (candidate !== ".." && !candidate.startsWith("../")) return candidate;
  return basename(path);
}

function safeSource(
  root: string,
  source: string | undefined,
): string | undefined {
  if (!source) return undefined;
  if (!isAbsolute(source)) return source;
  return projectPath(root, source);
}

function redact(root: string, value: string): string {
  const rooted = value.replaceAll(root, ".");
  return rooted
    .replace(
      /(^|[^A-Za-z0-9_/.])\/(?!\/)[A-Za-z0-9._~!$&'()*+@%/-]+/g,
      "$1<absolute-path>",
    )
    .replace(
      /(^|[^A-Za-z0-9_])[A-Za-z]:[\\/][A-Za-z0-9._~!$&'()*+@%\\/:.-]+/g,
      "$1<absolute-path>",
    )
    .replace(
      /(^|[^A-Za-z0-9_])\\\\[A-Za-z0-9._~!$&'()*+@%\\/:.-]+/g,
      "$1<absolute-path>",
    )
    .replace(
      /file:\/\/\/[A-Za-z0-9._~!$&'()*+@%/-]+/g,
      "file://<absolute-path>",
    );
}

function publicValue(root: string, value: unknown): unknown {
  if (typeof value === "string") return redact(root, value);
  if (Array.isArray(value)) return value.map((item) => publicValue(root, item));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      redact(root, key),
      publicValue(root, item),
    ]),
  );
}

function publicDiagnostic(root: string, value: Diagnostic): McpDiagnostic {
  return {
    ...value,
    ...(safeSource(root, value.source)
      ? { source: safeSource(root, value.source) }
      : {}),
    message: redact(root, value.message),
    ...(value.cause ? { cause: redact(root, value.cause) } : {}),
  };
}

function diagnosticsFor(
  root: string,
  diagnostics: readonly Diagnostic[],
): McpDiagnostic[] {
  return diagnostics.map((value) => publicDiagnostic(root, value));
}

function originOf(origin: ResourceOrigin): McpOrigin {
  return { kind: origin.kind, path: origin.path };
}

function schemaUriOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const schema = (value as Record<string, unknown>).$schema;
  return typeof schema === "string" ? schema : null;
}

function schemaVersionOf(uri: string | null): string | null {
  if (!uri) return null;
  const match = /^https:\/\/atlante\.sh\/schema\/([^/]+)\//.exec(uri);
  return match?.[1] ?? null;
}

function configCandidates(root: string): string[] {
  return CONFIG_FILENAMES.map((filename) => join(root, filename)).filter(
    (path) => existsSync(path),
  );
}

function authoredConfig(path: string | undefined): unknown {
  if (!path) return null;
  try {
    const text = readFileSync(path, "utf8");
    const parsed = parseJsonc(text, {
      allowTrailingComma: path.endsWith(".jsonc"),
      disallowComments: path.endsWith(".json"),
    });
    return parsed.errors.length === 0 ? (parsed.value ?? null) : null;
  } catch {
    return null;
  }
}

function activeProject(
  root: string,
  context?: ProjectContext,
): ActiveProject | UnavailableProject {
  const projectRoot = resolve(root);
  const candidates = configCandidates(projectRoot);
  try {
    return {
      root: projectRoot,
      loaded: loadProject(projectRoot, context ?? firstPartyProjectContext()),
      configCandidates: candidates,
    };
  } catch {
    return {
      root: projectRoot,
      diagnostic: diagnostic(
        "project-unavailable",
        "the active Atlante project could not be loaded",
      ),
    };
  }
}

function artifactEvidence(root: string): McpArtifact {
  const manifestPath = ".atlante/opencode-native.json" as const;
  if (!existsSync(join(root, manifestPath)))
    return {
      status: "missing",
      manifest_path: manifestPath,
      file_count: 0,
    };

  try {
    const native = readOpenCodeNative(root);
    return {
      status: "fresh",
      manifest_path: manifestPath,
      file_count: native.files.length,
      files: native.files.map(({ kind, id, path, sha256 }) => ({
        kind,
        id,
        path,
        sha256,
      })),
    };
  } catch (cause) {
    const code =
      cause instanceof OpenCodeMaterializationError
        ? cause.code
        : "unavailable";
    const message =
      code === "drift"
        ? "generated OpenCode artifacts are stale"
        : code === "invalid-manifest" &&
            cause instanceof Error &&
            cause.message.includes("missing")
          ? "generated OpenCode artifacts are missing"
          : "generated OpenCode artifacts could not be verified";
    const status =
      code === "drift"
        ? "stale"
        : code === "invalid-manifest" && message.endsWith("missing")
          ? "missing"
          : code === "invalid-manifest"
            ? "invalid"
            : "unavailable";
    return {
      status,
      manifest_path: manifestPath,
      file_count: 0,
      diagnostic: diagnostic(`native-artifacts-${code}`, message),
    };
  }
}

function capability(
  status: McpCapability["status"],
  detail?: string,
  capabilityDiagnostic?: McpDiagnostic,
): McpCapability {
  return {
    status,
    ...(detail ? { detail } : {}),
    ...(capabilityDiagnostic ? { diagnostic: capabilityDiagnostic } : {}),
  };
}

function artifactCapability(artifact: McpArtifact): McpCapability {
  return capability(
    artifact.status === "fresh" ? "available" : artifact.status,
    artifact.status === "fresh"
      ? "ownership manifest and generated files verified"
      : undefined,
    artifact.diagnostic,
  );
}

function documentationCapability(
  documentation: DocumentationCatalogLoadResult,
): McpCapability {
  if (documentation.status === "available")
    return capability(
      "available",
      `${documentation.catalog.documents.length} documents bundled`,
    );
  return capability("unavailable", undefined, {
    code: documentation.diagnostic.code,
    message: documentation.diagnostic.message,
  });
}

function schemaCapability(schema: SchemaLookupResult): McpCapability {
  if (schema.status === "ok")
    return capability("available", "versioned schema bundle loaded");
  return capability("unavailable", undefined, {
    code: schema.diagnostic.code,
    message: schema.diagnostic.message,
  });
}

function resourceCapability(loaded: LoadedProject): McpCapability {
  if (!loaded.resources)
    return capability("unavailable", "resource resolution did not complete");
  return capability(
    hasErrors(loaded.diagnostics) ? "invalid" : "available",
    `${loaded.resources.templates.length} templates and ${loaded.resources.instances.length} instances resolved`,
  );
}

function capabilitiesOf(
  loaded: LoadedProject,
  documentation: DocumentationCatalogLoadResult,
  schema: SchemaLookupResult,
  artifacts: McpArtifact,
): InspectProjectData["capabilities"] {
  return {
    validation: capability(
      hasErrors(loaded.diagnostics) ? "invalid" : "available",
    ),
    resources: resourceCapability(loaded),
    documentation: documentationCapability(documentation),
    schema: schemaCapability(schema),
    generated_artifacts: artifactCapability(artifacts),
  };
}

function provenanceOf(
  resources: ResolvedResourceDocument | undefined,
): readonly Readonly<{ pointer: string; origin: McpOrigin }>[] {
  return Object.entries(resources?.provenance ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pointer, origin]) => ({ pointer, origin: originOf(origin) }));
}

function inspectConfiguration(
  projectRoot: string,
  loaded: LoadedProject,
  configCandidates: readonly string[],
  include: ReadonlySet<InspectIncludeSection>,
): InspectProjectData["configuration"] {
  const configPath = loaded.configPath ?? configCandidates[0];
  const authored = loaded.resources?.raw ?? authoredConfig(configPath);
  const schemaUri = schemaUriOf(authored) ?? schemaUriOf(loaded.document);
  const wants = (section: InspectIncludeSection): boolean =>
    include.has(section);
  return {
    exists: configCandidates.length > 0,
    path: configPath ? projectPath(projectRoot, configPath) : null,
    schema_uri: schemaUri,
    version: schemaVersionOf(schemaUri),
    ...(wants("authored")
      ? { authored: publicValue(projectRoot, authored ?? null) }
      : {}),
    ...(wants("effective")
      ? {
          effective: publicValue(
            projectRoot,
            loaded.resources?.effectiveRaw ?? null,
          ),
        }
      : {}),
    ...(wants("resolved")
      ? { resolved: publicValue(projectRoot, loaded.document ?? null) }
      : {}),
    ...(wants("provenance")
      ? { provenance: provenanceOf(loaded.resources) }
      : {}),
  };
}

function inspectArtifacts(
  artifacts: McpArtifact,
  include: ReadonlySet<InspectIncludeSection>,
): McpArtifact {
  if (include.has("artifact-files")) return artifacts;
  return {
    status: artifacts.status,
    manifest_path: artifacts.manifest_path,
    file_count: artifacts.file_count,
    ...(artifacts.diagnostic ? { diagnostic: artifacts.diagnostic } : {}),
  };
}

function inspectProject(
  root: string,
  input: InspectProjectInput,
  context?: ProjectContext,
): McpToolEnvelope<InspectProjectData> {
  const loadedProject = activeProject(root, context);
  if ("diagnostic" in loadedProject)
    return toolEnvelope("inspect_project", "unavailable", undefined, [
      loadedProject.diagnostic,
    ]);

  const { loaded, configCandidates, root: projectRoot } = loadedProject;
  const artifacts = artifactEvidence(projectRoot);
  const documentation = loadDocumentationCatalog(projectRoot);
  const schema = getBundledSchema(SCHEMA_URI);
  const diagnostics = diagnosticsFor(projectRoot, loaded.diagnostics);
  const include = new Set<InspectIncludeSection>(input.include ?? []);
  const data: InspectProjectData = {
    project_root: ".",
    configuration: inspectConfiguration(
      projectRoot,
      loaded,
      configCandidates,
      include,
    ),
    diagnostics,
    capabilities: capabilitiesOf(loaded, documentation, schema, artifacts),
    artifacts: inspectArtifacts(artifacts, include),
  };
  return toolEnvelope(
    "inspect_project",
    hasErrors(loaded.diagnostics) ? "invalid" : "ok",
    data,
    diagnostics,
  );
}

function resourceViews(
  root: string,
  resources: ResolvedResourceDocument,
): McpResource[] {
  const views: McpResource[] = [];
  for (const template of resources.templates) {
    views.push({
      kind: "template",
      id: template.key,
      locator: String(template.locator),
      origin: originOf(template.origin),
    });
  }
  for (const instance of resources.instances) {
    views.push({
      kind: "instance",
      id: instance.key,
      locator: String(instance.locator),
      origin: originOf(instance.origin),
      template_locator: String(instance.effectiveTemplate.locator),
    });
  }
  for (const [collection, bindings] of Object.entries(resources.bindings)) {
    for (const binding of Object.values(bindings)) {
      views.push({
        kind: "binding",
        id: binding.id,
        locator: String(binding.template.locator),
        origin: originOf(binding.template.origin),
        collection,
        description: redact(root, binding.description),
        template_locator: String(binding.template.locator),
      });
    }
  }
  return views.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id) ||
      left.locator.localeCompare(right.locator),
  );
}

function listResources(
  root: string,
  input: Readonly<{ limit?: number }>,
  context?: ProjectContext,
): McpToolEnvelope<ListResourcesData> {
  const loadedProject = activeProject(root, context);
  if ("diagnostic" in loadedProject)
    return toolEnvelope("list_resources", "unavailable", undefined, [
      loadedProject.diagnostic,
    ]);
  const { loaded, root: projectRoot } = loadedProject;
  const diagnostics = diagnosticsFor(projectRoot, loaded.diagnostics);
  if (!loaded.resources || hasErrors(loaded.diagnostics))
    return toolEnvelope("list_resources", "invalid", undefined, diagnostics);
  const all = resourceViews(projectRoot, loaded.resources);
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 100)));
  const data: ListResourcesData = {
    resources: all.slice(0, limit),
    total_count: all.length,
    truncated: all.length > limit,
  };
  return toolEnvelope(
    "list_resources",
    all.length === 0 ? "empty" : "ok",
    data,
    diagnostics,
  );
}

function validate(
  root: string,
  context?: ProjectContext,
): McpToolEnvelope<ValidateData> {
  const loadedProject = activeProject(root, context);
  if ("diagnostic" in loadedProject)
    return toolEnvelope("validate", "unavailable", undefined, [
      loadedProject.diagnostic,
    ]);
  const { loaded, root: projectRoot } = loadedProject;
  const diagnostics = diagnosticsFor(projectRoot, loaded.diagnostics);
  const valid = !hasErrors(loaded.diagnostics);
  return toolEnvelope(
    "validate",
    valid ? "ok" : "invalid",
    {
      valid,
      config_path: loaded.configPath
        ? projectPath(projectRoot, loaded.configPath)
        : null,
      project_root: ".",
    },
    diagnostics,
  );
}

function searchDocs(
  root: string,
  input: SearchDocsInput,
): McpToolEnvelope<SearchDocsData> {
  const catalog = loadDocumentationCatalog(root);
  if (catalog.status !== "available")
    return toolEnvelope("search_docs", "unavailable", undefined, [
      catalog.diagnostic,
    ]);
  const matches = searchDocumentation(catalog.catalog, input.query, {
    limit: input.limit,
  });
  return toolEnvelope("search_docs", matches.length === 0 ? "empty" : "ok", {
    query: input.query,
    matches,
  });
}

function readDoc(root: string, input: ReadDocInput): McpToolEnvelope {
  const catalog = loadDocumentationCatalog(root);
  if (catalog.status !== "available")
    return toolEnvelope("read_doc", "unavailable", undefined, [
      catalog.diagnostic,
    ]);
  const result = readDocumentation(
    catalog.catalog,
    input.document_id,
    input.section_id,
    input.max_bytes ?? DOCUMENTATION_MAX_RESPONSE_BYTES,
  );
  if (result.status !== "ok")
    return toolEnvelope("read_doc", "diagnostic", undefined, [
      result.diagnostic,
    ]);
  return toolEnvelope("read_doc", "ok", result);
}

function getSchema(input: GetSchemaInput): McpToolEnvelope {
  const result = getBundledSchema(input.uri);
  if (result.status !== "ok")
    return toolEnvelope("get_schema", "diagnostic", undefined, [
      result.diagnostic,
    ]);
  return toolEnvelope("get_schema", "ok", result);
}

/** Creates all read-only operations against one active project root. */
export function createMcpOperations(
  root = process.cwd(),
  context?: ProjectContext,
): McpOperations {
  const projectRoot = resolve(root);
  return {
    inspectProject: (input) => inspectProject(projectRoot, input, context),
    listResources: (input) => listResources(projectRoot, input, context),
    validate: () => validate(projectRoot, context),
    searchDocs: (input) => searchDocs(projectRoot, input),
    readDoc: (input) => readDoc(projectRoot, input),
    getSchema,
  };
}

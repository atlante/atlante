import { type Dirent, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  EVAL_SCENARIO_SCHEMA_URI,
  type EvalScenario,
  evalScenarioSchema,
} from "@atlante/schema";
import type { Diagnostic } from "./diagnostic.js";
import { error, sortDiagnostics } from "./diagnostic.js";
import { globFiles } from "./glob.js";
import { locationAtPointer, parseJsonc, positionOf } from "./jsonc.js";
import { zodDiagnostics } from "./zod-diagnostics.js";

const JSONC_EXTENSIONS = new Set([".jsonc"]);

function isJsoncFilename(filename: string): boolean {
  return [...JSONC_EXTENSIONS].some((extension) =>
    filename.endsWith(extension),
  );
}

export type EvalScenarioOrigin =
  | Readonly<{
      readonly kind: "project";
      readonly root: string;
    }>
  | Readonly<{
      readonly kind: "package";
      readonly root: string;
      readonly packageName: string;
      readonly packageVersion: string;
      /** Package or preset locator that selected this suite. */
      readonly locator: string;
    }>;

export type EvalScenarioDiscoveryOptions = Readonly<{
  readonly origin?: EvalScenarioOrigin;
}>;

/** One validated scenario document paired with its base-relative source. */
export type DiscoveredEvalScenario = {
  scenario: EvalScenario;
  /** Base-root-relative, forward-slash separated source path. */
  source: string;
  /** Root used for fixture paths and source discovery. */
  origin: EvalScenarioOrigin;
};

export type EvalScenarioDiscovery = {
  scenarios: DiscoveredEvalScenario[];
  diagnostics: Diagnostic[];
};

function parseEvalScenarioText(
  text: string,
  source: string,
): { scenario?: EvalScenario; diagnostics: Diagnostic[] } {
  const filename = basename(source);
  const isJsonc = isJsoncFilename(filename);
  const parsed = parseJsonc(text, {
    allowTrailingComma: isJsonc,
    disallowComments: !isJsonc,
  });
  if (parsed.errors.length > 0 || parsed.value === undefined) {
    const first = parsed.errors[0];
    return {
      diagnostics: [
        error("invalid-json", `${filename}: malformed JSON`, {
          source: filename,
          location: first ? positionOf(text, first.offset) : undefined,
        }),
      ],
    };
  }

  const raw = parsed.value;
  const schemaUri =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).$schema
      : undefined;
  if (schemaUri !== EVAL_SCENARIO_SCHEMA_URI) {
    const pointer = "/$schema";
    return {
      diagnostics: [
        error(
          "unsupported-schema",
          `${filename}: unsupported $schema; expected the Atlante eval scenario schema`,
          {
            path: pointer,
            pointer,
            source: filename,
            location: locationAtPointer(text, pointer),
            expected: EVAL_SCENARIO_SCHEMA_URI,
          },
        ),
      ],
    };
  }

  const result = evalScenarioSchema.safeParse(raw);
  if (!result.success) {
    return {
      diagnostics: zodDiagnostics(
        result,
        text,
        {
          code: "invalid-eval-scenario",
          source: filename,
          messagePrefix: `${filename}: `,
        },
        locationAtPointer,
      ),
    };
  }
  return { scenario: result.data, diagnostics: [] };
}

const FIXTURE_FORBIDDEN_SEGMENTS = new Set([".git", "node_modules"]);
/** Defensive cap so a cyclic or absurd fixture tree fails fast. */
const FIXTURE_MAX_DEPTH = 32;

function fixtureViolations(root: string, absolute: string): string | undefined {
  try {
    if (pathTraversesSymlink(root, absolute))
      return "the fixture path must not traverse a symbolic link";
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) return "the fixture directory does not exist";
    if (stat.isSymbolicLink()) return "the fixture must not be a symbolic link";
    if (!stat.isDirectory()) return "the fixture must be a directory";
  } catch {
    return "the fixture path could not be inspected";
  }
  const walk = (directory: string, depth: number): string | undefined => {
    if (depth > FIXTURE_MAX_DEPTH)
      return "the fixture tree exceeds the depth limit";
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch {
      return "the fixture directory is unreadable";
    }
    for (const entry of entries) {
      if (FIXTURE_FORBIDDEN_SEGMENTS.has(entry.name))
        return `the fixture contains a ${entry.name} entry`;
      if (entry.isSymbolicLink())
        return `the fixture contains a symbolic link (${entry.name})`;
      if (entry.isFile()) continue;
      if (entry.isDirectory()) {
        const violation = walk(join(directory, entry.name), depth + 1);
        if (violation) return violation;
      }
    }
    return undefined;
  };
  return walk(absolute, 0);
}

function pathTraversesSymlink(root: string, absolute: string): boolean {
  let current = root;
  if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
    return true;
  const path = relative(root, absolute);
  for (const segment of path.split(sep)) {
    if (segment === "" || segment === ".") continue;
    current = join(current, segment);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
      return true;
  }
  return false;
}

/**
 * Discovers and validates eval scenario documents for a project: expands the
 * configured glob relative to the project root, parses each match as a v0.1
 * scenario document, enforces unique scenario names, and checks fixture
 * constraints. Scenarios are returned sorted by name.
 */
export function discoverEvalScenarios(
  projectRoot: string,
  globPattern: string,
  options: EvalScenarioDiscoveryOptions = {},
): EvalScenarioDiscovery {
  const root = resolve(projectRoot);
  const origin: EvalScenarioOrigin = options.origin
    ? { ...options.origin, root }
    : { kind: "project", root };
  const normalizedPattern = globPattern.replaceAll(sep, "/");
  const diagnostics: Diagnostic[] = [];
  if (
    normalizedPattern.startsWith("/") ||
    normalizedPattern.split("/").includes("..")
  ) {
    return {
      scenarios: [],
      diagnostics: [
        error(
          "invalid-scenario-glob",
          `the scenario glob must be relative to the project root: ${normalizedPattern}`,
          { expected: "project-root-relative glob" },
        ),
      ],
    };
  }

  const matches = globFiles(root, normalizedPattern);
  if (matches.length === 0) {
    return {
      scenarios: [],
      diagnostics: [
        error(
          "empty-scenario-glob",
          `the scenario glob matched no documents: ${normalizedPattern}`,
          {
            expected: "at least one scenario document",
            next: "author scenario documents under the configured location",
          },
        ),
      ],
    };
  }

  const scenarios: DiscoveredEvalScenario[] = [];
  const seenNames = new Map<string, string>();
  for (const match of matches) {
    const absolute = join(root, match);
    let text: string;
    try {
      text = readFileSync(absolute, "utf8");
    } catch {
      diagnostics.push(
        error("scenario-unreadable", `cannot read scenario document ${match}`, {
          source: match,
        }),
      );
      continue;
    }
    const parsed = parseEvalScenarioText(text, match);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.scenario) continue;
    const scenario = parsed.scenario;
    const previous = seenNames.get(scenario.name);
    if (previous !== undefined) {
      diagnostics.push(
        error(
          "duplicate-scenario-name",
          `scenario name "${scenario.name}" is declared by both ${previous} and ${match}`,
          {
            source: match,
            expected: "scenario names unique across the suite",
          },
        ),
      );
      continue;
    }
    seenNames.set(scenario.name, match);

    let fixtureAbsolute: string;
    try {
      fixtureAbsolute = resolve(root, scenario.task.fixture);
    } catch {
      diagnostics.push(
        error(
          "invalid-scenario-fixture",
          `the fixture path is invalid: ${scenario.task.fixture}`,
          {
            source: match,
            pointer: "/task/fixture",
            expected: "project-root-relative fixture path",
          },
        ),
      );
      continue;
    }
    const fixtureRelative = relative(root, fixtureAbsolute);
    if (fixtureRelative.startsWith("..") || fixtureRelative === "") {
      diagnostics.push(
        error(
          "invalid-scenario-fixture",
          `the fixture must resolve inside the project: ${scenario.task.fixture}`,
          { source: match, expected: "project-root-relative fixture path" },
        ),
      );
      continue;
    }
    const violation = fixtureViolations(root, fixtureAbsolute);
    if (violation) {
      diagnostics.push(
        error(
          "invalid-scenario-fixture",
          `${scenario.task.fixture}: ${violation}`,
          {
            source: match,
            pointer: `/task/fixture`,
            expected: "fixture directory without .git or node_modules entries",
          },
        ),
      );
      continue;
    }

    scenarios.push({ scenario, source: match, origin });
  }

  scenarios.sort((left, right) =>
    left.scenario.name < right.scenario.name
      ? -1
      : left.scenario.name > right.scenario.name
        ? 1
        : 0,
  );
  return { scenarios, diagnostics: sortDiagnostics(diagnostics) };
}

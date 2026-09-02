import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  EVAL_SCENARIO_SCHEMA_URI,
  type EvalScenario,
  evalScenarioSchema,
} from "@atlante/schema";
import {
  findNodeAtLocation,
  getNodeValue,
  type ParseError,
  parseTree,
} from "jsonc-parser";
import type { Diagnostic } from "./diagnostic.js";
import { error, sortDiagnostics } from "./diagnostic.js";
import { globFiles, globHasMagic } from "./glob.js";
import { zodDiagnostics } from "./zod-diagnostics.js";

const JSONC_EXTENSIONS = new Set([".jsonc"]);

function isJsoncFilename(filename: string): boolean {
  return [...JSONC_EXTENSIONS].some((extension) =>
    filename.endsWith(extension),
  );
}

function positionOf(text: string, offset: number) {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function locationAtPointer(
  text: string,
  pointer: string | undefined,
): { line: number; column: number } | undefined {
  if (pointer === undefined) return undefined;
  const parseErrors: ParseError[] = [];
  const tree = parseTree(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  const node = tree
    ? findNodeAtLocation(tree, pointerSegments(pointer))
    : undefined;
  return node ? positionOf(text, node.offset) : undefined;
}

function pointerSegments(pointer: string | undefined): string[] {
  if (!pointer || pointer === "" || pointer === "/") return [];
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** One validated scenario document paired with its project-relative source. */
export type DiscoveredEvalScenario = {
  scenario: EvalScenario;
  /** Project-relative, forward-slash separated source path. */
  source: string;
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
  const parseErrors: ParseError[] = [];
  const tree = parseTree(text, parseErrors, {
    allowTrailingComma: isJsonc,
    disallowComments: !isJsonc,
  });
  if (parseErrors.length > 0 || !tree) {
    const first = parseErrors[0];
    return {
      diagnostics: [
        error("invalid-json", `${filename}: malformed JSON`, {
          source: filename,
          location: first ? positionOf(text, first.offset) : undefined,
        }),
      ],
    };
  }

  const raw = getNodeValue(tree) as unknown;
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

function fixtureViolations(
  _root: string,
  absolute: string,
): string | undefined {
  const stat = statSync(absolute, { throwIfNoEntry: false });
  if (!stat) return "the fixture directory does not exist";
  if (!stat.isDirectory()) return "the fixture must be a directory";
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
      if (entry.isFile()) continue;
      if (entry.isDirectory() && FIXTURE_FORBIDDEN_SEGMENTS.has(entry.name))
        return `the fixture contains a ${entry.name} entry`;
      if (entry.isDirectory()) {
        const violation = walk(join(directory, entry.name), depth + 1);
        if (violation) return violation;
      }
    }
    return undefined;
  };
  return walk(absolute, 0);
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
): EvalScenarioDiscovery {
  const root = resolve(projectRoot);
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

    const fixtureAbsolute = resolve(root, scenario.task.fixture);
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

    scenarios.push({ scenario, source: match });
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

export { globFiles, globHasMagic };

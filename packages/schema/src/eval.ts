import { z } from "zod";

/**
 * Scenario documents are versioned Atlante documents in their own namespace:
 * the URI dispatches loaders without ambiguity against configuration documents.
 */
export const EVAL_SCENARIO_SCHEMA_URI =
  "https://atlante.sh/schema/v0.1/eval-scenario.json";

/** The only host runner in v1; the HostRunner seam stays internal to eval. */
export const EVAL_HOST = "opencode" as const;

/** Authored eval budget; absent fields inherit these defaults at run time. */
export const EVAL_BUDGET_DEFAULTS = {
  trials: 3,
  timeoutMs: 600_000,
  maxSessions: 15,
  maxTokens: 400_000,
} as const;

/** Per-trial default applied when a check does not set its own timeout. */
export const EVAL_CHECK_TIMEOUT_DEFAULT_MS = 120_000;

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;

const forbiddenPathSegments = new Set([".git", "node_modules"]);

/**
 * Project-root-relative paths used by fixtures, checks, and allowlists resolve
 * inside the sandbox. Structural rules reject absolute paths, traversal, and
 * entries that must never be copied or graded; containment against the project
 * root is semantic and enforced at discovery time.
 */
const sandboxRelativePathSchema = z
  .string()
  .min(1)
  .superRefine((input, context) => {
    if (input.startsWith("/") || input.startsWith("\\")) {
      context.addIssue({
        code: "custom",
        message: "path must be relative to the project root",
      });
      return;
    }
    if (input.endsWith("/") || input.endsWith("\\")) {
      context.addIssue({
        code: "custom",
        message: "path must not end with a separator",
      });
      return;
    }
    const segments = input.split(/[\\/]/);
    if (segments.includes("..")) {
      context.addIssue({
        code: "custom",
        message: "path must not contain '..' segments",
      });
      return;
    }
    const forbidden = segments.find((segment) =>
      forbiddenPathSegments.has(segment),
    );
    if (forbidden) {
      context.addIssue({
        code: "custom",
        message: `path must not contain a ${forbidden} segment`,
      });
    }
  });

export type SandboxRelativePath = z.infer<typeof sandboxRelativePathSchema>;

const positiveIntSchema = z.number().int().positive();

const evalBudgetSchema = z.strictObject({
  trials: positiveIntSchema.max(50).default(EVAL_BUDGET_DEFAULTS.trials),
  timeoutMs: positiveIntSchema.default(EVAL_BUDGET_DEFAULTS.timeoutMs),
  maxSessions: positiveIntSchema.default(EVAL_BUDGET_DEFAULTS.maxSessions),
  maxTokens: positiveIntSchema.default(EVAL_BUDGET_DEFAULTS.maxTokens),
});

export type EvalBudget = z.infer<typeof evalBudgetSchema>;

/** Optional `eval` section of an Atlante configuration document. */
export const evalConfigSchema = z.strictObject({
  host: z.literal(EVAL_HOST),
  /** Glob of scenario documents, relative to the project root. */
  scenarios: z.string().min(1),
  /** Passthrough to the host run (`--model`); default is the host default. */
  model: z.string().min(1).optional(),
  budget: evalBudgetSchema.optional(),
});

export type EvalConfig = z.infer<typeof evalConfigSchema>;
export type AuthoredEvalConfig = z.input<typeof evalConfigSchema>;

const commandCheckSchema = z.strictObject({
  type: z.literal("command"),
  /** argv executed in the sandbox root; never routed through a shell. */
  run: z.array(z.string().min(1)).min(1),
  expectExit: z.number().int().default(0),
  /** Regex source matched against combined stdout and stderr. */
  outputMatches: z
    .string()
    .min(1)
    .refine((source) => {
      try {
        new RegExp(source);
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
  timeoutMs: positiveIntSchema.default(EVAL_CHECK_TIMEOUT_DEFAULT_MS),
});

const filePathCheckSchema = z.strictObject({
  type: z.enum(["file-exists", "file-absent", "file-unchanged"]),
  path: sandboxRelativePathSchema,
});

const fileContainsCheckSchema = z.strictObject({
  type: z.literal("file-contains"),
  path: sandboxRelativePathSchema,
  pattern: z.string().min(1),
  /** Literal match by default; regular expression is opt-in. */
  regex: z.boolean().default(false),
});

const diffAllowlistCheckSchema = z.strictObject({
  type: z.literal("diff-allowlist"),
  /** Paths the session may modify; anything else is scope creep. */
  allow: z.array(sandboxRelativePathSchema).min(1),
});

/** Deterministic, zero-LLM checks graded against sandbox state. */
export const evalCheckSchema = z.discriminatedUnion("type", [
  commandCheckSchema,
  filePathCheckSchema,
  fileContainsCheckSchema,
  diffAllowlistCheckSchema,
]);

export type EvalCheck = z.infer<typeof evalCheckSchema>;

const evalScenarioTaskSchema = z.strictObject({
  /** Copied as the sandbox root; must not contain .git or node_modules. */
  fixture: sandboxRelativePathSchema,
  /** argv run inside the sandbox before the baseline snapshot. */
  setup: z.array(z.string().min(1)).optional(),
  /** Harness agent driving the task; default is the host default agent. */
  agent: z.string().min(1).optional(),
  prompt: z.string().min(1),
});

export type EvalScenarioTask = z.infer<typeof evalScenarioTaskSchema>;

/** A versioned eval scenario document (v0.1, normative). */
export const evalScenarioSchema = z.strictObject({
  $schema: z.literal(EVAL_SCENARIO_SCHEMA_URI),
  version: z.literal("0.1"),
  /** Unique across the suite; duplicates are rejected at discovery. */
  name: z.string().regex(slugPattern),
  description: z.string().min(1).optional(),
  task: evalScenarioTaskSchema,
  /** Scenario-level override of the configured budget timeout. */
  budget: z.strictObject({ timeoutMs: positiveIntSchema }).optional(),
  checks: z.array(evalCheckSchema).min(1),
});

export type EvalScenario = z.infer<typeof evalScenarioSchema>;
export type AuthoredEvalScenario = z.input<typeof evalScenarioSchema>;

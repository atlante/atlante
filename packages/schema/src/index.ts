export type {
  AgentBinding,
  AgentBindingOverlay,
  AgentsOverlay,
  AtlanteDocument,
  AtlanteDocumentOverlay,
  AuthoredBinding,
  AuthoredExtends,
  AuthoredResourceLocator,
  Hosts,
  HostTarget,
  OutputDirectory,
  OutputOptions,
  OutputOptionsOverlay,
  RawBinding,
  RawResourceLocator,
  RawResourceSource,
  RawResourceSourceObject,
  ResourceSource,
  ResourceSourceObject,
  SkillBinding,
  SkillBindingOverlay,
  SkillsOverlay,
} from "./document.js";
export {
  agentBindingOverlaySchema,
  agentBindingSchema,
  atlanteDocumentOverlaySchema,
  atlanteDocumentSchema,
  authoredExtendsSchema,
  bindingDescriptionSchema,
  DEFAULT_AGENT_OUTPUT_DIR,
  DEFAULT_SKILL_OUTPUT_DIR,
  hostsSchema,
  hostTargetSchema,
  outputOptionsOverlaySchema,
  outputOptionsSchema,
  rawResourceLocatorSchema,
  resourceSourceObjectSchema,
  resourceSourceSchema,
  SCHEMA_URI,
  skillBindingOverlaySchema,
  skillBindingSchema,
} from "./document.js";
export type {
  AuthoredEvalConfig,
  AuthoredEvalPackConfig,
  AuthoredEvalScenario,
  EvalBudget,
  EvalCheck,
  EvalConfig,
  EvalPackConfig,
  EvalScenario,
  EvalScenarioTask,
  SandboxRelativePath,
} from "./eval.js";
export {
  EVAL_BUDGET_DEFAULTS,
  EVAL_CHECK_TIMEOUT_DEFAULT_MS,
  EVAL_HOST,
  EVAL_MAX_TRIALS,
  EVAL_SCENARIO_SCHEMA_URI,
  evalCheckSchema,
  evalConfigSchema,
  evalPackConfigSchema,
  evalScenarioSchema,
} from "./eval.js";
export type {
  MarkdownBlockContent,
  MarkdownBlockquote,
  MarkdownBreak,
  MarkdownCode,
  MarkdownDelete,
  MarkdownEmphasis,
  MarkdownHeading,
  MarkdownImage,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownList,
  MarkdownListItem,
  MarkdownNode,
  MarkdownParagraph,
  MarkdownPhrasingContent,
  MarkdownStrong,
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
  MarkdownText,
  MarkdownThematicBreak,
} from "./markdown-ast.js";
export type { Value, ValuesMap, ValuesMapOverlay } from "./values.js";
export {
  VALUE_KEY_PATTERN,
  valueSchema,
  valuesMapOverlaySchema,
  valuesMapSchema,
} from "./values.js";

import evalScenarioJsonSchemaRaw from "../schema/v0.1/eval-scenario.json" with {
  type: "json",
};
import documentJsonSchemaRaw from "../schema/v0.1/schema.json" with {
  type: "json",
};

export const documentJsonSchema = documentJsonSchemaRaw as Record<
  string,
  unknown
>;

export const evalScenarioJsonSchema = evalScenarioJsonSchemaRaw as Record<
  string,
  unknown
>;

export type {
  AgentBinding,
  AgentBindingOverlay,
  AgentsOverlay,
  AnyAtlanteDocument,
  AnyAtlanteDocumentOverlay,
  AtlanteDocument,
  AtlanteDocumentOverlay,
  AtlanteDocumentOverlayV02,
  AtlanteDocumentV02,
  AuthoredBinding,
  AuthoredExtends,
  AuthoredResourceLocator,
  Hosts,
  HostsV02,
  HostTarget,
  HostTargetV02,
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
  atlanteDocumentOverlayV02Schema,
  atlanteDocumentSchema,
  atlanteDocumentV02Schema,
  authoredExtendsSchema,
  bindingDescriptionSchema,
  DEFAULT_AGENT_OUTPUT_DIR,
  DEFAULT_SKILL_OUTPUT_DIR,
  hostsSchema,
  hostsV02Schema,
  hostTargetSchema,
  hostTargetV02Schema,
  outputOptionsOverlaySchema,
  outputOptionsSchema,
  rawResourceLocatorSchema,
  resourceSourceObjectSchema,
  resourceSourceSchema,
  SCHEMA_URI,
  SCHEMA_URI_V02,
  skillBindingOverlaySchema,
  skillBindingSchema,
} from "./document.js";
export type {
  AnyEvalConfig,
  AuthoredEvalConfig,
  AuthoredEvalConfigV02,
  AuthoredEvalPackConfig,
  AuthoredEvalPackConfigV02,
  AuthoredEvalScenario,
  EvalBudget,
  EvalCheck,
  EvalConfig,
  EvalConfigV02,
  EvalHostV02,
  EvalPackConfig,
  EvalPackConfigV02,
  EvalScenario,
  EvalScenarioTask,
  SandboxRelativePath,
} from "./eval.js";
export {
  EVAL_BUDGET_DEFAULTS,
  EVAL_CHECK_TIMEOUT_DEFAULT_MS,
  EVAL_HOST,
  EVAL_HOSTS_V02,
  EVAL_MAX_TRIALS,
  EVAL_SCENARIO_SCHEMA_URI,
  evalCheckSchema,
  evalConfigSchema,
  evalConfigV02Schema,
  evalPackConfigSchema,
  evalPackConfigV02Schema,
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
import documentV02JsonSchemaRaw from "../schema/v0.2/schema.json" with {
  type: "json",
};

export const documentJsonSchema = documentJsonSchemaRaw as Record<
  string,
  unknown
>;

export const documentV02JsonSchema = documentV02JsonSchemaRaw as Record<
  string,
  unknown
>;

export const evalScenarioJsonSchema = evalScenarioJsonSchemaRaw as Record<
  string,
  unknown
>;

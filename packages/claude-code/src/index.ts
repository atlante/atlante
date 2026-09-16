export type {
  ClaudeCodeMaterializeOptions,
  ClaudeCodeMaterializerPrepared,
  HostMaterializationOutcome,
  MaterializationDiagnostic,
} from "./materialize.js";
export {
  CLAUDE_CODE_HOST_TARGET,
  claudeCodeMaterializer,
} from "./materialize.js";
export type {
  ClaudeCodeMaterializationErrorCode,
  ClaudeCodeNativeFile,
  ClaudeCodeNativeProject,
  ClaudeCodeOutputDirectory,
  ClaudeCodeOutputOptions,
  ClaudeCodeOwnedFile,
  ClaudeCodeOwnershipManifest,
  ClaudeCodePreparedAgent,
  ClaudeCodePreparedProject,
  ClaudeCodePreparedSkill,
} from "./native.js";
export {
  ClaudeCodeMaterializationError,
  materializeClaudeCode,
  planClaudeCodeMaterialization,
  readClaudeCodeNative,
} from "./native.js";
